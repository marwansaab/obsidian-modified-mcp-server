---
description: "Task list for feature 010 — Fix Lint Errors"
---

# Tasks: Fix Lint Errors

**Input**: Design documents from `specs/010-fix-lint-errors/`
**Prerequisites**: [plan.md](plan.md) (required), [spec.md](spec.md) (required for user stories), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: This feature ships zero new tests. The spec is explicit about no test logic changes (FR-011); the existing test suite acts as the regression gate. Each implementation task that touches a file already exercised by the suite carries an inline verification step that re-runs `npm test`. No `tests/` task in the list below is a *new* test — they are housekeeping edits to import blocks of two existing test files (FR-007).

**Organization**: Tasks are grouped by user story. Stories US2, US3, and US4 each carry the work for one of the spec's three fix categories; US1 is the integrative gate that confirms all three landed together.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- Single-project layout (per [plan.md](plan.md) "Structure Decision"). All paths are relative to the repository root, `c:\Github\obsidian-modified-mcp-server`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the baseline before editing anything. No project initialization needed — the repository is already configured.

- [X] T001 Confirm the working tree is the tip of branch `010-fix-lint-errors` and is clean (no uncommitted edits): `git status` — shows clean working tree on `010-fix-lint-errors`.
- [X] T002 Reproduce the 9-problem lint baseline so it can be re-checked at every checkpoint: `npm run lint` — output ends with `✖ 9 problems (8 errors, 1 warning)` against the exact files enumerated in [spec.md](spec.md) Reproduce section.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None required.

This feature has no shared infrastructure to build, no models to scaffold, and no dependencies between user stories beyond their shared dependency on the same `eslint.config.js` semantics. User-story phases can begin immediately after Phase 1.

**Checkpoint**: User story implementation can now begin.

---

## Phase 3: User Story 2 — Coverage tree excluded from lint at config level (Priority: P1)

**Goal**: ESLint never walks into `coverage/`. The exclusion lives in `eslint.config.js` and applies to every present and future file the coverage tooling emits. The `TESTING.md` doc gains a one-line note explaining why.

**Independent Test**: Regenerate coverage with `npm test`, then `npm run lint`. The lint output references zero paths under `coverage/`.

**Why this story is in this position**: All three P1 stories (US2, US3, US4) are independent — they touch disjoint files. US2 is listed first because it is the simplest mechanical edit and resolves 4 of the 9 baseline problems by itself (3 parser errors on `coverage/lcov-report/*.js` plus the implicit "shouldn't even be looking" baseline).

### Implementation for User Story 2

