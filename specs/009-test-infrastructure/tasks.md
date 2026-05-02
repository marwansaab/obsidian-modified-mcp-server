---
description: "Task list for spec 009 — Test Infrastructure (Coverage Gate + AS-IS Backfill)"
---

# Tasks: Test Infrastructure (Coverage Gate + AS-IS Backfill)

**Input**: Design documents from `/specs/009-test-infrastructure/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/build-gate.md`, `contracts/coverage-config.md`, `quickstart.md`

**Tests**: Test tasks ARE included — this entire feature is a test-infrastructure feature. Tests under `tests/inherited/` are the deliverable (User Story 2), not just verification of the deliverable. The "tests are OPTIONAL" template note does not apply here.

**Organization**: Tasks are grouped by user story. The two stories ship in a single PR (per plan.md Summary and FR-006 / SC-004), so the implementation order interleaves: Setup → Foundational → US1-wiring (gate disarmed) → US2 (AS-IS backfill) → US1-arming (gate armed with achieved floor) → Polish.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User-story label — `[US1]` for Story 1 (Coverage Gate), `[US2]` for Story 2 (AS-IS Backfill). Setup, Foundational, and Polish phases have no story label.
- Every task description ends with the exact file path it touches.

## Path Conventions

Single project. Source under `src/`, tests under `tests/`. New AS-IS subset under `tests/inherited/`. Feature config files at repo root: `vitest.config.ts`, `TESTING.md`, `package.json`, `.gitignore`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Wire the coverage tool with the gate **disarmed** (no `thresholds` field), scaffold the AS-IS test directory, and gitignore the report path. Per R6 / FR-004 and the spec edge case "Floor is set to 0% before the AS-IS work", no threshold value is committed in this phase.

- [ ] T001 Add `@vitest/coverage-v8@^4.1.5` to `devDependencies` in `package.json` (must match the installed `vitest@4.1.5` major; see research R1)
- [ ] T002 Run `npm install` to populate `node_modules/@vitest/coverage-v8` and update `package-lock.json`
- [ ] T003 [P] Create `vitest.config.ts` at repo root with the coverage block per `contracts/coverage-config.md` "Required shape" — `provider: 'v8'`, `include: ['src/**']`, `reporter: ['text', 'lcov', 'json-summary']`, `reportsDirectory: 'coverage'`, and the `thresholds` object **omitted entirely** (gate disarmed during AS-IS work)
- [ ] T004 [P] Append `coverage/` to `.gitignore` (the only `.gitignore` change scoped to this feature; see `contracts/coverage-config.md` ".gitignore addition")
- [ ] T005 [P] Create the AS-IS test directory scaffolding: `tests/inherited/`, `tests/inherited/tools/`, `tests/inherited/services/` (empty directories at this stage; populated in Phase 4)
- [ ] T006 [P] Create `tests/inherited/README.md` — 1-page note stating the AS-IS discipline ("these tests encode upstream behaviour as-is; do not modify `src/` to make them pass") per plan.md project-structure annotation and research R5

**Checkpoint**: `npm test` runs and emits `coverage/coverage-summary.json`, `coverage/lcov.info`, `coverage/lcov-report/index.html`, plus the `text` reporter table to stdout. Build still passes (no threshold to violate). Verified by manual run.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Capture the **baseline** coverage report (US1 wired + US2 not yet started) so US2's AS-IS tasks can target the actual gaps reported by the V8 provider rather than guessing. Per research R6: "the implementer runs `npm test` *after* wiring up `@vitest/coverage-v8` but *before* writing any AS-IS tests."

**CRITICAL**: No US2 task may begin before T007 produces the baseline; AS-IS tests target the gaps it reveals.

