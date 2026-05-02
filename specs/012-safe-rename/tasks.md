---
description: "Task list for 012-safe-rename: rename_file MCP tool — Option B"
---

# Tasks: Safe Rename Tool (`rename_file`) — Option B

**Input**: Design documents from `specs/012-safe-rename/`
**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required for user stories), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/rename_file.md](./contracts/rename_file.md), [quickstart.md](./quickstart.md)

**Status**: Documentation pivot complete (Option-B redesign per T002 spike outcome). Implementation gated on Tier 2 backlog item 25 (`find_and_replace`) shipping first per FR-013 / [research.md §R12](./research.md).

**Tests**: REQUIRED, not optional. Constitution Principle II ("Public Tool Test Coverage") is **NON-NEGOTIABLE** for this project: every registered MCP tool MUST have at least one happy-path test and at least one input-validation/upstream-error test, and those tests MUST land in the same change as the tool. The minimum test surface for this feature is enumerated in [contracts/rename_file.md §"Test-coverage contract"](./contracts/rename_file.md) — 6 registration tests + ~10 regex-pass tests + 7 handler tests.

**Organization**: Tasks are grouped by user story (US1, US2, US3) plus the Option-B-specific cross-cutting tasks. Many tasks are marked **DEFERRED — gated on item 25**; those wait for the upstream `rest.findAndReplace` helper to ship before they can be implemented.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All paths are repository-relative

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root (per [plan.md §"Project Structure"](./plan.md))

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Create empty directories `src/tools/rename-file/` and `tests/tools/rename-file/` at the repo root.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Status**: SPIKE EXECUTED — NEGATIVE OUTCOME — drove the Option-B pivot.

- [X] T002 Run the pre-implementation feasibility spike per [quickstart.md Part 1](./quickstart.md). **Outcome (2026-05-02): NEGATIVE.** Neither `workspace:edit-file-title` nor `file-explorer:move-file` performs a programmatic rename when dispatched headlessly via `POST /commands/{commandId}/`; both open Obsidian UI inputs. No body shape works. The user chose **Option B** as the recovery path: replace the Obsidian-command dispatch with wrapper-side composition over filesystem primitives + `find_and_replace` (Tier 2 backlog item 25). See [research.md §R5](./research.md) for the full result and [spec.md §Clarifications "post-spike"](./spec.md) for the design pivot. Restoring the Obsidian-managed approach is captured as backlog item 28 (deferred; pending upstream plugin enhancement; out of project control).

**Checkpoint**: Spike resolved with Option-B redesign. The documentation-pivot tasks (this commit) follow. Implementation tasks marked **DEFERRED — gated on item 25** wait for the `find_and_replace` feature to ship and merge to main.

---

## Phase 3: User Story 1 - Rename a file and keep every wikilink intact (Priority: P1) 🎯 MVP

**Goal**: A caller invokes `rename_file(old_path, new_path)` and the wrapper performs the multi-step composition (3 pre-flight checks → read source → write destination → 3 or 4 `find_and_replace` passes → delete source), returning a structured success response that names the passes that ran and the per-pass rewrite counts.

**Independent Test**: Per [quickstart.md Part 2 Step 3](./quickstart.md) (single-folder rename) and [Step 4](./quickstart.md) (cross-folder rename, exercising Pass D). Both run against a real Obsidian instance with the vault on a clean git working tree.

### Implementation for User Story 1

