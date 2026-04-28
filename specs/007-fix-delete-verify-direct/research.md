# Research: Direct-Path Delete Verification

This document records the design decisions made during Phase 0 of [plan.md](plan.md). All five questions below were resolved without invoking subagents — the relevant code (`src/tools/delete-file/`, `src/services/obsidian-rest.ts`) and spec 005's research/data-model artifacts were sufficient.

---

## R1 — Which upstream endpoint(s) should the direct-path verification query use?

**Decision**: Reuse the existing wrapper methods. For a directory target call `rest.listFilesInDir(path)` (`GET /vault/{path}/`); for a file target call `rest.getFileContents(path)` (`GET /vault/{path}` with `Accept: text/markdown`). Both already translate a 404 response into `ObsidianNotFoundError` via `safeCall` ([src/services/obsidian-rest.ts:53](../../src/services/obsidian-rest.ts#L53)), and any non-404, non-success failure (timeout, connection reset, 5xx) propagates as `ObsidianTimeoutError` / `ObsidianApiError`. The verification helper interprets:

- `ObsidianNotFoundError` thrown → `'absent'` (positive evidence of successful deletion)
- successful return → `'present'` (positive evidence the delete did not take effect)
- any other error → propagate to the caller's `try/catch`, which converts it to `OutcomeUndeterminedError` per spec 005 FR-009

**Rationale**: This is the minimum-surface change. Both endpoints already exist on `ObsidianRestService` and are already exercised by every other tool — no new HTTP method, no new error translation, no extra dependency. The kind of the deleted target (file vs. directory) is known to the caller at every verification site (the handler determined it during type-detection, the recursive walk knows it from the trailing-slash check on the listing entry), so the helper accepts it as a parameter.

**Alternatives considered**:

- **HEAD `/vault/{path}`**: efficient (no body) but the upstream Local REST API plugin's HEAD support is undocumented and varies across plugin versions. Adding a new wrapper method to gate behaviour on a possibly-absent upstream feature is more surface area than the bandwidth savings justify.
- **Single endpoint that handles both kinds (`GET /vault/{path}` for both)**: rejected because for a directory target the upstream returns the directory's *file content* endpoint behaviour (which differs across plugin versions — sometimes 404, sometimes a redirect, sometimes the listing). The two-endpoint split mirrors the upstream's own URL convention.
- **Wrapper-side caching of pre-delete listings as the verification source**: rejected because the spec's headline scenario is precisely "the upstream auto-pruned the parent" — any cached snapshot would be stale by definition, and the whole point of the spec 007 fix is to stop using parent-side state for verification.

## R2 — Where should the direct-path probe helper live?

**Decision**: Move the verification-call utility into `src/tools/delete-file/verify-then-report.ts` as a new exported function `pathExists(rest, path, kind): Promise<'absent' | 'present'>`. Delete `listingHasName` from `src/tools/delete-file/recursive-delete.ts` since its only consumers are the three verify callbacks that switch over to `pathExists` in this fix.

**Rationale**: `verify-then-report.ts` is already the home of the verification machinery (`attemptWithVerification`, `OutcomeUndeterminedError`). Co-locating the path-probe helper keeps the verification surface in one file. `listingHasName` becomes dead code under spec 007 — removing it prevents accidental future use of the parent-listing approach this fix exists to replace.

**Alternatives considered**:

- **Add to `obsidian-rest.ts` as a method**: rejected because it is not a primitive REST operation but a derived "does this path exist" question that belongs to the verification layer. Keeping it in `verify-then-report.ts` matches the existing module boundary (rest service = HTTP primitives; tool helpers = domain logic).
- **Keep `listingHasName` and add `pathExists` alongside it for back-compat**: rejected because spec 007 FR-001 explicitly forbids the parent-listing approach. Leaving the dead helper in place is a maintenance hazard.

## R3 — How should the recursive walk thread the per-item kind through to verification?

**Decision**: Add a `kind: 'file' | 'directory'` parameter to `attemptChildDelete` in `src/tools/delete-file/recursive-delete.ts`. The walk already discriminates by `child.endsWith('/')` to decide whether to recurse — pass that same boolean (re-encoded as `'file' | 'directory'`) through to the verification closure. Drop the now-unused `parentDir` and `childName` parameters from `attemptChildDelete`'s signature (they were only consumed by `listingHasName`).

**Rationale**: The kind information already exists in the walk; threading it forward is one parameter of plumbing. The dropped parameters were only there for the parent-listing approach. This keeps the signature minimal and matches the new verification model.

**Alternatives considered**:

- **Probe the kind at verification time** (e.g., try `getFileContents`, fall back to `listFilesInDir` on 404): rejected because (a) it doubles the verification call count, (b) it can produce false-absent if the file existed-but-was-deleted between the original delete and the verification (the second probe would also 404, masking what should have been a kind-mismatch indicator), and (c) the kind is already known.
- **Always probe both kinds and combine results**: rejected — same overhead and ambiguity issues.

## R4 — What error class and message should represent the new "verified-still-present" outcome?

**Decision**: Add `DeleteDidNotTakeEffectError` to `src/tools/delete-file/verify-then-report.ts`:

```typescript
export class DeleteDidNotTakeEffectError extends Error {
  constructor(
    public readonly targetPath: string,
    public readonly filesRemoved: number,
    public readonly subdirectoriesRemoved: number
  ) {
    super(
      `delete did not take effect: ${targetPath} ` +
        `(filesRemoved=${filesRemoved}, subdirectoriesRemoved=${subdirectoriesRemoved})`
    );
    this.name = 'DeleteDidNotTakeEffectError';
  }
}
```

The handler's catch block translates this to the MCP error message `delete did not take effect: <path> (filesRemoved=<n>, subdirectoriesRemoved=<m>)`. For single-file deletes both counts are 0; for outer-directory verified-still-present cases the counts reflect the children that were successfully removed during the walk before the outer delete failed.

**Rationale**: This matches Q1's clarification (option B): a new error reason, mirroring the success-response shape's `filesRemoved` / `subdirectoriesRemoved` counts so callers can reason about partial vault state without re-listing. The format includes both counts in the message text so the structured error message is self-describing — consistent with how the `child failed: <path> — already deleted: [...]` message embeds its diagnostic info inline (spec 005 contract category 3).

**Alternatives considered**:

- **Reuse `PartialDeleteError`** (spec 005 category 3) **with the outer target as the "failed child"**: rejected per Q1's spec-level reasoning — no child failed in this case; folding the outer failure into the per-item-failure shape is misleading.
- **Reuse `ObsidianApiError(-1, …)`**: this is what spec 005's *file* branch currently uses ([src/tools/delete-file/handler.ts:110](../../src/tools/delete-file/handler.ts#L110)) for verified-still-present file deletes. Rejected because the new shape's count fields can't be carried by `ObsidianApiError`, and the message format `Obsidian API Error -1: delete failed for <path>` is indistinguishable from a generic upstream failure. The single-file case migrates to `DeleteDidNotTakeEffectError` for consistency with the directory case.

## R5 — How should the regression tests be structured?

**Decision**: Reuse spec 005's test infrastructure (`vitest@4.1.5` + `nock@14.0.13`). Modify the existing `tests/tools/delete-file/timeout-verify.test.ts` to drive direct-path mocks instead of parent-listing mocks for the verification call. Add three new test files under `tests/tools/delete-file/`:

- `auto-prune.test.ts` — FR-007: parent-auto-prune scenario (parent has only the target as a child; mocks the upstream parent listing to return 404 on a follow-up call to demonstrate that the wrapper does NOT call it; asserts success response).
- `sibling-preserving.test.ts` — FR-008: parent retains siblings; same direct-path 404 verification → success.
- `verified-still-present.test.ts` — FR-011: direct-path verification returns 200 → new `delete did not take effect: <path>` error with summary counts.

The existing `timeout-verify.test.ts` continues to cover FR-009 (verification call itself fails for a non-404 transport reason → `outcome undetermined`).

**Rationale**: Three new files follow the one-scenario-per-file convention spec 005 established. Modifying the existing `timeout-verify.test.ts` rather than rewriting it preserves git blame on the FR-009 case — only the verification mocks shift, the assertions stay the same. The auto-prune test is the headline regression check for the bug report; making it its own file makes the test name (`auto-prune.test.ts`) self-documenting in CI output.

**Alternatives considered**:

- **One combined `direct-path-verify.test.ts`** covering all three new scenarios: rejected because the FR-007/FR-008/FR-011 scenarios assert different outcomes (success / success / new-error-shape) and folding them obscures which acceptance criterion each `it()` block exercises.
- **Parameterised tests over a fixture matrix**: rejected because each scenario needs distinct nock chains (different listing responses, different verification responses); the parameterisation would be more fixture plumbing than test logic.