- [ ] T007 Run `npm test`, then read `coverage/coverage-summary.json` and the per-file `text` reporter table. Record the baseline aggregate statement coverage of `src/` AND each per-file statement coverage for the seven inherited tool files (`src/tools/file-tools.ts`, `search-tools.ts`, `vault-tools.ts`, `write-tools.ts`, `periodic-tools.ts`, `semantic-tools.ts`, `obsidian-tools.ts`), the two inherited service files (`src/services/obsidian-rest.ts`, `smart-connections.ts`), and the two inherited root files (`src/index.ts`, `src/config.ts`) into a working note at `specs/009-test-infrastructure/baseline-coverage.md`. This file is internal to the feature branch and is the input each US2 task reads to know which lines/methods are uncovered

**Checkpoint**: Baseline numbers recorded; US2 implementers know which inherited methods are at 0 % and which are partial. Foundation ready — US2 can now proceed in parallel per inherited file.

---

## Phase 3a: User Story 1 — Coverage Gate (Priority: P1) — Wiring (gate disarmed)

**Goal**: The build measures statement / branch / function coverage on every file under `src/` and emits a structured artifact at a known path on every `npm test`. The gate's plumbing is in place but not yet armed; arming happens in Phase 3b after US2 completes.

**Independent Test** (from spec User Story 1): Wire up the coverage tool against the existing feature-spec tests only (no new tests yet). Confirm `npm test` (a) emits a coverage report covering every file under `src/`, (b) reads its threshold from a single repo-side config file, and (c) fails the build when statement coverage drops below that threshold — verified by temporarily deleting one of the existing feature-spec tests and observing the build go red.

- [ ] T008 [US1] Smoke-test the **report emission** half of the gate: run `npm test`, confirm `coverage/lcov.info`, `coverage/coverage-summary.json`, and `coverage/lcov-report/index.html` all exist after the run, and that `coverage-summary.json`'s `total.statements`, `total.branches`, `total.functions`, and per-file entries cover every file under `src/` per `data-model.md` Entity 2. Record the verification (paths confirmed, file count) in the PR description draft at `specs/009-test-infrastructure/pr-description.md` (new file, internal to feature branch). [Verifies acceptance scenario 1.]
- [ ] T009 [US1] Smoke-test the **gate-fail** half of the gate before US2 work: temporarily edit `vitest.config.ts` to add `thresholds: { statements: 100 }` (a value the current suite cannot meet), run `npm test`, confirm exit code is non-zero AND stdout contains a Vitest "Coverage for statements ... does not meet global threshold" message per `contracts/build-gate.md` "stdout" section. Revert `vitest.config.ts` to the disarmed state (no `thresholds` field), then run `git diff vitest.config.ts` and confirm zero output — guards against the threshold leaking into Phase 3a/4 commits. Record both the failing exit code, the message text, and the clean post-revert diff in `specs/009-test-infrastructure/pr-description.md`. [Pre-validates acceptance scenarios 3 and 4 mechanism, even before the floor value is known.]

**Checkpoint**: Gate plumbing proven to work in both directions (emits report; fails on threshold violation). Vitest's threshold check is the gate; no custom build script. Phase 3a holds until Phase 4 (US2) completes — Phase 3b's arming task depends on US2's final aggregate coverage value.

---

## Phase 4: User Story 2 — AS-IS Characterization Tests (Priority: P2)

**Goal**: Every uncovered code path reachable from outside the module in the upstream-inherited tools (FR-009 list) and the inherited service / root files is exercised by at least one test that asserts current observable behaviour. The coverage report stops growing — i.e., further tests would either duplicate existing coverage, exercise unreachable defensive branches, or require modifying `src/` (forbidden by FR-006).

**Independent Test** (from spec User Story 2): Run the coverage tool *before* (Phase 2 baseline) and *after* this work. After: the inherited files show coverage exercised; the only remaining gaps are unreachable-from-outside lines documented in `TESTING.md` (Phase 5).