- [X] T003 [P] [US2] Add `'coverage/**'` to the `ignores` array on line 13 of [eslint.config.js](eslint.config.js#L13). Resulting array: `['dist/**/*', 'tsup.config.ts', 'eslint.config.js', 'coverage/**']`. Match the existing `'dist/**/*'` style — quoted string, no trailing comment. (FR-002, FR-003; contract C-002.)
- [X] T004 [P] [US2] Append a one-line note to [TESTING.md](TESTING.md) immediately after the bullet that lists what `coverage/` contains (around line 28). Wording — adapt to fit the doc's voice: *"`coverage/` is excluded from `npm run lint` at the ESLint flat-config level (`eslint.config.js` `ignores`), because everything inside it is a generated artifact of the coverage tooling, not source we own."* (FR-004; contract C-009.)
- [X] T005 [US2] Verify US2 in isolation: `npm test` (regenerates `coverage/`), then `npm run lint`. The lint command's stdout must contain zero lines matching `coverage/` (test with `npm run lint 2>&1 | Select-String coverage` — zero matches). The exit code at this point may still be non-zero because US3 and US4 have not yet landed; that is expected. (Contracts C-002, C-009.)

**Checkpoint**: 4 of the 9 baseline problems are gone (the 3 `coverage/lcov-report/*.js` parser errors). 5 remain.

---

## Phase 4: User Story 3 — Top-level `*.config.ts` files resolved by project service (Priority: P1)

**Goal**: The typescript-eslint project service resolves every `*.config.ts` file at the repo root under the project's own compiler options. Adding new top-level config files later requires no further plumbing.

**Independent Test**: `npm run lint` produces zero `"was not found by the project service"` diagnostics. `npm run typecheck` still passes.

### Implementation for User Story 3

- [X] T006 [US3] Append `"*.config.ts"` to the `include` array on line 16 of [tsconfig.json](tsconfig.json#L16). Resulting array: `["src", "tests", "scripts", "*.config.ts"]`. Preserve the existing JSON formatting (single-line array, trailing closing bracket on its own line). (FR-005, FR-006; research decision R-1.)
- [X] T007 [US3] Verify US3 in isolation. Run both:
  1. `npm run lint 2>&1 | Select-String "was not found by the project service"` — zero matches.
  2. `npm run typecheck` — exits 0. (`tsup.config.ts` and `vitest.config.ts` both type-check cleanly today; bringing them into the typecheck graph adds no new errors. If a type error appears, treat it as in-scope per [quickstart.md](quickstart.md) "If something fails".)

**Checkpoint**: 1 more of the 9 baseline problems is gone (`vitest.config.ts` parser error). 4 remain — all in the two test files.

---

## Phase 5: User Story 4 — Test-file imports tidied (Priority: P2)

**Goal**: Both affected test files import only the vitest helpers they actually use; imports in `tests/inherited/index.test.ts` satisfy the `import/order` rule; the unused `eslint-disable @typescript-eslint/no-explicit-any` directive at line 101 of `tests/inherited/index.test.ts` is removed.

**Independent Test**: `npm run lint -- tests/inherited/index.test.ts tests/inherited/services/smart-connections.test.ts` exits 0 with no errors and no warnings. `npm test` continues to pass.

**Sequencing constraint** (per research decision R-5): the auto-fix pass must run *before* the manual import trims. Auto-fix corrects `import/order` deterministically; doing the trims first leaves the auto-fixer free to reorder around partially-deleted lines.

### Implementation for User Story 4

- [X] T008 [US4] Run `npx eslint --fix tests/inherited/index.test.ts tests/inherited/services/smart-connections.test.ts` from the repository root. Expected effect: in [tests/inherited/index.test.ts](tests/inherited/index.test.ts), the empty line at line 35 is removed and the `nock` import at line 37 is moved to precede the `node:fs` import at line 33; the `// eslint-disable-next-line @typescript-eslint/no-explicit-any` directive at line 101 is removed. Inspect the diff after the run; do not accept any change outside these two files. (FR-008, FR-009; research decision R-4, R-5.)
- [X] T009 [P] [US4] Hand-edit [tests/inherited/index.test.ts](tests/inherited/index.test.ts) (originally line 42 of the unmodified file): in the multi-line vitest helper import block, delete the `beforeAll,` line. The remaining names (`describe`, `it`, `expect`, `afterAll`, `beforeEach`, `afterEach`, `vi`) stay. Final block per [data-model.md](data-model.md) "File 1 — Imports after this feature's edits". (FR-007.)
- [X] T010 [P] [US4] Hand-edit [tests/inherited/services/smart-connections.test.ts](tests/inherited/services/smart-connections.test.ts) (originally line 16): drop `beforeEach,` from the same-line vitest import. The line becomes `import { describe, it, expect, afterEach } from 'vitest';`. Other imports on the same line stay. (FR-007.)
- [X] T011 [US4] Verify US4 in isolation:
  1. `npm run lint -- tests/inherited/index.test.ts tests/inherited/services/smart-connections.test.ts` — exits 0 with no `@typescript-eslint/no-unused-vars`, `import/order`, or `Unused eslint-disable directive` lines for either file.
  2. `npm test` — exits 0. The two affected test files run without skips; the coverage `text` reporter's `All files` row remains at or above the 82.4% statements floor. (FR-007, FR-008, FR-009, FR-011; contract C-004.)

**Checkpoint**: All 9 baseline problems should now be resolved. Move to US1's integrative verification.

---

## Phase 6: User Story 1 — Clean lint signal restored (Priority: P1) 🎯 INTEGRATION GATE

**Goal**: `npm run lint` exits 0 with zero errors and zero warnings against the post-edit tree. The test suite still passes. Production source is unchanged. The coverage gate still enforces 82.4%. All three fix categories from US2, US3, and US4 are present in the same working tree.

**Independent Test**: From the tip of `010-fix-lint-errors`, after T003–T011 have all run, the full quickstart in [quickstart.md](quickstart.md) passes end-to-end on the first attempt.

**Why this story is the integration gate**: US1 is the *outcome* contract — it is true only if US2, US3, and US4 are all simultaneously true. Its tasks are integrative, not additional implementation work.

### Implementation for User Story 1

- [X] T012 [US1] Run the full top-of-tree lint: `npm run lint`. Confirm exit code 0; confirm output ends with no `✖` summary line at all (or `✔` if your ESLint version emits one). Confirm zero `error` or `warning` lines for any path. (FR-001, FR-013; contracts C-001, C-008.)
- [X] T013 [US1] Run the full test suite: `npm test`. Confirm exit code 0; confirm the `text` reporter's `All files` row shows statement coverage `>= 82.4%`; confirm no message of the form `Coverage for statements (X%) does not meet global threshold (82.4%)` appears. (FR-011, FR-012; contracts C-006, C-007.)
- [X] T014 [US1] Confirm production source is untouched: `git diff main..HEAD -- src/` produces empty output. (FR-010; contract C-005.)
- [X] T015 [US1] Confirm vitest config threshold is untouched: `git diff main..HEAD -- vitest.config.ts` either produces empty output or, if any diff is present, the `thresholds.statements` value remains exactly `82.4` on the post-feature side. (FR-012; contract C-007.)
- [X] T016 [US1] Walk through every contract assertion in [contracts/lint-and-config-contracts.md](contracts/lint-and-config-contracts.md) (C-001 through C-009) and tick each post-condition. Any assertion that does not hold blocks merge.

**Checkpoint**: Feature complete. The merge can land.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Tidy the spec text, package the PR, and (separately) capture the recommended follow-up.

- [X] T017 Replace the literal string `82.45%` with `82.4%` in **three** locations across the spec-track artifacts (per the `/speckit-analyze` finding I1):
  1. [spec.md:179](spec.md) — FR-012 ("the 82.45% statement-coverage floor MUST remain in force and unchanged").
  2. [spec.md:225](spec.md) — SC-002 ("with the coverage gate still enforcing the 82.45% statement-coverage floor").
  3. [checklists/requirements.md:43](checklists/requirements.md) — the meta-note that quoted "82.45%" as the deliberately-pinned floor.

  Sweep each file once with a find to confirm zero residual `82.45%` strings. Reason: the canonical floor is `82.4` per [vitest.config.ts](../../vitest.config.ts) line 15 and [TESTING.md](../../TESTING.md) line 41. (Research decision R-3; analyze finding I1.)
- [X] T018 Confirm the changeset matches the planned scope: `git diff main..HEAD --name-only` returns exactly six paths — `eslint.config.js`, `tsconfig.json`, `tests/inherited/index.test.ts`, `tests/inherited/services/smart-connections.test.ts`, `TESTING.md`, `specs/010-fix-lint-errors/spec.md`. (Plus the `specs/010-fix-lint-errors/` Phase 0/1 artifacts already committed by `/speckit-plan`'s after-hook, if you used it.) Any other path indicates scope creep that must be reverted before merging.
- [ ] T019 Open the pull request. Title (≤ 70 chars): `fix(010): restore clean lint on post-009 tree`. Body must include:
  - One-line summary of the three fix categories.
  - Constitution compliance line per Governance: "Principles I–IV considered; no deviation."
  - Reference to [spec.md](spec.md), [plan.md](plan.md), and the quickstart verification.
- [ ] T020 [P] **Backlog item, NOT part of this PR.** Open a separate follow-up issue: "Wire `npm run lint` into CI or a pre-commit hook so a regression of this feature is caught at gate time." Body cites the Recommended Follow-Up in [spec.md](spec.md) and notes that the constitution already mandates `npm run lint` clean for merge (Quality Gate 1 in [.specify/memory/constitution.md](../../.specify/memory/constitution.md)) — the gap is purely enforcement automation, not policy. (Recommended Follow-Up; spec acceptance criterion 8.)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Empty — Phase 3 begins immediately after Phase 1.
- **User Stories (Phases 3, 4, 5)**: All can start in parallel after Phase 1 — they touch disjoint files (US2 → `eslint.config.js`, `TESTING.md`; US3 → `tsconfig.json`; US4 → two test files).
- **Phase 6 (US1 integration gate)**: Depends on US2, US3, AND US4 being complete. Cannot start until T003 through T011 have all landed.
- **Phase 7 (Polish)**: Depends on Phase 6. T017 (spec typo fix) can be done at any point before T018 if a parallel worker prefers; the polish ordering is convenience, not a hard dependency.

### User Story Dependencies

- **US1 (P1)**: Strict dependency on US2, US3, AND US4. US1 has no implementation tasks of its own; all work is integrative verification.
- **US2 (P1)**: Independent. Touches only `eslint.config.js` and `TESTING.md`.
- **US3 (P1)**: Independent. Touches only `tsconfig.json`.
- **US4 (P2)**: Independent. Touches only the two named test files.

### Within Each User Story

- US4 has an internal sequencing constraint: T008 (auto-fix) before T009 / T010 (hand-edits). T009 and T010 themselves are parallelisable across the two test files.
- US2's T003 and T004 are parallelisable.
- US3 has a single edit task (T006) followed by verification (T007).

### Parallel Opportunities

- **Cross-story**: a single developer can interleave US2/US3/US4 freely; a multi-developer team could split them. None of the stories' tasks block each other.
- **Within US2**: T003 and T004 are [P].
- **Within US4**: T009 and T010 are [P] after T008.
- **In Polish**: T020 is [P] (a separate backlog item, not in this PR).

---

## Parallel Example: One Developer, One PR

Sequential interleaving recommended for a single developer (matches the natural review order of the diff):

```text
# Phase 1 — confirm baseline
T001 → T002

# Phase 3 — US2 (cheapest, 4 problems gone)
T003 (eslint.config.js) → T004 (TESTING.md) → T005 (verify)

# Phase 4 — US3 (tsconfig include glob, 1 problem gone)
T006 → T007

# Phase 5 — US4 (test housekeeping, 4 problems gone)
T008 (auto-fix) → T009 (index.test.ts trim) → T010 (smart-connections.test.ts trim) → T011 (verify)

# Phase 6 — US1 integration gate
T012 → T013 → T014 → T015 → T016

# Phase 7 — Polish
T017 (spec typo) → T018 (scope check) → T019 (open PR)
T020 — separate backlog issue, NOT part of this PR
```

## Parallel Example: Multi-Developer Team

If three developers split the work:

```text
Dev A: T001, T002, T003, T004, T005     # US2 + setup
Dev B: T006, T007                        # US3
Dev C: T008, T009, T010, T011            # US4

Then any one of them: T012–T016 (US1 gate), T017–T019 (polish), T020 (backlog).
```

All three streams operate on disjoint files and can be combined in a single PR via three commits.

---

## Implementation Strategy

### MVP First (US2 + US3 + US4 → US1 gate)

This feature has only one MVP — the full PR. Any subset of {US2, US3, US4} on its own would leave the lint signal still partially red, which is precisely the state US1 says is unacceptable.

1. Complete Phase 1 (setup / baseline reproduction).
2. Complete Phases 3–5 (the three independent fixes) in any interleaved order.
3. Complete Phase 6 (US1 gate) — confirms the three together produce a clean signal.
4. Complete Phase 7 (polish + open PR).
5. **STOP and VALIDATE**: a clean `npm run lint` and a passing `npm test` on the merge commit are the only success criteria.

### Incremental Delivery

Not applicable. This feature is a single coherent PR per FR-013.

### Parallel Team Strategy

See the multi-developer example above. The three independent stories admit clean parallelism, but the PR ships as one merge.

---

## Notes

- **No new tests are added.** The two test-file edits are import-block trims — they do not change any test's runtime behaviour. The existing suite is the regression gate (FR-011).
- **No production source changes.** Anything under `src/` is immutable for this feature (FR-010 / contract C-005).
- **`tsup.config.ts` lint posture is intentionally unchanged.** It was in `eslint.config.js` `ignores` before and stays there after — un-ignoring it is a separate spec.
- **The spec-text typo fix in T017 is a correction, not a contract change.** The implementation already honours the real floor (82.4%); T017 only aligns the spec text with reality.
- Commit after each phase (or each task, for finer review) — matches `tasks-template.md`'s default guidance.
- Verify after every checkpoint: lint and tests are both fast (≤ 10 s combined) on this codebase.
