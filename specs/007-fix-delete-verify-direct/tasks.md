---
description: "Task list for spec 007 — Fix Delete Verification (Direct-Path)"
---

# Tasks: Fix Delete Verification (Direct-Path)

**Input**: Design documents from `/specs/007-fix-delete-verify-direct/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/delete_file.md](contracts/delete_file.md), [quickstart.md](quickstart.md)

**Tests**: Required (not optional) — spec FR-007 / FR-008 / FR-009 / FR-010 / FR-011 each pin a specific regression test.

**Organization**: Tasks are grouped by user story so each story can be implemented and verified independently. US1 + US2 (both P1) bundle together as the MVP increment — US1 closes the headline auto-prune bug, and US2 closes the FR-003 correctness gap on the verified-still-present outer path that US1 alone would leave open (see Implementation Strategy § MVP First). US3 (P2) extends the direct-path mechanism to the single-file branch and per-item walk and removes the legacy `listingHasName` helper.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no sequential dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All file paths are relative to the repository root

## Path Conventions

Single project — TypeScript source under `src/`, tests under `tests/` (mirror layout). Inherited from spec 005's structure.

---

## Phase 1: Setup (Shared Infrastructure)

No setup tasks. TypeScript 5.6.x, vitest 4.1.5, nock 14.0.13, axios 1.7.7, and `@modelcontextprotocol/sdk` ^1.12.0 are already wired by spec 005. No new dependencies are introduced (per [plan.md](plan.md) § Technical Context).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the shared verification primitive every user story consumes. No story-specific behaviour lands here.

⚠️ **CRITICAL**: No user story work can begin until this phase is complete.

- [X] T001 Add exported `pathExists(rest, path, kind): Promise<'absent' | 'present'>` helper to [src/tools/delete-file/verify-then-report.ts](src/tools/delete-file/verify-then-report.ts) per [data-model.md](specs/007-fix-delete-verify-direct/data-model.md) § Added by spec 007: dispatches to `rest.listFilesInDir(path)` when `kind === 'directory'` or `rest.getFileContents(path)` when `kind === 'file'`; returns `'absent'` when the call throws `ObsidianNotFoundError`; returns `'present'` when the call resolves successfully; rethrows any other error so callers translate to `OutcomeUndeterminedError`

**Checkpoint**: Foundation ready — direct-path verification primitive available; user-story phases unblocked.

---

## Phase 3: User Story 1 — Recursive delete whose parent becomes empty returns success (Priority: P1) 🎯 MVP (part 1 of 2)

**Goal**: A `delete_file` invocation on a non-empty directory whose parent gets auto-pruned by the upstream returns the spec 005 structured success response — never "outcome undetermined". The wrapper queries the deleted target's path directly, observes 404, and reports success regardless of parent state.

**Independent Test**: Per [quickstart.md](specs/007-fix-delete-verify-direct/quickstart.md) § 1 — create `1000-Testing-to-be-deleted/issue2-test/` containing `file-A.md` and `file-B.md` under an otherwise-empty `1000-Testing-to-be-deleted/`. Invoke `delete_file` with `filepath: "1000-Testing-to-be-deleted/issue2-test"`. Wrapper returns `{ ok: true, deletedPath: "1000-Testing-to-be-deleted/issue2-test", filesRemoved: 2, subdirectoriesRemoved: 0 }`.

### Implementation for User Story 1

- [X] T002 [US1] In the outer-directory branch of [src/tools/delete-file/handler.ts](src/tools/delete-file/handler.ts), switch the verify callback from `() => listingHasName(rest, parent, name)` to `() => pathExists(rest, target, 'directory')`; add `pathExists` to the existing import from `./verify-then-report.js`
- [X] T003 [P] [US1] Update the tool description string in [src/tools/delete-file/tool.ts](src/tools/delete-file/tool.ts) per FR-012: replace the "performs a verification listing query against the parent before reporting outcome" sentence with "performs a single direct-path verification query before reporting outcome"; preserve the recursive-contract sentence (spec 005 FR-011) verbatim

### Tests for User Story 1

- [X] T004 [P] [US1] Create new test file [tests/tools/delete-file/auto-prune.test.ts](tests/tools/delete-file/auto-prune.test.ts) covering FR-007 + FR-010: `nock` chain mocks (a) the inner walk (parent listing + per-item DELETE 200s), (b) the outer DELETE on `parent/target/` to time out at the transport layer, (c) the direct-path verification `GET /vault/parent/target/` to return 404; assert the wrapper response is byte-equivalent to `{ ok: true, deletedPath: "<target>", filesRemoved: <n>, subdirectoriesRemoved: <m> }` (no extra fields, no `verifiedAfterTimeout` flag); assert the response is never the `outcome undetermined` error
- [X] T005 [P] [US1] Create new test file [tests/tools/delete-file/sibling-preserving.test.ts](tests/tools/delete-file/sibling-preserving.test.ts) covering FR-008: `nock` chain mocks (a) the parent listing returns `target/` plus at least one preserved sibling, (b) the outer DELETE on `parent/target/` to time out, (c) the direct-path verification `GET /vault/parent/target/` to return 404; assert the wrapper returns the spec 005 success response — independent of parent state
- [X] T006 [P] [US1] Update [tests/tools/delete-file/registration.test.ts](tests/tools/delete-file/registration.test.ts) per FR-012: extend the description-text assertion to require the schema string contains BOTH "When the path refers to a directory, the deletion is recursive" (spec 005 FR-011) AND "single direct-path verification query" (spec 007 FR-012), per [quickstart.md](specs/007-fix-delete-verify-direct/quickstart.md) § 3

**Checkpoint**: US1's success-path behaviour is fully functional — the auto-prune and sibling-preserving regressions close the headline bug. **Caveat**: the outer-directory verified-still-present path (verify=200) still surfaces the legacy `child failed:` shape until US2's T008/T009 land — do not ship US1 in isolation; bundle with US2 per Implementation Strategy § MVP First. The single-file branch and per-item walk verify-callbacks still use the legacy `listingHasName` helper — US3 migrates them.

---

## Phase 4: User Story 2 — "Outcome undetermined" narrowed; verified-still-present surfaces a new error (Priority: P1) 🎯 MVP (part 2 of 2)

**Goal**: When the outer DELETE times out and the direct-path verification itself fails non-deterministically (its own timeout, connection reset, non-404 5xx), the wrapper continues to surface `outcome undetermined for <target>` per spec 005 FR-009 — narrowed but preserved. When the outer DELETE times out and direct-path verification returns 200 (target still present), the wrapper surfaces a new structured error `delete did not take effect: <path> (filesRemoved=<n>, subdirectoriesRemoved=<m>)` carrying the same summary counts as the success response.

**Independent Test**: Drive the wrapper against a `nock` upstream that times out the outer DELETE and (a) returns 500 / its own timeout / a connection reset on the direct-path verification → wrapper rejects with `outcome undetermined for <target>`; OR (b) returns 200 on the direct-path verification → wrapper rejects with `delete did not take effect: <target> (filesRemoved=<n>, subdirectoriesRemoved=<m>)`.

### Implementation for User Story 2

- [X] T007 [US2] Add `DeleteDidNotTakeEffectError` class in [src/tools/delete-file/verify-then-report.ts](src/tools/delete-file/verify-then-report.ts) per [data-model.md](specs/007-fix-delete-verify-direct/data-model.md) § Added by spec 007: constructor `(targetPath: string, filesRemoved: number, subdirectoriesRemoved: number)`; sets `this.name = 'DeleteDidNotTakeEffectError'`; message `delete did not take effect: ${targetPath} (filesRemoved=${filesRemoved}, subdirectoriesRemoved=${subdirectoriesRemoved})`; export the class
- [X] T008 [US2] In the outer-directory branch of [src/tools/delete-file/handler.ts](src/tools/delete-file/handler.ts), replace `throw new PartialDeleteError(target, [...walkState.deletedPaths])` (currently fired when `outerResult.outcome === 'failure'`) with `throw new DeleteDidNotTakeEffectError(target, walkState.filesRemoved, walkState.subdirectoriesRemoved)`; add `DeleteDidNotTakeEffectError` to the import from `./verify-then-report.js`
- [X] T009 [US2] Add an `instanceof DeleteDidNotTakeEffectError` branch to the catch block in [src/tools/delete-file/handler.ts](src/tools/delete-file/handler.ts) that rethrows ``new Error(`delete did not take effect: ${err.targetPath} (filesRemoved=${err.filesRemoved}, subdirectoriesRemoved=${err.subdirectoriesRemoved})`)``; place this branch BEFORE the `OutcomeUndeterminedError` branch per [data-model.md](specs/007-fix-delete-verify-direct/data-model.md) § Handler error translation table

### Tests for User Story 2

- [X] T010 [P] [US2] Create new test file [tests/tools/delete-file/verified-still-present.test.ts](tests/tools/delete-file/verified-still-present.test.ts) covering FR-011: `nock` chain mocks (a) every per-item child DELETE in the recursive walk to succeed (200), (b) the outer DELETE on `parent/target/` to time out at the transport layer, (c) the direct-path verification `GET /vault/parent/target/` to return 200 (target still present); assert the wrapper rejects with the exact MCP error text `Error: delete did not take effect: <targetPath> (filesRemoved=<n>, subdirectoriesRemoved=<m>)`; assert the response is NEVER the spec 005 `child failed: <path>` shape, NEVER `outcome undetermined`, NEVER a success response
- [X] T011 [P] [US2] Update [tests/tools/delete-file/timeout-verify.test.ts](tests/tools/delete-file/timeout-verify.test.ts) covering FR-009: replace the parent-listing-on-timeout fixture with a direct-path verification mock that returns a non-404 5xx (or its own timeout, or a connection reset); assert the wrapper still surfaces `Error: outcome undetermined for <target>` — the path is narrowed but preserved

**Checkpoint**: US1 + US2 functional. The outer-directory delete cleanly distinguishes `success` (404), `delete did not take effect` (200), and `outcome undetermined` (non-deterministic verification failure). The single-file branch + per-item walk still use legacy parent-listing — US3 closes that gap.

---

## Phase 5: User Story 3 — Single-file delete and per-item walk apply the same direct-path verification (Priority: P2)

**Goal**: The direct-path verification mechanism applies symmetrically to (a) single-file deletes and (b) per-item file/subdirectory deletes during the recursive walk — preserving spec 005 FR-008 symmetry. The dead `listingHasName` helper is removed.

**Independent Test**: (a) Single-file `delete_file` whose upstream DELETE times out at transport with direct-path verification returning 404 → spec 005 success response (`filesRemoved: 0, subdirectoriesRemoved: 0`); same call with verification returning 200 → `delete did not take effect: <path> (filesRemoved=0, subdirectoriesRemoved=0)`. (b) Recursive walk where one per-item file delete times out at transport and the direct-path verification on that specific item path returns 404 → walk continues; same per-item with verification returning 200 → mid-walk `child failed: <childPath> — already deleted: [...]` (the per-item failure shape, distinct from the new outer `DeleteDidNotTakeEffectError`).

### Implementation for User Story 3

- [X] T012 [US3] In [src/tools/delete-file/recursive-delete.ts](src/tools/delete-file/recursive-delete.ts), change `attemptChildDelete`'s signature: drop `parentDir: string` and `childName: string` parameters; add `kind: 'file' | 'directory'` parameter; replace the verify callback `() => listingHasName(rest, parentDir, childName)` with `() => pathExists(rest, childPath, kind)`; add an import for `pathExists` from `./verify-then-report.js`
- [X] T013 [US3] In [src/tools/delete-file/recursive-delete.ts](src/tools/delete-file/recursive-delete.ts), update both call sites of `attemptChildDelete` inside the `for (const child of children)` loop in `recursiveDeleteDirectory`: pass `kind: 'directory'` for the `child.endsWith('/')` branch and `kind: 'file'` for the file branch; remove the now-unused `dirpath` / `childDirName` / `child` arguments from the call
- [X] T014 [US3] Remove the `listingHasName` function declaration AND its `export` from [src/tools/delete-file/recursive-delete.ts](src/tools/delete-file/recursive-delete.ts) per [data-model.md](specs/007-fix-delete-verify-direct/data-model.md) § Removed by spec 007 (dead code under spec 007's contract)
- [X] T015 [US3] In the file branch of [src/tools/delete-file/handler.ts](src/tools/delete-file/handler.ts), switch the verify callback from `() => listingHasName(rest, parent, name)` to `() => pathExists(rest, target, 'file')`; replace `throw new ObsidianApiError(-1, \`Obsidian API Error -1: delete failed for ${target}\`, fileResult.cause)` (currently fired when `fileResult.outcome === 'failure'`) with `throw new DeleteDidNotTakeEffectError(target, 0, 0)`; remove the `ObsidianApiError` import if it has no remaining consumers in the file
- [X] T016 [US3] Remove the `listingHasName` import from [src/tools/delete-file/handler.ts](src/tools/delete-file/handler.ts) — no longer used after T002 + T015

### Tests for User Story 3

- [X] T017 [P] [US3] Update [tests/tools/delete-file/single-file.test.ts](tests/tools/delete-file/single-file.test.ts): replace the parent-listing-on-timeout verification mock with a direct-path verification mock on the file URL `GET /vault/<filepath>` (with `Accept: text/markdown`); cover BOTH branches of FR-005 — 404 → spec 005 success response with counts `0/0`; 200 → `delete did not take effect: <path> (filesRemoved=0, subdirectoriesRemoved=0)`
- [X] T018 [P] [US3] Update [tests/tools/delete-file/recursive.test.ts](tests/tools/delete-file/recursive.test.ts): switch per-item verification mocks from parent-listing to direct-path on each per-item URL — file URLs without trailing slash, directory URLs with trailing slash; preserve the existing FR-014 iteration-order assertions and the spec 005 consolidated-counts assertion
- [X] T019 [P] [US3] Update [tests/tools/delete-file/partial-failure.test.ts](tests/tools/delete-file/partial-failure.test.ts): switch any per-item verification mocks (where the test exercises a per-item timeout-then-verify) from parent-listing to direct-path on the per-item URL; preserve the spec 005 `child failed: <path> — already deleted: [...]` shape assertion for per-item verified-still-present cases (this stays in `PartialDeleteError`'s shape, distinct from the outer `DeleteDidNotTakeEffectError`)

**Checkpoint**: All three user stories functional. `listingHasName` is gone from the codebase. Single-file, outer-directory, and per-item walk deletes all use the direct-path verification primitive symmetrically.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation against spec 007's success criteria.

- [X] T020 Run `npm run test -- tests/tools/delete-file` from the repository root and confirm all existing + new tests pass; cross-check that FR-007 (auto-prune.test.ts), FR-008 (sibling-preserving.test.ts), FR-009 (timeout-verify.test.ts), FR-010 (auto-prune.test.ts shape pin), FR-011 (verified-still-present.test.ts) each map to a passing assertion
- [X] T021 Run `npm run lint`, `npm run typecheck`, and `npm run build` from the repository root; all three must succeed per Constitution § Development Workflow & Quality Gates 1–3 (the project's tsup build pipeline)
- [X] T022 Determinism check (SC-005) — execute `for i in 1 2 3; do npm run test -- tests/tools/delete-file || break; done`; confirm three consecutive runs pass with identical pass counts
- [ ] T023 Manual schema verification per [quickstart.md](specs/007-fix-delete-verify-direct/quickstart.md) § 3 — boot the built server, issue an MCP `tools/list` request from any client, and confirm the `delete_file` description contains BOTH "When the path refers to a directory, the deletion is recursive" AND "single direct-path verification query"
- [ ] T024 Manual smoke test per [quickstart.md](specs/007-fix-delete-verify-direct/quickstart.md) § 1 — against a real Obsidian vault with the Local REST API plugin enabled, reproduce the bug-report recipe (`1000-Testing-to-be-deleted/issue2-test/` with `file-A.md` and `file-B.md` under an otherwise-empty parent), invoke `delete_file` on `1000-Testing-to-be-deleted/issue2-test`, confirm the response is `{ ok: true, deletedPath: "1000-Testing-to-be-deleted/issue2-test", filesRemoved: 2, subdirectoriesRemoved: 0 }` and a follow-up `list_files_in_vault` shows the parent directory has been auto-pruned

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: empty — no dependencies.
- **Foundational (Phase 2)**: T001 must complete before any user-story task; every story consumes `pathExists`.
- **US1 (Phase 3)**: depends on T001.
- **US2 (Phase 4)**: depends on T001 and on US1 being merged (T007/T008/T009 modify the same handler region as T002 — sequencing avoids merge conflict on `handler.ts`).
- **US3 (Phase 5)**: depends on T001, US1, and US2 (T015 modifies the same `handler.ts` file branch; T016 — dropping the `listingHasName` import — requires both T002 and T015 to have removed all consumer references).
- **Polish (Phase 6)**: depends on US1 + US2 + US3 completion.

### User Story Dependencies

- **US1 (P1)**: independent; uses only the foundational `pathExists` helper.
- **US2 (P1)**: layered on top of US1's handler edits (same file region).
- **US3 (P2)**: layered on top of US2 (final consumer of `listingHasName` is removed in T016).

### Within Each Story

- Source-code edits before associated test-file updates that exercise the new behaviour.
- New test files marked [P] can run in parallel with each other (different files, no shared state).
- Existing test-file updates marked [P] can run in parallel with each other and with new test files.

### Parallel Opportunities

- T002 (`handler.ts` outer-dir verify) and T003 (`tool.ts` description text) modify different files → can run in parallel.
- T004 (`auto-prune.test.ts`), T005 (`sibling-preserving.test.ts`), T006 (`registration.test.ts`) all touch different files → can run in parallel with each other and with T002/T003.
- T010 (`verified-still-present.test.ts`) and T011 (`timeout-verify.test.ts`) touch different files → can run in parallel.
- T017 (`single-file.test.ts`), T018 (`recursive.test.ts`), T019 (`partial-failure.test.ts`) touch different files → can run in parallel.
- T012/T013/T014 all modify `recursive-delete.ts` → must run sequentially.
- T007 (`verify-then-report.ts`) and T008/T009 (`handler.ts`) modify different files → can run in parallel.
- T015/T016 both modify `handler.ts` → must run sequentially.

---

## Parallel Example: User Story 1

```bash
# After T001 (foundational pathExists) lands, the following four tasks can run in parallel:
Task: "Update tool description text in src/tools/delete-file/tool.ts"
Task: "Create new test tests/tools/delete-file/auto-prune.test.ts"
Task: "Create new test tests/tools/delete-file/sibling-preserving.test.ts"
Task: "Update tests/tools/delete-file/registration.test.ts to assert both description phrases"

# T002 (handler.ts) runs in this same wave but is sequenced before US2's T007/T008/T009 in the same file.
```

---

## Parallel Example: User Story 2

```bash
# T007 and T008/T009 touch different files and can run in parallel:
Task: "Add DeleteDidNotTakeEffectError class to src/tools/delete-file/verify-then-report.ts"
Task: "Replace outer-directory failure throw + add catch translation in src/tools/delete-file/handler.ts"

# Tests run in parallel after source edits:
Task: "Create new test tests/tools/delete-file/verified-still-present.test.ts"
Task: "Update tests/tools/delete-file/timeout-verify.test.ts to use direct-path mocks"
```

---

## Parallel Example: User Story 3

```bash
# T012 → T013 → T014 sequential on recursive-delete.ts.
# T015 → T016 sequential on handler.ts.
# After source is in place, all three test updates run in parallel:
Task: "Update tests/tools/delete-file/single-file.test.ts to direct-path verification mocks"
Task: "Update tests/tools/delete-file/recursive.test.ts to direct-path verification mocks"
Task: "Update tests/tools/delete-file/partial-failure.test.ts to direct-path verification mocks"
```

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 2 — both P1)

US1 and US2 are both labelled P1 in [spec.md](specs/007-fix-delete-verify-direct/spec.md), and US2's verified-still-present path closes a correctness gap that US1 alone leaves open: after T002 only, an outer DELETE timeout + verify=200 would surface as the legacy `child failed: <target>` shape, contradicting FR-003's "**never** the `child failed: <path>` shape". The MVP therefore bundles both P1 stories.

1. Phase 2: T001 (foundational `pathExists` helper).
2. Phase 3: T002–T006 (US1 — outer-dir verify-callback switch + tool description update + auto-prune + sibling-preserving + registration assertion).
3. Phase 4: T007–T011 (US2 — `DeleteDidNotTakeEffectError` + outer-dir failure throw + catch translation + verified-still-present + timeout-verify update).
4. **STOP and validate**: run `npm run test -- tests/tools/delete-file/auto-prune.test.ts tests/tools/delete-file/sibling-preserving.test.ts tests/tools/delete-file/verified-still-present.test.ts tests/tools/delete-file/timeout-verify.test.ts tests/tools/delete-file/registration.test.ts`; reproduce the bug-report recipe manually per [quickstart.md](specs/007-fix-delete-verify-direct/quickstart.md) § 1 and confirm the success response.
5. The MVP closes the headline bug AND satisfies FR-003 unconditionally. Spec 005's existing tests for the file branch and per-item walk continue to pass against the legacy parent-listing helper until US3 migrates them.

### Incremental Delivery

1. Foundational + US1 + US2 → MVP, ship. Both P1 stories land together; the outer-directory delete cleanly distinguishes success / `delete did not take effect` / `outcome undetermined`.
2. Add US3 → applies direct-path verification symmetrically to single-file and per-item walk; removes dead `listingHasName` → ship.
3. Phase 6 polish runs after US3 merges.

### Parallel Team Strategy

US1 and US2 both touch `handler.ts`'s outer-directory region; they must be sequenced. US3 touches `recursive-delete.ts` (independent file) and the file-branch of `handler.ts` (sequential after US1/US2). With two developers:

- Dev A: US1 → US2 (sequential on `handler.ts`).
- Dev B: starts US3's `recursive-delete.ts` work (T012–T014) in parallel with Dev A; pauses at T015 until Dev A finishes US2; then resumes T015–T019.

---

## Notes

- [P] tasks = different files, no sequential dependencies.
- [Story] label maps each task to the user story it serves (US1 / US2 / US3).
- Tests are required by spec FRs (FR-007 / FR-008 / FR-009 / FR-010 / FR-011), not optional.
- The handler error-translation order matters — `DeleteDidNotTakeEffectError` (T009) must precede the `OutcomeUndeterminedError` branch in the catch block per [data-model.md](specs/007-fix-delete-verify-direct/data-model.md) § Handler error translation table.
- Files touched in `src/`: `verify-then-report.ts` (T001, T007), `handler.ts` (T002, T008, T009, T015, T016), `recursive-delete.ts` (T012, T013, T014), `tool.ts` (T003). No new source files added.
- Files touched in `tests/`: three new files (`auto-prune.test.ts`, `sibling-preserving.test.ts`, `verified-still-present.test.ts`), six updated files (`registration.test.ts`, `single-file.test.ts`, `recursive.test.ts`, `partial-failure.test.ts`, `timeout-verify.test.ts`, plus the new ones above).
- `not-found.test.ts` is intentionally NOT updated — type-detection still uses parent-listing per spec 007 contract category 2 (the verification refactor only touches the post-timeout path).
- Commit after each task or logical group (`.specify/extensions.yml` configures an optional `after_tasks` auto-commit hook).
