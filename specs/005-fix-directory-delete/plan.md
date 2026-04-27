# Implementation Plan: Fix Directory Delete

**Branch**: `005-fix-directory-delete` | **Date**: 2026-04-27 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/005-fix-directory-delete/spec.md`

## Summary

The `delete_file` MCP tool currently dispatches a single upstream HTTP DELETE through [src/services/obsidian-rest.ts](../../src/services/obsidian-rest.ts) (`deleteFile`). On a directory path, the Obsidian Local REST API does not delete recursively, so non-empty directories return an error from the upstream. Worse, the wrapper's `safeCall` treats every `AxiosError` (including the upstream's timeout) as opaque "Obsidian API Error -1: timeout of 10000ms exceeded", so callers cannot distinguish (a) "directory non-empty, upstream actually responded with an error" from (b) "directory was empty, upstream actually completed the delete but the response timed out at the wire."

The fix has two halves applied together:

- **Fix A (recursive directory delete)** — promote `delete_file` to its own subdirectory module (matching the established `patch-content` / `surgical-reads` pattern), have its handler detect when the target is a directory via the existing listing endpoint, and walk the directory's contents serially, deleting each file (and recursively each subdirectory) before deleting the now-empty target.
- **Fix B (coherent timeout handling)** — introduce a typed-error layer on top of `safeCall` so the handler can tell timeouts and 404s apart from other upstream failures. On every transport timeout the handler issues a single verification listing query on the relevant parent and reports a definite success or definite failure based on the observed post-condition. If the verification query itself fails for any reason, the handler returns "outcome undetermined" without retrying.

The five clarifications captured in the spec drive the contract surface: success responses include summary counts of files + subdirectories removed; partial-failure errors include the offending path plus a flat list of every path successfully removed during the recursive walk; verification is single-shot; recursive walk visits children in upstream listing order.

## Technical Context

**Language/Version**: TypeScript 5.6.x (strict mode, ES modules), compiled with `tsc --noEmit` clean and bundled with `tsup`
**Primary Dependencies**: `@modelcontextprotocol/sdk` ^1.12.0 (MCP transport), `axios` ^1.7.7 (HTTP client to Obsidian Local REST API; already configured with a 10 000 ms transport timeout in [src/services/obsidian-rest.ts:27](../../src/services/obsidian-rest.ts#L27)), `zod` ^3.23.8 (boundary input validation per Constitution Principle III), `zod-to-json-schema` 3.25.2 (JSON Schema derivation for the published MCP tool contract)
**Storage**: No new storage. The Obsidian vault on disk is the system of record; this feature only adds wrapper-side orchestration of the existing `/vault/...` REST endpoints.
**Testing**: `vitest` 4.1.5 (unit + integration), `nock` 14.0.13 for HTTP mocking — the established pattern for `obsidian-rest.ts`-backed tools (used by `patch-content` and `surgical-reads` test suites).
**Target Platform**: Node.js >= 18 (per `package.json` `engines`); cross-platform (Windows, macOS, Linux). Path handling stays vault-relative — no platform-specific path separators leak in.
**Project Type**: Library / MCP server (single TypeScript project, `src/` + `tests/` mirror). No frontend, no separate API layer.
**Performance Goals**: Out of scope. Per spec the recursive walk is serial ("one by one"); each per-item upstream call inherits the existing 10 000 ms transport timeout. There is no overall wall-clock budget for the walk — large directories will simply take proportionally longer.
**Constraints**: Constitution Principles I–IV apply. The existing 10 000 ms `axios` transport timeout in `ObsidianRestService` is preserved unchanged (per the spec's Assumption 4). No new runtime dependencies are needed.
**Scale/Scope**: Typical Obsidian vault directories — dozens to low hundreds of files per directory, recursion depth typically ≤ 5 levels. The recursive walk is unbounded in depth; no extra guards needed because Obsidian vaults do not contain cycles or symlinks.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution defines four normative principles ([.specify/memory/constitution.md](../../.specify/memory/constitution.md)). Each is evaluated against this feature:

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Modular Code Organization** | ✅ PASS | New code lands under `src/tools/delete-file/` (subdirectory matching `patch-content/` and `surgical-reads/`). The recursive-walk and timeout-then-verify helpers live in their own modules inside that subdirectory. `obsidian-rest.ts` gains a typed-error layer (a single new file `src/services/obsidian-rest-errors.ts`) that other modules can opt into without changing existing call sites. The dispatcher in `src/index.ts` replaces its inline `delete_file` `case` body with a single call to the new handler — no logic leaks into the dispatcher. Cross-module imports flow `tool → handler → service → axios`, no upward or cyclic deps. |
| **II. Public Tool Test Coverage (NON-NEGOTIABLE)** | ✅ PASS by design | `delete_file` is a registered public tool. The plan's Phase 1 contract and the spec's FR-012 + FR-013 require six test files under `tests/tools/delete-file/`: registration, schema, single-file happy path, recursive happy path with assertion of iteration order and consolidated counts, partial-failure shape (offender + flat deleted-paths list), and timeout-then-verify behaviour for both success-on-timeout and failure-on-timeout. Both branches of Principle II ("happy path AND validation/upstream-error path") are exercised. |
| **III. Boundary Input Validation with Zod** | ✅ PASS by design | The current `delete_file` declaration in [src/tools/file-tools.ts:78-94](../../src/tools/file-tools.ts#L78-L94) is a hand-written JSON schema — pre-Principle-III scaffolding identical to what the previous feature (004) cleaned up for graph tools. The new module replaces it with a `DeleteFileRequestSchema` zod schema; the published `inputSchema` is derived via `zod-to-json-schema`. The handler calls `assertValidDeleteFileRequest(args)` before any upstream call. The existing entry is removed from `FILE_TOOLS` so there is no duplicate registration. |
| **IV. Explicit Upstream Error Propagation** | ✅ PASS | The timeout-then-verify path is an *explicit* documented recovery (Principle IV's "(a) handled with a documented recovery path" branch) — not a silent fallback. When verification confirms the post-condition matches the requested outcome, returning success preserves the chain of custody (the verification result is the evidence). When verification cannot determine the outcome, the handler returns a *structured* "outcome undetermined" error — never a silent success. 404s are surfaced as a clear "not found" error. Non-timeout, non-404 upstream errors propagate unchanged through the existing `safeCall` path. |

**Test runner**: `vitest@4.1.5` is already configured and used by features 001/003/004. No setup work needed.

**Gate result**: No constitution violations. No `Complexity Tracking` entries needed. Re-evaluated post-Phase-1 design (below) — still no violations.

## Project Structure

### Documentation (this feature)

```text
specs/005-fix-directory-delete/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output: upstream behaviour + design decisions
├── data-model.md        # Phase 1 output: typed errors, response shapes, internal data structures
├── quickstart.md        # Phase 1 output: how to verify the fix manually + via tests
├── contracts/           # Phase 1 output: per-tool I/O contract
│   └── delete_file.md
├── checklists/
│   └── requirements.md  # From /speckit-specify
├── spec.md              # From /speckit-specify (with 5 clarifications)
└── tasks.md             # Phase 2 output (NOT created here — see /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── config.ts                                # (unchanged)
├── index.ts                                 # MODIFIED: delete_file case body collapses to handleDeleteFile(args, rest)
├── types.ts                                 # (unchanged — new types live with the new module)
├── services/
│   ├── obsidian-rest.ts                     # MODIFIED: safeCall now throws typed errors (ObsidianTimeoutError | ObsidianNotFoundError | ObsidianApiError) instead of a generic Error; behavioural compatibility preserved (all three extend Error and carry the same message)
│   ├── obsidian-rest-errors.ts              # NEW: error class hierarchy + isObsidianTimeoutError / isObsidianNotFoundError type guards
│   ├── graph-service.ts                     # (unchanged)
│   └── smart-connections.ts                 # (unchanged)
└── tools/
    ├── delete-file/                         # NEW directory (matches patch-content/, surgical-reads/, graph/)
    │   ├── schema.ts                        # NEW: DeleteFileRequestSchema (zod) + assertValidDeleteFileRequest
    │   ├── tool.ts                          # NEW: DELETE_FILE_TOOLS[] with description that advertises recursive contract (FR-011)
    │   ├── handler.ts                       # NEW: handleDeleteFile(args, rest) — top-level orchestrator
    │   ├── recursive-delete.ts              # NEW: recursiveDeleteDirectory(rest, dirpath) — pure walk logic
    │   └── verify-then-report.ts            # NEW: attemptWithVerification(...) — timeout-then-verify utility
    ├── file-tools.ts                        # MODIFIED: delete_file entry removed from FILE_TOOLS array
    ├── index.ts                             # MODIFIED: import + spread DELETE_FILE_TOOLS into ALL_TOOLS
    ├── patch-content/                       # (unchanged — reference pattern)
    ├── surgical-reads/                      # (unchanged — reference pattern)
    ├── graph/                                # (unchanged — reference pattern)
    └── ... (other unchanged tool files)