**Discipline for every task in this phase**:
- All tests live under `tests/inherited/`. Tool tests mirror to `tests/inherited/tools/<source-file>.test.ts`; service tests to `tests/inherited/services/<source-file>.test.ts`; root-level src files (`src/index.ts`, `src/config.ts`) mirror to `tests/inherited/<source-file>.test.ts`. See research R5 and plan.md project structure.
- Use `nock` for every HTTP interaction (FR-007 / research R2). No other mocking library is introduced. Follow the convention from existing tests like `tests/tools/list-tags/handler.test.ts`: `BASE_URL = ${vault.protocol}://${vault.host}:${vault.port}`, specific path matchers, `nock.cleanAll()` + `nock.enableNetConnect()` in `afterEach`, and `nock.disableNetConnect()` in shared setup so a missing interceptor fails fast (SC-007).
- Encode the **observed** behaviour, not the intended one. If a line looks suspicious or buggy, the test asserts what the code does today; a fix belongs in a separate follow-up spec (FR-006, plan.md Principle IV note).
- For each tool with required input fields: add a happy-path test, an upstream-error path test (4xx/5xx/timeout, asserting verbatim error propagation per Principle IV), AND an input-validation-failure test. For tools with no required fields (e.g., `list_files_in_vault`), the upstream-error path satisfies the non-happy-path requirement on its own (precedent: `list_tags` in spec 008).
- Each task may produce one test file or several smaller ones (e.g., `file-tools.get-file-contents.test.ts` + `file-tools.batch.test.ts`) at the implementer's discretion, as long as all live under the named directory and target the named source file. Plan estimate is 30–50 test files total across this phase.
- After each task lands, run `npm test` and confirm aggregate statement coverage of `src/` has strictly increased vs. the baseline; if it has not, the task is incomplete (some uncovered path was missed).

### Inherited tool tests

