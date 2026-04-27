# Research: Fix Directory Delete

This document records the seven research questions resolved during Phase 0 of `/speckit-plan`. Each section follows: **Decision** / **Rationale** / **Alternatives considered**. Every decision is grounded in the current code at HEAD on `005-fix-directory-delete`, the spec's clarifications (recorded in [spec.md § Clarifications](spec.md)), and the Obsidian Local REST API behaviour observed in the existing `obsidian-rest.ts` client.

---

## R1 — How to discriminate transport timeouts from other upstream errors

**Decision**: Add a tiny error-class hierarchy in a new file [src/services/obsidian-rest-errors.ts](../../src/services/obsidian-rest-errors.ts) and have `safeCall` in [src/services/obsidian-rest.ts](../../src/services/obsidian-rest.ts) throw the typed subclass that matches the underlying axios error. All three classes extend `Error` and preserve the existing `Obsidian API Error <code>: <message>` text on `.message`, so every existing caller (every other tool wrapper) sees behaviour identical to today. Only the new `delete_file` handler narrows on the type via an `isObsidianTimeoutError(err)` / `isObsidianNotFoundError(err)` guard.

```ts
// src/services/obsidian-rest-errors.ts (sketch — not authoritative; see data-model.md)
export class ObsidianTimeoutError extends Error { readonly kind = 'timeout'; ... }
export class ObsidianNotFoundError extends Error { readonly kind = 'not-found'; readonly status = 404; ... }
export class ObsidianApiError extends Error { readonly kind = 'api'; readonly status?: number; ... }
```

**Rationale**: The current `safeCall` (lines 35–47 in `obsidian-rest.ts`) collapses every `AxiosError` into a generic `Error` whose `.message` is the only signal — that string is exactly what the bug report reproduced ("Obsidian API Error -1: timeout of 10000ms exceeded"). Pattern-matching on `.message` to tell timeouts apart from other errors would be fragile (the upstream message comes from axios + Obsidian's REST plugin, neither under this server's control). Throwing typed subclasses from a single chokepoint is the smallest change that gives the handler a reliable signal. Keeping the same `.message` text means no other tool's error output changes — a tightly bounded refactor.