tests/
└── tools/
    ├── delete-file/                         # NEW directory
    │   ├── registration.test.ts             # NEW: tool appears in ALL_TOOLS exactly once with derived inputSchema; description contains "recursive"
    │   ├── schema.test.ts                   # NEW: zod rejects empty / missing filepath; happy parse for valid input
    │   ├── single-file.test.ts              # NEW: happy path for a single-file delete (FR-001 baseline; success counts both 0)
    │   ├── recursive.test.ts                # NEW: FR-012 — non-empty directory end-to-end against a nock'd upstream; asserts iteration in upstream listing order, per-item deletes, final directory delete, and consolidated success counts
    │   ├── partial-failure.test.ts          # NEW: mid-walk failure; asserts error shape contains offender path + flat list of every successfully-deleted path during the walk
    │   ├── timeout-verify.test.ts           # NEW: FR-013 — two scenarios: (a) upstream delete times out but verification listing shows directory absent → success; (b) upstream delete times out and verification shows directory still present → failure; (c) verification query itself fails → "outcome undetermined"
    │   └── not-found.test.ts                # NEW: 404 on the target path → clear "not found" error (never transport-timeout)
    ├── patch-content/                       # (unchanged)
    ├── surgical-reads/                      # (unchanged)
    └── graph/                               # (unchanged)