- [X] T003 [P] [US1] `src/tools/rename-file/schema.ts` — UNCHANGED for Option B. The `RenameFileRequestSchema` (`old_path`, `new_path`, optional `vaultId`) is identical between Option A and Option B. Already shipped in commit `bebe709`.
- [X] T004 [P] [US1] `src/tools/rename-file/tool.ts` — DESCRIPTION REWRITTEN for Option B. The tool registration now ships the Option-B description text per [contracts/rename_file.md §"Description text"](./contracts/rename_file.md), pinning four substrings: multi-step/non-atomic, clean git working tree, wikilink shape coverage, and irrelevance of the Obsidian "Automatically update internal links" setting. Updated in this Option-B documentation pivot commit.
- [ ] T004a [P] [US1] **NEW under Option B.** `src/tools/rename-file/regex-passes.ts` — exports `escapeRegex(str: string): string` and four pass-builder functions (`buildPassA({oldBasename, newBasename})`, `buildPassB(...)`, `buildPassC(...)`, `buildPassD({oldBasename, newBasename, oldFolder, newFolder})`) per the templates in [contracts/rename_file.md §"Composition algorithm" step 6](./contracts/rename_file.md). Each builder returns `{pattern: string, replacement: string}`. Spike-independent and ships in this Option-B documentation pivot commit (the regex correctness can be pinned by hermetic tests before the handler exists).
- [ ] T005 [US1] **DEFERRED — gated on item 25.** `src/tools/rename-file/handler.ts` per the pseudocode in [contracts/rename_file.md §"Behavioural contract"](./contracts/rename_file.md). The handler imports `rest.findAndReplace` from the per-vault `ObsidianRestService` (provided by Tier 2 backlog item 25 / FR-013), composes the 8-step algorithm (`pre_flight_source` → `pre_flight_destination` → `pre_flight_parent` → `read_source` → `write_destination` → `find_and_replace_pass_A`/`_B`/`_C` and conditionally `_D` → `delete_source`), and returns either the FR-011 success structure or the FR-015 mid-flight failure structure. **Cannot start until item 25 has shipped to main.** Depends on T003, T004, T004a.
- [ ] T006-restore [US1] **DEFERRED — gated on T005.** Re-add `...RENAME_FILE_TOOLS` to the `ALL_TOOLS` array in `src/tools/index.ts`. Currently un-wired (per the "no false advertisement" principle — see [plan.md §"Project Structure"](./plan.md)) so the tool isn't visible in `tools/list` until the handler exists. Trivial one-line edit when the handler ships.
- [ ] T007 [US1] **DEFERRED — gated on T005.** Add `case 'rename_file': return handleRenameFile(args, rest);` to the dispatcher switch in `src/index.ts`, in alphabetical/grouping order with the other recent tools. Imports `handleRenameFile` from `./tools/rename-file/handler.js`.

### Tests for User Story 1 (REQUIRED — Constitution Principle II) ⚠️

> Write these tests FIRST or in parallel with the implementation, NOT after. Verify each test FAILS in the absence of its corresponding implementation task before marking it green.

- [ ] T004b [P] [US1] **NEW under Option B.** `tests/tools/rename-file/regex-passes.test.ts` — hermetic tests for each of Passes A, B, C, D against synthetic strings, plus tests for `escapeRegex` itself. Covers the ~10 test cases enumerated in [contracts/rename_file.md §"Test-coverage contract"](./contracts/rename_file.md) under `regex-passes.test.ts`. Spike-independent and ships in this Option-B documentation pivot commit. The tests construct each pass's regex using `buildPassN` helpers, then `String.prototype.replace`-test against handcrafted before/after pairs.
- [ ] T008 [P] [US1] **DEFERRED — gated on T005.** Create `tests/tools/rename-file/handler.test.ts` with the **happy-path** test: build a mocked `ObsidianRestService` with vi-spy `getFileContents`, `putContent`, `listFilesInDir`, `findAndReplace`, `deleteFile` that resolve in algorithm order; call `handleRenameFile({old_path: "notes/alpha.md", new_path: "notes/beta.md"}, mockRest)`; assert all 5 methods were called in algorithm order with the right arguments, and the returned `CallToolResult` content matches the FR-011 success shape including non-empty `wikilinkPassesRun` and the per-pass `wikilinkRewriteCounts`.
- [ ] T009 [US1] **DEFERRED — gated on T005.** Add the **FR-009 no-op test** to `handler.test.ts`: identical paths → empty `wikilinkPassesRun`, all `wikilinkRewriteCounts` null, zero REST calls.
- [ ] T010 [US1] **DEFERRED — gated on T005.** Add the **validation-error test** to `handler.test.ts`: missing `old_path` → throws `Invalid input — old_path: …`.

### Manual end-to-end verification for User Story 1

- [ ] T011 [US1] **DEFERRED — gated on T005, T006-restore, T007.** Run [quickstart.md](./quickstart.md) Part 2 Steps 1, 2, 3, 4 against a real Obsidian instance with TestVault on a clean git working tree.

