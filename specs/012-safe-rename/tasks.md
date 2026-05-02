---
description: "Task list for 012-safe-rename: rename_file MCP tool"
---

# Tasks: Safe Rename Tool (`rename_file`)

**Input**: Design documents from `specs/012-safe-rename/`
**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required for user stories), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/rename_file.md](./contracts/rename_file.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED, not optional. Constitution Principle II ("Public Tool Test Coverage") is **NON-NEGOTIABLE** for this project: every registered MCP tool MUST have at least one happy-path test and at least one input-validation/upstream-error test, and those tests MUST land in the same change as the tool. The minimum test surface for this feature is enumerated in [contracts/rename_file.md §"Test-coverage contract"](./contracts/rename_file.md).

**Organization**: Tasks are grouped by user story (US1, US2, US3) to enable independent demonstration. Note: because all three stories share a single tool module (one `tool.ts`, one `handler.ts`, one `schema.ts`), the *code* is delivered in US1; US2 and US3 each add **test coverage** that pins behaviour US1 already exhibits. This is intentional — see "Implementation Strategy" below.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All paths are repository-relative

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root (per [plan.md §"Project Structure"](./plan.md))

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the empty module skeleton so subsequent tasks have somewhere to write.

- [ ] T001 Create empty directories `src/tools/rename-file/` and `tests/tools/rename-file/` at the repo root. (No files yet — those are created by later tasks.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Resolve the one external unknown that everything else depends on.

**⚠️ CRITICAL**: T002 BLOCKS all user-story phases. Do not start US1 implementation tasks until T002 has produced a working `RENAME_COMMAND_ID` (and request-body shape, if applicable).

- [ ] T002 Run the pre-implementation feasibility spike per [quickstart.md Part 1](./quickstart.md). Confirms: (a) the exact Obsidian command id for "Rename file" against the project's `coddingtonbear/obsidian-local-rest-api` plugin, and (b) that `POST /commands/{commandId}` actually performs a programmatic rename (not just a UI modal) and triggers wikilink rewriting. **Pass criteria**: one command id + body shape produces an on-disk rename AND rewrites `notes/index.md` wikilinks. **Fail action**: stop and escalate to user before T003 — do NOT write handler code. **Output to capture**: the working `commandId` and any required request-body shape (record in PR comment or temporary `specs/012-safe-rename/spike-results.md`; this becomes the `RENAME_COMMAND_ID` constant in T005). Performed manually against a real Obsidian instance with the Local REST API plugin enabled.

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 - Rename a file and keep every wikilink intact (Priority: P1) 🎯 MVP

**Goal**: A caller invokes `rename_file(old_path, new_path)` and Obsidian renames the file while rewriting every `[[wikilink]]` and `![[embed]]` referencing the old name. This phase delivers the entire functional pipeline; subsequent phases add test coverage that pins additional contracts but ship no new runtime code.

**Independent Test**: With the Obsidian "Automatically update internal links" setting ON, set up a vault containing `notes/alpha.md` plus `notes/index.md` whose body is `See [[alpha]] for details.`; invoke `rename_file({old_path: "notes/alpha.md", new_path: "notes/beta.md"})`; assert `notes/beta.md` exists, `notes/alpha.md` does not, and `notes/index.md` now reads `See [[beta]] for details.` (Spec User Story 1, Acceptance Scenario 1.)

### Implementation for User Story 1

- [ ] T003 [P] [US1] Create `src/tools/rename-file/schema.ts` with the zod schema `RenameFileRequestSchema` (`old_path: z.string().trim().min(1)`, `new_path: z.string().trim().min(1)`, `vaultId: z.string().trim().optional()`) and the boundary helper `assertValidRenameFileRequest(args: unknown): RenameFileRequest`. Mirror the structure of [src/tools/list-tags/schema.ts](../../src/tools/list-tags/schema.ts). Schema field text MUST match the descriptions in [contracts/rename_file.md §"Input schema (zod)"](./contracts/rename_file.md).
- [ ] T004 [P] [US1] Create `src/tools/rename-file/tool.ts` exporting `RENAME_FILE_TOOLS: Tool[]` with one entry. The `inputSchema` MUST be derived from `RenameFileRequestSchema` via `zodToJsonSchema(..., { $refStrategy: 'none' })` (Constitution Principle III — single source of truth). The `description` field MUST contain verbatim the text in [contracts/rename_file.md §"Description text (verbatim, including the precondition)"](./contracts/rename_file.md), including all four pinned substrings: `"Automatically update internal links"`, `"Settings → Files & Links"`, `"Folder paths are out of scope"`, `"Missing parent folders are not auto-created"`. Mirror [src/tools/list-tags/tool.ts](../../src/tools/list-tags/tool.ts).
- [ ] T005 [US1] Create `src/tools/rename-file/handler.ts` with `handleRenameFile(args: unknown, rest: ObsidianRestService): Promise<CallToolResult>` per the pseudocode in [contracts/rename_file.md §"Behavioural contract"](./contracts/rename_file.md). Hardcode the `RENAME_COMMAND_ID` constant captured in T002. Flow: zod parse (rethrow ZodError as plain Error with field path inlined, matching [src/tools/list-tags/handler.ts](../../src/tools/list-tags/handler.ts)) → if `old_path === new_path` short-circuit with success response (FR-009) → `await rest.openFile(old_path)` (R3 in research.md) → `await rest.executeCommand(RENAME_COMMAND_ID)` with whatever body shape T002 confirmed → return JSON-echo `{old_path, new_path}` in a single text content block. NO try/catch around the REST calls (`openFile`, `executeCommand`); the **only** allowed catch is the zod-parse re-throw shown in the contract pseudocode (Q1 / Principle IV). Depends on T002, T003.
- [ ] T006 [US1] Wire the new tool into the aggregation by adding `...RENAME_FILE_TOOLS` to the `TOOLS` export in `src/tools/index.ts`. Match the existing pattern (alphabetical or insertion-order — follow what's already there).
- [ ] T007 [US1] Add a `case 'rename_file': return handleRenameFile(args, rest);` branch to the dispatcher switch in `src/index.ts`, in the same alphabetical/grouping position used by other recent tools (look for the `case 'list_tags':` or similar nearby example). Import `handleRenameFile` from `./tools/rename-file/handler.js`.

### Tests for User Story 1 (REQUIRED — Constitution Principle II) ⚠️

> Write these tests FIRST or in parallel with the implementation, NOT after. Verify each test FAILS in the absence of its corresponding implementation task before marking it green.

- [ ] T008 [P] [US1] Create `tests/tools/rename-file/handler.test.ts` with the **happy-path** test: build a mocked `ObsidianRestService` with vi-spy `openFile` and `executeCommand` that resolve to undefined; call `handleRenameFile({old_path: "notes/alpha.md", new_path: "notes/beta.md"}, mockRest)`; assert `mockRest.openFile` was called once with `"notes/alpha.md"`, `mockRest.executeCommand` was called once with the `RENAME_COMMAND_ID` constant (and any expected body shape), and the returned `CallToolResult` content matches the JSON `{ "old_path": "notes/alpha.md", "new_path": "notes/beta.md" }` shape from [contracts/rename_file.md §"Output: success"](./contracts/rename_file.md). Use `vitest`'s `describe`/`it`/`expect` and `vi.fn()`. Reference [tests/tools/](../../tests/tools/) for established mocking patterns in this repo.
- [ ] T009 [US1] Add the **FR-009 no-op test** to `tests/tools/rename-file/handler.test.ts`: with the same mocked `rest`, call `handleRenameFile({old_path: "x.md", new_path: "x.md"}, mockRest)`; assert the response echoes both fields as `"x.md"` AND that neither `mockRest.openFile` nor `mockRest.executeCommand` was invoked (`expect(mockRest.openFile).not.toHaveBeenCalled()`).
- [ ] T010 [US1] Add the **validation-error test** to `tests/tools/rename-file/handler.test.ts`: call `handleRenameFile({}, mockRest)`; assert it throws an `Error` whose message matches `/^Invalid input — old_path: /`. This pins the zod re-throw shape used by the dispatcher's outer error handler.

### Manual end-to-end verification for User Story 1

- [ ] T011 [US1] Run [quickstart.md](./quickstart.md) Part 2 Steps 1, 3, 7, 8 against a real Obsidian instance: confirm description (Step 2 covered in US3), happy path with wikilink rewriting (Step 3), idempotent no-op (Step 7), validation failure (Step 8).

**Checkpoint**: User Story 1 is fully functional. The MVP is shippable here — US2 and US3 add test coverage that pins additional contract surface but no new runtime behaviour.

---

## Phase 4: User Story 2 - Refuse to rename when the target already exists (Priority: P2)

**Goal**: When the rename would collide with an existing file or the source doesn't exist, the tool returns an error and the vault is byte-for-byte unchanged. Per Q1 (pure delegation), this behaviour is inherited from Obsidian's command failure path; this phase pins it with tests.

**Independent Test**: In a vault containing `a.md` and `b.md`, invoke `rename_file({old_path: "a.md", new_path: "b.md"})`; assert the tool returns an error AND both files are still on disk byte-for-byte unchanged. (Spec User Story 2.)

### Tests for User Story 2 (REQUIRED — Constitution Principle II) ⚠️

- [ ] T012 [P] [US2] Add the **failure-path propagation** test to `tests/tools/rename-file/handler.test.ts`: mock `rest.executeCommand` to reject with an `ObsidianApiError` (or other typed upstream error from `src/services/obsidian-rest-errors.ts`); call the handler with valid inputs; assert the handler does NOT catch the error and the rejection propagates to the test (`await expect(handleRenameFile(...)).rejects.toThrow(ObsidianApiError)`). This is the explicit test for Constitution Principle IV / spec Q1.
- [ ] T013 [US2] Add the **folder-rejection by delegation** test to `tests/tools/rename-file/handler.test.ts`: mock `rest.openFile` to reject with an `ObsidianApiError` (simulating Obsidian's response when `old_path` is a folder); call the handler; assert the rejection propagates and `rest.executeCommand` was NEVER called (`expect(mockRest.executeCommand).not.toHaveBeenCalled()`). Verifies the R6 design choice: no pre-flight folder check, no partial state.
- [ ] T013a [P] [US2] Add the **out-of-vault propagation** test to `tests/tools/rename-file/handler.test.ts`: mock `rest.openFile` to reject with an `ObsidianApiError` (simulating Obsidian's response when the path contains `..` or is absolute); call the handler with `{old_path: "../escape.md", new_path: "x.md"}`; assert the rejection propagates and `rest.executeCommand` was NEVER called. Verifies FR-010 by delegation per [data-model.md](./data-model.md) §"Out-of-scope validation rules". (Same shape as T013 but exercises a different rejection cause; the handler treats both identically.)

### Manual end-to-end verification for User Story 2

- [ ] T014 [US2] Run [quickstart.md](./quickstart.md) Part 2 Steps 4, 5, 6 against a real Obsidian instance: collision rejection (Step 4), folder rejection (Step 5), missing-parent-folder rejection (Step 6). Confirm that in all three cases the vault is unchanged.

**Checkpoint**: User Stories 1 and 2 both work and are independently verifiable.

---

## Phase 5: User Story 3 - Make the link-integrity precondition discoverable (Priority: P2)

**Goal**: An MCP-aware agent reading `tools/list` can identify, from the tool description alone, that wikilink integrity depends on Obsidian's "Automatically update internal links" setting being enabled. The description text was shipped in T004 (US1); this phase adds the regression test that pins it.

**Independent Test**: Inspect the MCP tool list (`tools/list` against the running server). Confirm the `rename_file` description text contains `"Automatically update internal links"` and `"Settings → Files & Links"`. (Spec User Story 3.)

### Tests for User Story 3 (REQUIRED — Constitution Principle II) ⚠️

- [ ] T015 [P] [US3] Create `tests/tools/rename-file/registration.test.ts` that imports `RENAME_FILE_TOOLS` and asserts the `description` field of the `rename_file` entry contains all four pinned substrings (separately, in three named tests per [contracts/rename_file.md §"Test-coverage contract"](./contracts/rename_file.md)):
  - Test "description includes the link-update precondition" — asserts `description` contains both `"Automatically update internal links"` AND `"Settings → Files & Links"`.
  - Test "description includes the folder-out-of-scope clause" — asserts `description` contains `"Folder paths are out of scope"`.
  - Test "description includes the no-auto-create clause" — asserts `description` contains `"Missing parent folders are not auto-created"`.

  Mirror the structure of any existing `tests/tools/<name>/registration.test.ts` if one exists; otherwise pattern-match on the project's vitest conventions.

### Manual end-to-end verification for User Story 3

- [ ] T016 [US3] Run [quickstart.md](./quickstart.md) Part 2 Step 2 against the running server: call `tools/list` from any MCP client and visually confirm the `rename_file` description carries all four pinned substrings.

**Checkpoint**: All three user stories are independently verifiable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Constitution Quality Gates 1–4 plus the regression check that can only be observed against a real Obsidian instance.

- [ ] T017 [P] Run all four Constitution Quality Gates locally and confirm green: `npm run lint && npm run typecheck && npm run build && npm test`. Each must pass with zero warnings (lint) and zero failures (test). If any gate fails, fix the underlying issue — do NOT bypass with `--no-verify` or eslint-disable (per the constitution's stack constraints).
- [ ] T017a [P] Add an **SC-005 import guard** test to `tests/tools/rename-file/handler.test.ts`: read `src/tools/rename-file/handler.ts` from disk via `readFileSync` and assert it does NOT contain any of the strings `getFileContents`, `putContent`, `appendContent`, or `patchContent`. Pins SC-005 ("zero new code paths that read or write note contents directly") so a future refactor can't silently introduce file-content coupling. Cheapest possible enforcement; one short test, no eslint custom rule, no CI script.
- [ ] T018 [P] Run [quickstart.md](./quickstart.md) Part 2 Step 9 against a real Obsidian instance: toggle Obsidian's "Automatically update internal links" setting OFF and re-run the happy-path rename. Confirm: file rename still succeeds, but `notes/index.md` is NOT updated (still contains the old wikilink). This is the regression check that proves the FR-005 precondition is real and that the design correctly delegates verification to the caller. **Re-enable the setting when finished.**
- [ ] T019 In the PR description for this branch, include a one-line Constitution compliance statement per the constitution's Governance section (e.g., `Constitution: Principles I–IV considered; no deviations.`), plus a link to [specs/012-safe-rename/](./).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user-story phases** because the spike's output (the working `RENAME_COMMAND_ID`) is hardcoded into T005.
- **User Story 1 (Phase 3)**: Depends on Phase 2. Delivers the MVP runtime code.
- **User Story 2 (Phase 4)**: Depends on Phase 3 (specifically T005 — the handler must exist for failure-path tests to import it). No new runtime code.
- **User Story 3 (Phase 5)**: Depends on Phase 3 (specifically T004 — the description text shipped in `tool.ts` is what the registration test pins). No new runtime code.
- **Polish (Phase 6)**: Depends on Phases 3–5 being complete (so the test suite is fully populated before T017 runs all gates).

### Within User Story 1

- T003 (schema) and T004 (tool.ts) are independent of each other ([P] together).
- T005 (handler) depends on T003 (schema import) and T002 (command id constant).
- T006 (aggregation) depends on T004.
- T007 (dispatcher) depends on T005.
- T008 (happy-path test) is independent of T009/T010 in terms of what it asserts but lives in the same file; can be authored together. The [P] marker on T008 reflects that it can be written in parallel with T003/T004 (different file).
- T009/T010 add tests to the same file as T008, so they're sequential additions to that file.
- T011 (manual quickstart) depends on T007 being merged so the dispatcher routes to the new handler.

### Within User Story 2 / User Story 3

- All tests in US2 and US3 add to existing test files created in US1 (handler.test.ts) or create one new file (registration.test.ts in US3 — independent of US2 work).
- T012 [P] and T015 [P] are in different files and can be authored simultaneously.
- T013a (out-of-vault test) [P] is in the same file as T012/T013 (handler.test.ts) but is a separate test case that doesn't conflict with sibling tests at write time; the [P] marker reflects that it's additive, not blocking.

### Parallel Opportunities

- **T003** (schema.ts) || **T004** (tool.ts) || **T008** (handler.test.ts) — three different files, no shared symbols at write time.
- **T012** (US2 failure-path test) || **T015** (US3 registration.test.ts) — different files.
- **T013a** (US2 out-of-vault test) — additive sibling to T012/T013 in handler.test.ts; safe to author in parallel with T015.
- **T017** (quality gates) || **T018** (manual setting-disabled regression check) — `npm` commands and a separate Obsidian session.
- **T017a** (SC-005 import guard) — sequential after T005 lands (the test reads the handler source from disk); independent of T017/T018 in terms of work, but T017's `npm test` run will only see T017a as a pass after both are in.

### Story-Sharing Note (intentional cross-story coupling)

Because `rename_file` is a single tool with a single `tool.ts` and `handler.ts`, US2 and US3 cannot ship runtime code independently of US1 — there is no second tool to register. This is acceptable because:

- The MVP (US1) ships a complete, working tool with the full description text.
- US2's contribution is **failure-path test coverage** — pinning behaviour US1 already exhibits via Q1's pure-delegation contract.
- US3's contribution is the **description-substring registration test** — pinning text US1 already shipped in `tool.ts`.

Each story is still **independently verifiable**: US1 by the happy-path acceptance scenario, US2 by triggering a collision against a running server, US3 by inspecting `tools/list`. The sequential implementation order (US1 → {US2, US3}) reflects code reality, not a story-design weakness.

---

## Parallel Example: User Story 1

```text
# Three different files, no symbol dependencies at write time:
Task T003: Implement RenameFileRequestSchema in src/tools/rename-file/schema.ts
Task T004: Implement RENAME_FILE_TOOLS in src/tools/rename-file/tool.ts
Task T008: Implement happy-path test in tests/tools/rename-file/handler.test.ts

# Then:
Task T005: Implement handler.ts (depends on T003 + T002)

# Then:
Task T006: Wire RENAME_FILE_TOOLS into src/tools/index.ts (depends on T004)
Task T007: Add 'rename_file' case to src/index.ts dispatcher (depends on T005)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001).
2. Complete Phase 2: Foundational (T002 spike). **Stop here if the spike fails — escalate to the user.**
3. Complete Phase 3: User Story 1 (T003–T011).
4. **STOP and VALIDATE**: Run T011 manual quickstart Part 2 Steps 1, 3, 7, 8 against a real Obsidian instance.
5. Demo / merge as MVP if all green. The tool is fully functional at this point.

### Incremental Delivery (recommended)

1. Complete Setup + Foundational + US1 → ship as MVP commit.
2. Add US2 tests (T012, T013) + manual regression (T014) → ship as a separate commit pinning failure-path contracts.
3. Add US3 registration test (T015) + manual inspection (T016) → ship as a separate commit pinning the discoverability contract.
4. Polish phase (T017–T019) → final commit before PR.

This preserves clean per-story commits in the git history even though the runtime code is shipped in step 1.

### Single-Developer Sequential Strategy

Because all three stories share one tool module, parallel-team work is limited. The realistic single-developer order is:

1. T001 → T002 → (T003 || T004) → T005 → T006 → T007 → (T008 → T009 → T010) → T011 (US1 done).
2. (T012 || T015) → T013 → (T014 || T016) (US2 + US3 done).
3. (T017 || T018) → T019 (polish + PR).

---

## Notes

- **[P] tasks** = different files, no dependencies on incomplete tasks.
- **[Story] label** maps task to its user story for traceability and per-commit grouping.
- **Tests are required, not optional** — Constitution Principle II is non-negotiable. Skipping any test task is a constitution violation.
- **The T002 spike is non-negotiable** — do not write handler code until it passes. The risk of an infeasible mechanism is real (see [research.md R4/R5](./research.md)).
- **Commit per task or per logical group**, not per phase — granular commits make rollback safe if the spike's findings change downstream.
- **Stop at any checkpoint to validate** — the MVP checkpoint after Phase 3 is the highest-value pause point.
- **Avoid**: bypassing the spike, swallowing errors with try/catch around `rest.executeCommand`, adding pre-flight existence checks, adding a `create_parents` flag — all four are explicit anti-patterns from the spec/research/contract.