```

**Structure Decision**: Single TypeScript project with `src/` + `tests/` mirror, identical to the layout used by features 001, 003, and 004. New code is concentrated in `src/tools/delete-file/` and `tests/tools/delete-file/`; one new file in `src/services/` introduces the typed-error layer used by the new handler. `src/index.ts`'s `case 'delete_file'` body collapses from inline calls into a single `return handleDeleteFile(args, rest);` (mirroring how `patch_content` and `get_heading_contents` already dispatch). The `delete_file` entry in `FILE_TOOLS` is removed to avoid duplicate registration.

## Phase 0 — Outline & Research

See [research.md](research.md) for full Decision / Rationale / Alternatives entries. Summary of the seven research questions resolved:

- **R1 — Axios timeout signal**: `safeCall` will be extended to throw `ObsidianTimeoutError` when `error.code === 'ECONNABORTED'` and `ObsidianNotFoundError` when `error.response?.status === 404`. All other axios errors continue to throw `ObsidianApiError`. All three subclass `Error` with the existing message format preserved, so unrelated callers see no behaviour change.
- **R2 — Directory detection**: List the *parent* of the target. If the target appears as a name with no trailing slash → file; with trailing slash → directory; absent → not-found. The Obsidian Local REST API listing endpoint convention (already used by `listFilesInVault` / `listFilesInDir`) supports this.
- **R3 — Recursive walk algorithm**: Serial, depth-first by upstream listing order. For each child: recurse if directory, delete-and-record if file. After all children succeed, issue the final directory delete. On per-item failure, throw a `PartialDeleteError` carrying the offender path + flat deleted-paths list.
- **R4 — Timeout-then-verify mechanics**: A small `attemptWithVerification(opFn, verifyFn)` utility wraps every upstream call (the outer directory delete AND each per-item delete in the walk, per FR-008). On `ObsidianTimeoutError` it calls `verifyFn()`; on any other error it rethrows.
- **R5 — Verification query failure handling**: Single-shot. The handler catches errors from the verification query and converts them into an `OutcomeUndeterminedError`. No retry, no back-off — matches the Q3 clarification.
- **R6 — Test fixtures via nock**: Use `nock(...).replyWithError({ code: 'ECONNABORTED', ... })` to simulate axios timeouts deterministically (no real wall-clock waits in tests). Listing-order pinning is achieved by the order of files returned by the mocked `/vault/{dirpath}/` response.
- **R7 — Tool registration**: Remove the existing `delete_file` entry from `src/tools/file-tools.ts` `FILE_TOOLS` array; add `DELETE_FILE_TOOLS` exported from `src/tools/delete-file/tool.ts`; spread it into `ALL_TOOLS` in `src/tools/index.ts`. The published description (FR-011) explicitly states recursive directory deletion is performed.

## Phase 1 — Design & Contracts

### Data model

See [data-model.md](data-model.md). Summary of entities introduced by this feature:

- **`DeleteFileRequest`** (zod) — the validated input shape: `{ filepath: string; vaultId?: string }` with `filepath` constrained to a non-empty trimmed string.
- **`DeleteFileSuccess`** — the success response payload: `{ deletedPath: string; filesRemoved: number; subdirectoriesRemoved: number }`. For single-file or empty-directory deletes both counts are 0.
- **`PartialDeleteError`** — the partial-failure error: extends `Error`; carries `failedPath: string` and `deletedPaths: string[]` (full relative paths under the target, in upstream-listing order, files + intermediate subdirectories alike).
- **`OutcomeUndeterminedError`** — the verification-failed error: extends `Error`; carries `targetPath: string` and the underlying cause.
- **`ObsidianTimeoutError` / `ObsidianNotFoundError` / `ObsidianApiError`** — the typed-error layer over `safeCall`. All three preserve the existing `Obsidian API Error <code>: <message>` text in `.message` for behavioural compatibility.

### Contracts

See [contracts/delete_file.md](contracts/delete_file.md). The contract documents:

- The MCP `inputSchema` derived from the zod schema
- The success response shape (with counts)
- The four distinct error shapes (validation failure, not-found, partial-failure, outcome-undetermined) plus passthrough of upstream failures
- The recursive contract (advertised in the tool description per FR-011)
- The MCP-level mapping: success → `content: [{type:'text', text: <JSON>}]`; error → `isError: true` with the structured error message in the text content

### Quickstart

See [quickstart.md](quickstart.md). Three verification flows:

1. Manual smoke test against a real Obsidian vault using the bug report's reproduction steps (non-empty directory and empty directory both return clear outcomes).
2. Automated test commands (`npm run test -- tests/tools/delete-file`) and what each file asserts.
3. Manual schema verification (`tools/list` shows the new description).

### Agent context update

The feature plan is referenced from `CLAUDE.md` between the `<!-- SPECKIT START -->` / `<!-- SPECKIT END -->` markers — updated to point at this plan rather than the 004 plan.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations. This feature follows the established pattern from features 001, 003, and 004 directly:

- Tool subdirectory layout (`src/tools/<feature>/`) — precedent in `patch-content/`, `surgical-reads/`, `graph/`.
- Zod-first schema with `zod-to-json-schema`-derived `inputSchema` — precedent in all three.
- Test layout (`tests/tools/<feature>/registration.test.ts` + `schema.test.ts` + handler tests) — precedent in all three.
- Typed-error layer in `obsidian-rest-errors.ts` is a *new* abstraction but is the minimum-surface change that lets the handler discriminate timeouts without inspecting message strings. The existing `safeCall` keeps the same external behaviour for every other caller.

No `Complexity Tracking` entries needed.