**Checkpoint**: User Story 1 functional once item 25 ships and T005/T006-restore/T007 land. The documentation pivot in this commit is the prep work; the runtime work waits.

---

## Phase 4: User Story 2 - Refuse to rename when the target already exists (Priority: P2)

**Goal**: When the rename would collide with an existing file, the source doesn't exist, or the destination's parent folder is missing, the tool returns a clear error and the vault is byte-for-byte unchanged. Per the Q1 supersession (Clarifications session, post-spike), the collision check (FR-006) is now wrapper-side and constructs its own error message; the source-missing (FR-007) and parent-missing (FR-012) checks remain pure delegation.

**Independent Test**: Per [quickstart.md Part 2 Steps 5, 6, 7, 8](./quickstart.md).

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T012 [P] [US2] **DEFERRED — gated on T005.** **FR-006 collision** test in `handler.test.ts`: mock step 2 (`getFileContents` on `new_path`) to return 200; assert handler throws wrapper-constructed `"destination already exists: <new_path>"` error AND no subsequent REST calls (`putContent`, `findAndReplace`, `deleteFile` all NOT called).
- [ ] T013 [US2] **DEFERRED — gated on T005.** **FR-007 source-missing** test in `handler.test.ts`: mock step 1 (`getFileContents` on `old_path`) to throw `ObsidianNotFoundError`; assert propagation, assert no subsequent REST calls.
- [ ] T013a [P] [US2] **FR-010 out-of-vault** test in `handler.test.ts`: mock step 1 to reject for an `old_path` of `"../escape.md"`; assert propagation, assert no subsequent REST calls. **DEFERRED — gated on T005.**
- [ ] T013b [US2] **NEW under Option B. DEFERRED — gated on T005.** **FR-012 parent-missing** test in `handler.test.ts`: mock step 3 (`listFilesInDir` on `dirname(new_path)`) to throw 404; assert propagation, assert no `putContent`/`findAndReplace`/`deleteFile` calls.
- [ ] T013c [US2] **NEW under Option B. DEFERRED — gated on T005.** **FR-015 mid-flight failure** test in `handler.test.ts`: mock `findAndReplace` to throw on Pass B; assert response is `{ok: false, failedAtStep: "find_and_replace_pass_B", partialState: {destinationWritten: true, passesCompleted: ["A"], sourceDeleted: false}, error: <upstream message>}` — the partial-state contract from FR-015.

### Manual end-to-end verification for User Story 2

- [ ] T014 [US2] **DEFERRED — gated on T005, T006-restore, T007.** Run [quickstart.md Part 2 Steps 5, 6, 7, 8, 11](./quickstart.md): collision rejection, source-missing rejection, folder rejection, missing-parent rejection, mid-flight failure observation (Step 11 is the new partial-state verification).

---

## Phase 5: User Story 3 - Make the precondition + integrity contract discoverable (Priority: P2)

**Goal**: An MCP-aware agent reading the tool catalogue can identify the operational contract (multi-step / non-atomic, git-clean precondition, wikilink shape coverage, setting-irrelevance) from the description alone. The description text was shipped in T004 (already in commit `bebe709`, rewritten for Option B in this commit); this phase pins it via registration tests.

**Independent Test**: Per [quickstart.md Part 2 Step 2](./quickstart.md) — inspect `tools/list` output and verify the four substrings are present.

### Tests for User Story 3 (REQUIRED) ⚠️

- [X] T015 [P] [US3] `tests/tools/rename-file/registration.test.ts` — **PINNED SUBSTRINGS REWRITTEN** for Option B. Now imports `RENAME_FILE_TOOLS` directly (decoupled from `ALL_TOOLS` since the latter no longer includes it during the documentation pivot). Six tests covering the registration shape + four description substrings per [contracts/rename_file.md §"Test-coverage contract"](./contracts/rename_file.md):
  - "RENAME_FILE_TOOLS exports exactly one entry named rename_file"
  - "inputSchema is the zod-to-json-schema derivative of RenameFileRequestSchema"
  - "description discloses the multi-step / non-atomic nature" (pins `"multi-step and not atomic"`)
  - "description discloses the git-clean precondition" (pins `"clean git working tree"`)
  - "description discloses the wikilink shape coverage" (pins `"Wikilink shape coverage"` heading)
  - "description discloses irrelevance of the Obsidian setting" (pins `"Automatically update internal links" setting is irrelevant`)

  Updated in this Option-B documentation pivot commit.