- [ ] T010 [P] [US2] Create AS-IS characterization tests for `src/tools/file-tools.ts` (covers `get_file_contents`, `batch_get_file_contents` per FR-009) at `tests/inherited/tools/file-tools.test.ts` (or split per-tool sibling files in the same directory). Cover happy path, upstream-error path, and input-validation-failure path per the discipline above
- [ ] T011 [P] [US2] Create AS-IS characterization tests for `src/tools/search-tools.ts` (covers `search`, `complex_search`, `pattern_search` argument-validation paths inside the tool wrapper — note that `pattern_search`'s actual filesystem traversal lives in `src/index.ts` `runPatternSearch` and is covered by T020) at `tests/inherited/tools/search-tools.test.ts`
- [ ] T012 [P] [US2] Create AS-IS characterization tests for `src/tools/write-tools.ts` (covers `put_content`, `append_content`) at `tests/inherited/tools/write-tools.test.ts`
- [ ] T013 [P] [US2] Create AS-IS characterization tests for `src/tools/vault-tools.ts` (covers `list_files_in_vault`, `list_files_in_dir`) at `tests/inherited/tools/vault-tools.test.ts`
- [ ] T014 [P] [US2] Create AS-IS characterization tests for `src/tools/periodic-tools.ts` (covers `get_periodic_note`, `get_recent_periodic_notes`, `get_recent_changes`) at `tests/inherited/tools/periodic-tools.test.ts`
- [ ] T015 [P] [US2] Create AS-IS characterization tests for `src/tools/semantic-tools.ts` (covers `semantic_search`, `find_similar_notes` AS-IS — but read `tests/tools/semantic-tools/` first; existing fork-authored tests already cover some paths and MUST NOT be duplicated per spec edge case "Existing feature-spec tests already cover a tool fully") at `tests/inherited/tools/semantic-tools.test.ts`. The baseline coverage report from T007 identifies the actual gap
- [ ] T016 [P] [US2] Create AS-IS characterization tests for `src/tools/obsidian-tools.ts` (covers `get_active_file`, `open_file`, `list_commands`, `execute_command`) at `tests/inherited/tools/obsidian-tools.test.ts`

### Inherited service tests

- [ ] T017 [P] [US2] Create AS-IS characterization tests for `src/services/obsidian-rest.ts` (covers axios client setup, the `safeCall` error-propagation layer including the `data?.errorCode ?? error.response?.status` fallback, vault selection logic, and per-method request shapes for the inherited methods called by the tool tests above — but only paths NOT incidentally exercised by T010–T016) at `tests/inherited/services/obsidian-rest.test.ts`. Note: `src/services/obsidian-rest-errors.ts` is **fork-authored** (added by spec 005, see file docstring) and is already covered by `tests/tools/delete-file/*` — it is NOT in scope for this feature per FR-009. Confirm via T007 baseline (expect ≥ 90 % statement coverage of `obsidian-rest-errors.ts`); if the baseline reveals a gap, file a follow-up spec rather than adding a task here
- [ ] T018 [P] [US2] Create AS-IS characterization tests for `src/services/smart-connections.ts` (covers smart-connections client setup and helpers used by `semantic-tools.ts`) at `tests/inherited/services/smart-connections.test.ts`

### Inherited root-level src tests

- [ ] T019 [P] [US2] Create AS-IS characterization tests for `src/config.ts` (covers `loadConfig`, `getConfig`, `resetConfig`, plus the helpers `normalizeVaultConfig`, `loadVaultsFromJson`, `loadVaults`, `resolveDefaultVault`) at `tests/inherited/config.test.ts`. Exercise the env-var matrix: `OBSIDIAN_VAULTS_FILE`, `OBSIDIAN_VAULTS_JSON`, `OBSIDIAN_API_KEY` only, missing `apiKey` (error path), `OBSIDIAN_DEFAULT_VAULT` set to non-existent ID (error path), `OBSIDIAN_PROTOCOL` http vs https branch, `OBSIDIAN_VERIFY_SSL` true vs false. Use `vi.stubEnv` per Vitest convention; call `resetConfig()` in `afterEach` to clear the singleton between tests. No HTTP — `nock` not needed for this file
- [ ] T020 [P] [US2] Create AS-IS characterization tests for `src/index.ts` (covers the inherited dispatcher arms in `ObsidianMCPServer.handleToolCall` for each FR-009 inherited tool — `list_files_in_vault`, `list_files_in_dir`, `get_file_contents`, `search`, `append_content`, `put_content`, `batch_get_file_contents`, `complex_search`, `get_periodic_note`, `get_recent_periodic_notes`, `get_recent_changes`, `get_active_file`, `open_file`, `list_commands`, `execute_command`, `pattern_search` — plus the helpers `getVaultConfig`, `getRestService`, `globToRegex`, `runPatternSearch`, and the `list_vaults` arm and `default` unknown-tool arm) at `tests/inherited/index.test.ts` (the implementer MAY split into `tests/inherited/index.dispatcher.test.ts` + `tests/inherited/index.pattern-search.test.ts` if the file grows past ~600 lines). The dispatcher tests instantiate `ObsidianMCPServer` with env vars set via `vi.stubEnv`, mock the upstream REST endpoints with `nock`, and call `handleToolCall(name, args)` directly — bypassing the MCP transport. The `runPatternSearch` test uses a Vitest `beforeAll` to write a tiny markdown fixture vault to `os.tmpdir()` and asserts pattern matches, glob filtering, contextLines / maxMatches behaviour. **Implementer note**: `src/index.ts` calls `main()` at module load (line 553). Use `vi.mock` to stub the `Server.connect` invocation, OR import only the exported `ObsidianMCPServer` class via dynamic import inside test bodies to avoid the side-effecting top-level call. Do NOT modify `src/index.ts` to make it more testable (FR-006). The `process.on('SIGINT'/'SIGTERM')` handlers are infrastructure — leave uncovered and document in T022 if they remain so

### Termination check

- [ ] T021 [US2] After T010–T020 land, run `npm test` and read `coverage/coverage-summary.json`. Confirm the FR-009 termination condition is met: adding one more plausible test does NOT increase aggregate statement coverage without modifying `src/`. Record the final aggregate statement-coverage percentage (rounded down to one decimal place per `contracts/coverage-config.md` "Implementation order" step 3 — e.g., 82.43 → 82.4) into `specs/009-test-infrastructure/baseline-coverage.md` as the **achieved-floor value** that T023 will write into `vitest.config.ts`. Depends on T010–T020 (cross-task; this is the synchronization point of US2)
- [ ] T022 [US2] Document any genuinely-unreachable lines encountered during T010–T020 (defensive branches that depend on Node-internal failure modes per spec edge case "A line in `src/` is genuinely unreachable", plus the `process.on('SIGINT'/'SIGTERM')` shutdown handlers in `src/index.ts` if they remain uncovered) into the "Uncovered by design" section of the draft `TESTING.md` at `specs/009-test-infrastructure/testing-md-draft.md` (a working note inside the feature dir; the canonical `TESTING.md` is finalized in Phase 5)

**Checkpoint**: Coverage report stops growing. The achieved aggregate statement coverage of `src/` is recorded and ready to be locked in by Phase 3b. `git diff main..HEAD -- src/` is empty (FR-006 / SC-004).

---

## Phase 3b: User Story 1 — Coverage Gate (Priority: P1) — Arming

**Goal**: Lock in the floor at the value US2 achieved. Phase 3a was the wiring (gate disarmed); Phase 3b is the arming. This is split out as a separate phase because, per `contracts/coverage-config.md` "Implementation order" step 3, the threshold-arming SHOULD be its own commit — separable from the AS-IS test additions — so reviewers can see the gate being armed as a distinct change.

**Independent Test**: After T023 lands, `npm test` exits 0 (gate armed at achieved floor); after T024 lands, the gate is proven real by deleting one test and observing non-zero exit with the threshold-violation message — exactly the procedure in `quickstart.md` "Smoke test: gate is real".

- [ ] T023 [US1] Edit `vitest.config.ts` to add `thresholds: { statements: <achieved-floor value from T021, rounded down to one decimal> }` to the existing `coverage` block per `contracts/coverage-config.md`. Do NOT set `branches`, `functions`, `lines`, or `perFile` — those are forbidden by the contract per `/speckit-clarify` Q1/Q2 decisions. Run `npm test` and confirm exit 0 (gate armed, floor met). Depends on T021
- [ ] T024 [US1] Verify SC-001 / acceptance scenario 3 by the procedure in `quickstart.md` "Smoke test": `git stash push -- tests/tools/list-tags/handler.test.ts`; run `npm test`; confirm non-zero exit AND stdout contains `Coverage for statements (X%) does not meet global threshold (Y%)`; `git stash pop` to restore the test. Record both messages into `specs/009-test-infrastructure/pr-description.md` as SC-001 evidence. Depends on T023

**Checkpoint**: Gate is armed and proven real. SC-001 evidence captured. The single source of truth for the floor lives in `vitest.config.ts` `test.coverage.thresholds.statements` (FR-005 / SC-005 satisfied — one-line edit ratchets up or down).

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Promote internal feature-branch working notes into the canonical repo-root `TESTING.md`, capture the byte-for-byte invariant evidence in the PR description, and verify the offline-execution promise.

- [ ] T025 [P] Create canonical `TESTING.md` at repo root from the `quickstart.md` source (per FR-008 — quickstart.md is the source from which TESTING.md is derived). Include all sections from quickstart.md AND the "Uncovered by design" section content from `specs/009-test-infrastructure/testing-md-draft.md` (T022 output). The canonical `TESTING.md` is the FR-008 deliverable; the working note may be deleted or kept as feature-branch-only (it will not survive the squash if applicable)
- [ ] T026 [P] Verify SC-007 (offline execution) by running `npm test` with the network adapter disabled. On Windows: `Disable-NetAdapter -Name "*" -Confirm:$false` (or the equivalent via Settings → Network), run `npm test`, then `Enable-NetAdapter -Name "*" -Confirm:$false`. On Linux/macOS: disable the relevant interface (`sudo ifconfig en0 down` then back up) or run inside a Docker container with `--network=none`. Confirm the suite passes — proves no real HTTP requests are made. Record the procedure used and the run output in `specs/009-test-infrastructure/pr-description.md`
- [ ] T027 Capture the `git diff main..HEAD -- src/` output (expected: zero lines) into `specs/009-test-infrastructure/pr-description.md` as SC-004 / FR-006 evidence. If it is non-empty, STOP — a `src/` modification has crept in and must be reverted before the PR opens
- [ ] T028 [P] If `README.md` has a "Testing" section, update it to point at the new `TESTING.md`. Otherwise skip (do not create a new section just for this)
- [ ] T029 Final verification run: `npm test` from a clean state. Confirm (a) all tests pass, (b) coverage report emits to `coverage/`, (c) exit code 0, (d) `text` reporter shows aggregate statement coverage ≥ the floor in `vitest.config.ts`, AND (e) verify FR-001's "no Obsidian instance required" facet by grepping the test run's network output (e.g., wrap `npm test` with `netstat -an | findstr 27124` before/after, or rely on `nock.disableNetConnect()` shared setup having thrown if any test attempted a localhost:27124 connection — `nock`'s "No match for request" error fails the test fast, so a green run IS the proof). This is the final go/no-go before PR

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 completion (needs the wired coverage block from T003 to produce the baseline report).
- **Phase 3a (US1 wiring)**: Depends on Phase 2 (uses the same wired config; smoke-tests it).
- **Phase 4 (US2)**: Depends on Phase 2 (each task targets gaps from the baseline). Phase 4 tasks T010–T020 are mutually independent and run in parallel.
- **Phase 3b (US1 arming)**: Depends on Phase 4 completion (specifically T021 — the floor value is unknown until the AS-IS work terminates).
- **Phase 5 (Polish)**: Depends on Phase 3b completion (TESTING.md describes the armed gate; SC-001 evidence requires the armed gate to demonstrate failure).

### User Story Dependencies

- **User Story 1 (P1, gate)** functionally splits into 3a (wiring) and 3b (arming). Wiring is independent of US2; arming **depends on US2** because the floor value is "whatever the AS-IS backfill achieves" (FR-004). This cross-story dependency is the central design choice of plan.md Summary and is intentional — it is why both stories ship in one PR.
- **User Story 2 (P2, AS-IS)** depends on US1 wiring (Phase 3a) only insofar as the wired coverage report tells US2 implementers where the gaps are. Functionally, US2 tasks (T010–T020) write tests against `src/` source code that already exists and would pass even without the coverage block — but knowing which paths are uncovered requires the report.

### Within Each User Story

- Phase 4 (US2) tasks are written until **the report stops growing** (FR-009 termination). The terminating run is T021; T022 records leftover unreachable lines.
- Phase 3a smoke tests (T008, T009) precede Phase 4 (so the wiring is proven before the bulk of test-writing begins).
- Phase 3b arming (T023) MUST follow T021 so the floor value is known.

### Parallel Opportunities

- T003, T004, T005, T006 (Phase 1, all touching different files) run in parallel after T002.
- T010–T020 (Phase 4 AS-IS test files, each a new file under `tests/inherited/`) run fully in parallel — different files, no inter-task dependencies. This is the largest parallelizable chunk of the feature (11 independent tasks).
- T025, T026, T028 (Phase 5, different files / different verifications) run in parallel after T024.

---

## Parallel Example: Phase 4 (User Story 2)

```bash
# Once Phase 2 (T007 baseline) is done, all eleven AS-IS test files
# can be written in parallel — each is a new file at a known path,
# each consumes the same nock conventions, none depend on the others:

Task: "Create tests/inherited/tools/file-tools.test.ts (T010)"
Task: "Create tests/inherited/tools/search-tools.test.ts (T011)"
Task: "Create tests/inherited/tools/write-tools.test.ts (T012)"
Task: "Create tests/inherited/tools/vault-tools.test.ts (T013)"
Task: "Create tests/inherited/tools/periodic-tools.test.ts (T014)"
Task: "Create tests/inherited/tools/semantic-tools.test.ts (T015)"
Task: "Create tests/inherited/tools/obsidian-tools.test.ts (T016)"
Task: "Create tests/inherited/services/obsidian-rest.test.ts (T017)"
Task: "Create tests/inherited/services/smart-connections.test.ts (T018)"
Task: "Create tests/inherited/config.test.ts (T019)"
Task: "Create tests/inherited/index.test.ts (T020)"
```

After all eleven land, T021 runs once (the synchronization point) to confirm termination and record the achieved floor value.

---

## Implementation Strategy

This feature ships as **one PR** per plan.md Summary and the spec's "two objectives ... ship in a single PR" assumption. The MVP-first / incremental-delivery / parallel-team strategies from the generic tasks template do not apply: splitting into two PRs is explicitly rejected (shipping the gate without the AS-IS tests leaves the floor either off or set near zero — locking in the weak baseline).

The user-prescribed implementation order from the feature input (research R6) maps onto the phases as:

1. **(a) wire up the coverage tool** → Phase 1 + T008 verification
2. **(b) read the report** → T007 (baseline)
3. **(c) write AS-IS tests** → T010–T022
4. **(d) lock the floor** → T023–T024

Phase 5 (TESTING.md, evidence capture, offline verification) is the polish that closes the PR.

### Single-developer sequencing (likely actual case)

1. T001 → T002 (sequential: install)
2. T003 → T004, T005, T006 (parallel: scaffolding)
3. T007 (baseline)
4. T008, T009 (verify wiring)
5. T010–T020 (AS-IS, parallelizable in principle but typically authored one file at a time on a single-developer fork)
6. T021, T022 (termination + uncovered-by-design notes)
7. T023, T024 (arm gate, prove gate)
8. T025–T029 (TESTING.md, evidence, final verification)

---

## Notes

- Every test added by Phase 4 is a **characterization test** (data-model.md Entity 3): encodes current behaviour as the contract. None modifies `src/`. None requires `src/` to be fixed to pass.
- `tests/inherited/` is the FR-010 / SC-006 directory boundary — a future maintainer or auditor identifies the AS-IS subset by `ls tests/`, no test bodies read.
- The single source of truth for the floor is `vitest.config.ts` → `test.coverage.thresholds.statements`. CI scripts MUST NOT hardcode a competing value (FR-005). No CI YAML changes are scoped to this feature.
- Branch and function coverage are reported but advisory (FR-002, `/speckit-clarify` Q2). `thresholds.branches` and `thresholds.functions` MUST stay absent from `vitest.config.ts` — the contract reserves those fields and any addition is a separate ratchet PR.
- Per-file thresholds (`coverage.thresholds.perFile`) MUST stay absent — only aggregate is gated (FR-003, `/speckit-clarify` Q1).
- The PR description is built up across tasks (T008, T009, T024, T026, T027) in `specs/009-test-infrastructure/pr-description.md`. That file is feature-branch-internal and not part of the merged repo state — its contents are pasted into the GitHub PR body when the PR opens.
- `src/services/obsidian-rest-errors.ts` is fork-authored (spec 005) and out of scope for AS-IS work; it is exercised by existing `tests/tools/delete-file/*.test.ts`. T017 contains a baseline assertion to confirm this expectation.

---

## Format Validation

Every task above conforms to: `- [ ] TXXX [P?] [US1|US2]? Description with file path`

Verified spot checks:
- T001: setup task, no story label, no [P] (sequential before T002), file path `package.json` ✓
- T010: US2 task, [P] marker, file path `tests/inherited/tools/file-tools.test.ts` ✓
- T020: US2 task, [P] marker, file path `tests/inherited/index.test.ts` ✓
- T023: US1 task, no [P] (depends on T021), file path `vitest.config.ts` ✓
- T025: polish task, [P] marker, no story label, file path `TESTING.md` ✓