The discriminator at the axios layer is well-defined: a transport timeout fires `error.code === 'ECONNABORTED'` (axios's standard signal for `request timed out`); a 404 from the Obsidian REST plugin fires `error.response?.status === 404` with a structured `{ errorCode, message }` body. Those two branches map to `ObsidianTimeoutError` and `ObsidianNotFoundError`; everything else falls through to `ObsidianApiError`.

**Alternatives considered**:
- *Pattern-match on the rethrown `.message`*: rejected — fragile, couples handler logic to upstream phrasing.
- *Return `Result<T, ErrorKind>` from `safeCall` instead of throwing*: rejected — would force every existing caller in `obsidian-rest.ts` to change. Out of scope for this feature.
- *Add a parallel `tryDeleteFile` method that returns a discriminated result*: rejected — duplicates logic and bypasses `safeCall`'s message formatting. The typed-error approach reuses `safeCall`.

---

## R2 — How to detect whether a path resolves to a file or a directory

**Decision**: Use the upstream listing endpoint on the *parent* of the target. The wrapper computes the parent path (everything up to the last `/`; vault root if the target has no separator), calls `listFilesInDir(parent)` (or `listFilesInVault()` if the parent is the root), and inspects the returned `files: string[]`. The Obsidian Local REST API's listing convention (as already encoded in [src/services/obsidian-rest.ts:52–68](../../src/services/obsidian-rest.ts#L52-L68)) returns directory entries with a trailing `/` and file entries without — so the wrapper looks for `targetName` (file), then `targetName/` (directory), then nothing (404).

**Rationale**: The spec's Assumption 8 says "Directory detection uses the upstream listing endpoint" — no separate `stat` call is assumed. Listing the parent is also exactly what's needed for the verification re-query (FR-004), so the same code path serves both directory detection AND post-condition verification. This collapses two operations into one mechanism.

**Alternatives considered**:
- *Try `listFilesInDir(target)` first; if it returns 200 → directory; if 404 → file or missing*: rejected — costs an extra round-trip *and* a 404 from `listFilesInDir` doesn't distinguish "target is a file" from "target doesn't exist." Listing the parent answers both questions in one call.
- *Try the single-file delete first and recover on failure*: rejected — destructive on the happy path. Listing first is read-only.
- *Add a stat endpoint*: rejected — the upstream doesn't expose one and adding a wrapper-side stat would just be the listing call under a different name.

---

## R3 — Recursive walk algorithm

**Decision**: Serial, depth-first walk in upstream listing order. The walk function is `recursiveDeleteDirectory(rest, dirpath, deletedAccumulator)` and proceeds as follows:

1. List `dirpath` via `rest.listFilesInDir(dirpath)`. The returned array is the iteration order — no in-wrapper sorting (FR-014).
2. For each child entry in order:
    - If the entry ends with `/` → recurse into `recursiveDeleteDirectory(rest, joinPath(dirpath, child), deletedAccumulator)`. On return, push the subdirectory path onto `deletedAccumulator`.
    - Otherwise → call `attemptWithVerification(...)` to delete the file; on success, push the file path onto `deletedAccumulator`.
    - On failure (any non-success outcome from the per-item delete) → throw `PartialDeleteError(failedPath, deletedAccumulator.slice())`.
3. After all children succeed, issue the final outer-directory delete via `attemptWithVerification(...)`. On success, return.

`deletedAccumulator` is a single array threaded through the recursion so that the partial-failure error captures every successfully-deleted path — files AND intermediate subdirectories alike — across the whole walk. Paths are stored as full vault-relative paths (the same form the upstream listing returns), in the order they were deleted.

**Rationale**: Depth-first matches the "directory must be empty before its delete succeeds" constraint of the upstream API. Visiting in upstream listing order satisfies FR-014 with zero in-wrapper sorting code; tests pin the order via the `/vault/{dirpath}/` mock response. A single `deletedAccumulator` array (rather than collecting subtrees and merging) is the simplest data structure that produces the flat full-path list the Q1 clarification specified.

**Alternatives considered**:
- *Breadth-first*: rejected — would have to defer subdirectory-removal until all leaves at that level are gone, which means the partial-failure list would skew toward leaves. Depth-first matches the natural recursive shape and produces a more intuitive deleted-paths order.
- *Concurrent per-item deletes (Promise.all)*: rejected — the spec explicitly says "one by one." Concurrency would also blur the iteration-order assertion required by FR-012.
- *In-wrapper sort (alphabetical)*: rejected — the Q5 clarification chose upstream listing order specifically to avoid this layer of wrapper logic.

---

## R4 — Timeout-then-verify mechanics

**Decision**: A small utility `attemptWithVerification(operation, verify)` in [src/tools/delete-file/verify-then-report.ts](../../src/tools/delete-file/verify-then-report.ts) wraps every upstream call (the outer directory delete AND every per-item delete inside the walk, per FR-008). Its body:

```text
try:
    await operation()
    return { outcome: 'success' }
catch err:
    if err is ObsidianTimeoutError:
        try:
            verdict = await verify()                        // 'absent' | 'present'
            if verdict === 'absent':  return { outcome: 'success' }
            else:                     return { outcome: 'failure', cause: err }
        catch verifyErr:
            throw new OutcomeUndeterminedError(...)        // FR-009: any verify failure → undetermined
    if err is ObsidianNotFoundError: rethrow                // handler turns this into "not found"
    rethrow                                                  // any other error → unchanged
```

The `verify` callback is supplied by the caller and uses the same parent-listing technique from R2 — which means the verification step also distinguishes "target absent" (success) from "target still present" (failure). For the recursive walk, the `verify` callback for a per-item delete checks the child's specific name in the parent listing.

**Rationale**: This isolates the timeout-then-verify decision into a single function used identically at every callsite — outer delete, inner file deletes, inner subdirectory deletes. That uniformity is exactly what FR-008 requires. The function is small enough that there's no need to make it generic over operation types — `Promise<void>` for the operation and `Promise<'absent' | 'present'>` for the verify is sufficient.

**Alternatives considered**:
- *Wrap the timeout-then-verify logic inside `safeCall`*: rejected — `safeCall` is shared across every tool. Adding verify logic there would couple unrelated tools to a verification mechanism they don't need. The handler is the right level.
- *Use axios's response interceptor to retry on timeout*: rejected — a retry is not the spec's behaviour. The spec calls for a single verification *listing* query, not a re-attempt of the original DELETE.

---

## R5 — Verification query failure handling

**Decision**: Single-shot. If `verify()` throws (any error — `ObsidianTimeoutError`, `ObsidianApiError`, network error, anything else), `attemptWithVerification` throws `OutcomeUndeterminedError`. The handler converts that into the structured "outcome undetermined" tool response. There is no retry, no back-off, and no distinction between verification failure modes in the response — only "we could not observe the post-condition."

**Rationale**: This is the explicit Q3 clarification (Session 2026-04-27 in spec.md). Uniform treatment keeps the wrapper deterministic: tests can assert exactly one verification call per timeout, and an LLM caller sees a consistent error shape regardless of which axios-layer thing went wrong during verification.

**Alternatives considered**:
- *One retry of `verify()` before declaring undetermined*: explicitly rejected by Q3.
- *Distinguish "verify timed out" vs "verify failed with 5xx" in the error message*: planning-level detail; the spec's Tool outcome entity defines a single "outcome undetermined" reason. The underlying cause is preserved on the error's `.cause` field for debugging but not surfaced in the tool response.

---

## R6 — Test fixtures: simulating timeouts deterministically

**Decision**: Use `nock`'s `.replyWithError(...)` API to fabricate an `ECONNABORTED` axios error directly, rather than `.delayConnection(11000)` which would block tests for 11 seconds. The shape of the error nock injects matches what axios produces when its real timeout fires:

```ts
nock(baseUrl)
  .delete('/vault/1000- Testing-to-be-deleted')
  .replyWithError({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' });
```

Listing-order pinning happens by controlling the body of the mocked `/vault/{dirpath}/` response — whatever order the test puts files in, that's the order the wrapper will visit them.

**Rationale**: Tests must be deterministic AND fast. `delayConnection` would force every timeout-related test to wait the wall-clock timeout, blowing up CI runtime. `replyWithError` synthesises the same axios error shape `safeCall` will see in production, exercising the `code === 'ECONNABORTED'` branch in the new typed-error layer end-to-end.

The existing `tests/tools/patch-content/` and `tests/tools/surgical-reads/` test suites already use `nock` against the `/vault/...` endpoints — the new suite follows that pattern with no new infrastructure.

**Alternatives considered**:
- *`.delayConnection(11000)`*: rejected — slow, flake-prone if the wrapper's timeout drifts.
- *Mock axios directly via `vi.mock`*: rejected — bypasses the actual `safeCall` error mapping, defeating the purpose of integration-style tests.
- *Spawn a real HTTP server that drops the connection*: rejected — overkill; nock simulates the wire-level error directly.

---

## R7 — Tool registration and dispatcher wiring

**Decision**:

1. Remove the `delete_file` object from the `FILE_TOOLS` array in [src/tools/file-tools.ts](../../src/tools/file-tools.ts) (lines 77–94 in the current file). The remaining four file tools (`list_files_in_vault`, `list_files_in_dir`, `get_file_contents`, `batch_get_file_contents`) stay in that array.
2. Create [src/tools/delete-file/tool.ts](../../src/tools/delete-file/tool.ts) that exports `DELETE_FILE_TOOLS: Tool[]`. The `inputSchema` is derived from `DeleteFileRequestSchema` via `zodToJsonSchema(...)`. The description explicitly states recursive directory deletion (FR-011 + SC-006).
3. Update [src/tools/index.ts](../../src/tools/index.ts) to import `DELETE_FILE_TOOLS` and spread it into `ALL_TOOLS` (preserving alphabetical-ish grouping next to `FILE_TOOLS`).
4. Update [src/index.ts](../../src/index.ts) so the existing `case 'delete_file'` body (currently lines 374–381 — three lines that call `rest.deleteFile`) collapses to:
   ```ts
   case 'delete_file':
     return handleDeleteFile(args, rest);
   ```
   The handler is imported at the top of the file like `handlePatchContent`, `handleGetHeadingContents`, etc.

**Rationale**: The exact same shape used by the recently-merged feature 004 (Path A wiring of graph tools) — that pattern is the established norm in this codebase and minimises review surface. Removing the entry from `FILE_TOOLS` is mandatory: leaving it there would result in two `delete_file` entries in `ALL_TOOLS`, which the MCP SDK's tool list would surface as a duplicate. The registration test (under Phase 1) explicitly asserts there is exactly one `delete_file` entry.

**Alternatives considered**:
- *Keep the entry in `FILE_TOOLS` and override its description in place*: rejected — schema generation would still come from the hand-rolled JSON, violating Principle III's "single source of truth" requirement.
- *Inline the handler logic into `src/index.ts`*: rejected — violates Principle I (modular boundaries). The handler module pattern is established by every prior tool.
- *Skip the typed-error layer and pattern-match on `.message`*: see R1 — already rejected.