### Manual end-to-end verification for User Story 3

- [ ] T016 [US3] **DEFERRED — gated on T006-restore.** Run [quickstart.md Part 2 Step 2](./quickstart.md): inspect `tools/list` against the running server. (Currently the tool is un-wired from `ALL_TOOLS` per "no false advertisement" — `tools/list` won't return it. Verification waits for T006-restore.)

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T017 [P] **Partially satisfied by this commit; full re-run gated on T005.** Run all four Constitution Quality Gates locally and confirm green: `npm run lint && npm run typecheck && npm run build && npm test`. The Option-B documentation pivot commit runs lint + typecheck + tests after the in-this-commit code changes (description rewrite, regex-passes module + tests, registration test rewrite, ALL_TOOLS un-wire); a full re-run waits for T005.
- [ ] T017a [P] **NEW under Option B (replaces the Option-A SC-005 import-guard).** Add an **SC-005 markdown-AST import guard** test to `tests/tools/rename-file/handler.test.ts` (DEFERRED — gated on T005): read `src/tools/rename-file/handler.ts` from disk via `readFileSync` and assert it does NOT import any of: `marked`, `unified`, `remark`, `rehype`, `mdast-util-*`, `micromark`, `node-html-parser`, or any equivalent markdown-AST / HTML-parser library. The Option-A version of this guard forbade `getFileContents`/`putContent`/`appendContent`/`patchContent` imports — those are now legitimate dependencies under Option B per the SC-005 rewrite (spec.md), so the guard narrows to forbid only the markdown-parser-dependency surface (research §B2 in the user's resolution).
- [ ] T018 **DROPPED — irrelevant under Option B.** The original Option-A regression check (toggling the "Automatically update internal links" setting off and verifying that the rename still succeeds but wikilinks are NOT rewritten) was a verification of the FR-005 precondition under Option A. Under Option B, that setting is irrelevant — the wrapper's `find_and_replace` passes do the rewriting regardless. The replacement check is [quickstart.md Part 2 Step 12](./quickstart.md) ("setting-irrelevance regression check"), which verifies the inverse: that toggling the setting off has NO effect on Option-B's behaviour. Renamed as a documentation note under Step 12 rather than its own task.
- [ ] T019 In the PR description for this branch, include a one-line Constitution compliance statement per the constitution's Governance section (e.g., `Constitution: Principles I–IV considered; the Q1 supersession for FR-006 is documented in spec Clarifications; no other deviations.`), plus a link to [specs/012-safe-rename/](./).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — completed (T001).
- **Foundational (Phase 2)**: T002 spike done (negative outcome). Resolution = Option B. **Blocks all implementation tasks** that depend on `rest.findAndReplace` until Tier 2 backlog item 25 ships and merges to main.
- **User Story 1 (Phase 3)**: T003 (✓), T004 (✓ description rewritten in this commit), T004a (NEW, ships in this commit), T004b (NEW, ships in this commit). T005, T006-restore, T007 deferred until item 25.
- **User Story 2 (Phase 4)**: All test tasks deferred until T005 lands. The mock structures depend on the handler signature being final.
- **User Story 3 (Phase 5)**: T015 ships in this commit (pinned substrings rewritten + decoupled from `ALL_TOOLS`). T016 deferred until T006-restore.
- **Polish (Phase 6)**: T017 partially runs in this commit; full run after T005. T017a deferred until T005. T018 dropped. T019 PR description.

### Within User Story 1 (Option-B-revised)

- T003 (schema) is unchanged — already shipped.
- T004 (tool.ts description rewrite) is independent of T004a (regex-passes.ts) — different files.
- T004a (regex-passes.ts) is independent of T004b (regex-passes.test.ts) at write time — different files.
- T005 (handler) depends on T003, T004, T004a, AND on item 25 having shipped (`rest.findAndReplace` available).
- T006-restore depends on T005 having landed (tool actually does something before being re-advertised).
- T007 depends on T005 (need handler to import).
- T011 (manual quickstart) depends on T005 + T006-restore + T007 (full e2e path).

### Item 25 dependency (FR-013, research §R12)

The handler imports `rest.findAndReplace` as a static module dependency. Until Tier 2 backlog item 25 has shipped and merged to main, the handler cannot be written or tested. The documentation pivot in this commit is fully complete in itself — the spec, plan, contracts, data-model, quickstart, and tasks accurately describe Option B — but the runtime work waits.

### Parallel Opportunities

- This Option-B documentation pivot commit: T004 description rewrite || T004a regex-passes.ts || T004b regex-passes.test.ts || T015 registration.test.ts rewrite — four different files, all spike-independent, all independent of each other at write time.
- Once item 25 ships: T005 (handler) sequential; then T008 / T009 / T010 / T012 / T013 / T013a / T013b / T013c are all in `handler.test.ts` — sibling tests that can be authored in any order but live in the same file.

---

## Implementation Strategy

### Documentation pivot first (this commit)

1. T001 ✓, T002 ✓ (negative outcome).
2. Apply the Option-B documentation pivot across spec.md, plan.md, research.md, contracts/, data-model.md, quickstart.md, tasks.md, checklists/requirements.md.
3. Apply the spike-independent code work: T004 description rewrite, T004a (NEW regex-passes.ts), T004b (NEW regex-passes.test.ts), T015 (registration.test.ts rewrite + decouple from ALL_TOOLS), un-wire `RENAME_FILE_TOOLS` from `ALL_TOOLS` per "no false advertisement."
4. Run lint + typecheck + tests; verify green.
5. Commit as a single `docs(012)` (or `feat(012)` — refactor judgment) capturing the entire pivot.

### Implementation phase (deferred until item 25 ships)

1. Wait for item 25 (`find_and_replace`) feature branch to merge to main.
2. T005 — write `handler.ts` against the now-importable `rest.findAndReplace`.
3. T006-restore + T007 — re-wire `ALL_TOOLS` and add the dispatcher case.
4. T008 / T009 / T010 / T012 / T013 / T013a / T013b / T013c / T017a — author all the handler tests in one or two commits.
5. T011 / T014 / T016 — manual quickstart steps against TestVault.
6. T017 — full quality gates re-run.
7. T019 — PR description.

### Single-Developer Sequential Strategy

Documentation pivot phase (this commit, sequential within the commit):
- spec.md → plan.md → research.md → contracts/rename_file.md → data-model.md → quickstart.md → tasks.md → checklists/requirements.md → tool.ts description → regex-passes.ts → regex-passes.test.ts → registration.test.ts → src/tools/index.ts un-wire → run gates → commit.

Implementation phase (after item 25 ships):
- T005 → (T008 || T009 || T010 || T012 || T013 || T013a || T013b || T013c || T017a) → T006-restore → T007 → (T011 || T014 || T016) → T017 → T019.

---

## Notes

- **[P] tasks** = different files, no dependencies on incomplete tasks.
- **[Story] label** maps task to its user story for traceability and per-commit grouping.
- **Tests are required, not optional** — Constitution Principle II is non-negotiable.
- **Item 25 dependency is load-bearing** — the handler simply cannot exist without `rest.findAndReplace`. Per FR-013 / research §R12, this is a build-time dependency; there is no runtime feature-detect.
- **The Q1 supersession is bounded** — only FR-006 (collision check) deviates from pure delegation. FR-007 / FR-008 / FR-010 / FR-012 all still propagate upstream errors verbatim. The single deviation is documented in spec.md Clarifications as an explicit Q1-supersession entry.
- **Mid-flight atomicity is explicitly best-effort** (FR-015). The wrapper performs no automated recovery. The git-clean precondition (FR-005(b)) is the rollback baseline.
- **Commit per task or per logical group**, not per phase — granular commits make rollback safe.
- **Avoid**: importing markdown-AST libraries (SC-005); inventing a runtime tool-registry abstraction (research §R12); silent overwrite of the destination (FR-006 / Q1 supersession); auto-creating parent folders (FR-012 / Q3); attempting reverse-direction recovery for mid-flight failures (research §R11). All five are explicit anti-patterns from the Option-B redesign.
