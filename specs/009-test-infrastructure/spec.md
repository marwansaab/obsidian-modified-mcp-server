# Feature Specification: Test Infrastructure (Coverage Gate + AS-IS Backfill)

**Feature Branch**: `009-test-infrastructure`
**Created**: 2026-05-02
**Status**: Draft
**Input**: User description: "Add Test Infrastructure — Set up code-coverage measurement with a build-time gate, AND backfill AS-IS unit tests for every line of code that is not currently covered. The result is a coverage floor below which subsequent PRs cannot drop, and a characterization-style safety net under the inherited code from ConnorBritain/obsidian-mcp-server that does not yet have tests."

## Clarifications

### Session 2026-05-02

- Q: Floor granularity — should the gate enforce a single aggregate floor across all of `src/`, a per-file floor, or both? → A: Single aggregate floor across `src/`. Total covered statements ÷ total statements ≥ configured value. Per-file dips are tolerated as long as the aggregate holds. Per-file gating is reachable later as a separate ratchet step but is out of scope for this feature.
- Q: Which coverage metrics are gated? Statement, branch, and function are all measured (FR-002); is the build-fail gate one of them, all of them, or each with its own floor? → A: Statement coverage only is gated. Branch and function coverage are still measured and emitted in the structured report (so reviewers and a future ratchet PR can see them), but the build does not fail on dips in those two metrics. Adding branch/function gates is reachable later as a separate ratchet step.
- Q: What is the "explicit override" for lowering the floor that the user description requires? → A: The visible one-line edit to the floor's config value IS the override. Lowering and raising the floor use the same mechanism (one-line edit to the single repo-side config file); a reduction shows up in `git diff` and the PR review is the gate that catches it. No separate config flag, env var, commit-message marker, or CI plumbing is added. This is sized for a single-maintainer fork; if the maintainer count grows, a stronger override (e.g., a separate acknowledgement flag) can be retrofitted as a future ratchet step.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Establish a coverage floor that the build enforces (Priority: P1)

A maintainer wants every future change to this fork — whether their own
or an upstream merge — to be caught by the test suite the moment it
silently regresses an inherited code path. They run `npm test`, the
build measures statement, branch, and function coverage on every source
file under `src/`, emits a structured coverage artifact, and fails the
build if statement coverage drops below a configured floor recorded in a
single repo-side config file. The floor can be raised by editing one
line; it cannot be lowered without touching that same file (i.e., never
silently in a PR that just happens to delete tests).

**Why this priority**: This is the load-bearing change. Without the gate
the AS-IS tests in Story 2 still help, but a future PR could delete or
skip them without anyone noticing until production breaks. With the
gate, the safety net actually holds — every PR is forced to keep the
floor or explicitly raise it. Story 2 (the AS-IS tests themselves)
depends on this being in place because the floor's value is whatever
Story 2 achieves, but Story 1 is the *contract* that makes Story 2's
work durable.

**Independent Test**: Wire up the coverage tool against the existing
feature-spec tests only (no new tests yet). Confirm `npm test` (a)
emits a coverage report covering every file under `src/`, (b) reads
its threshold from a single repo-side config file, and (c) fails the
build when statement coverage drops below that threshold — verified by
temporarily deleting one of the existing feature-spec tests and
observing the build go red.

**Acceptance Scenarios**:

1. **Given** a fresh clone of the repo, **When** the maintainer runs
   `npm test`, **Then** the suite runs to completion without requiring
   a running Obsidian instance and without making any real outbound
   HTTP requests, and a coverage report (statement, branch, function)
   covering every source file under `src/` is emitted to a known path
   as a structured artifact (e.g., LCOV or JSON summary).
2. **Given** the coverage floor is recorded in a single repo-side
   config file, **When** a maintainer wants to raise the floor after a
   ratchet PR, **Then** they edit one line in that file and no other
   change to CI scripts, build wiring, or test runner config is
   required.
3. **Given** the configured floor is the value Story 2 achieves,
   **When** a PR deletes a test such that statement coverage would drop
   below that floor, **Then** `npm test` exits non-zero and the CI
   build fails with a message identifying that the coverage threshold
   was not met. (Verified during implementation by intentionally
   removing one test and observing the build go red.)
4. **Given** a PR that improves coverage above the current floor,
   **When** a maintainer wants to ratchet the floor upward, **Then**
   they update the same one-line config value and the gate now enforces
   the new, higher floor; no PR can subsequently lower it without
   editing that config file in plain sight.

---

### User Story 2 - AS-IS characterization tests for inherited code (Priority: P2)

The wrapper inherits a substantial body of code from
`ConnorBritain/obsidian-mcp-server` whose tools have never been
exercised by an automated test in this fork — they are validated only
when a real user invokes them through Cowork. A regression in any of
those paths would not be caught until a user encountered it. This
story adds unit tests that lock in each uncovered line's *current
observable behaviour* as the contract, treating production source code
as immutable. Even if a line looks suspicious, even if a function would
read more cleanly refactored, even if there is a latent bug — the test
encodes what the code does today, not what it should do. The intent is
a safety net, not a rewrite. With those tests in place, any future
change (deliberate refactor, accidental breakage during an upstream
merge, dependency upgrade) shows up as a red test pointing at a
specific line.

**Why this priority**: Without these tests the gate from Story 1 has
nothing to defend — the floor would be set near today's level and the
inherited code would still be uncovered. This is the work that
populates the safety net. It's P2 only because Story 1 is the
mechanism that makes it durable; functionally these two stories ship
in the same PR.

**Independent Test**: Run the coverage tool from Story 1 *before* and
*after* this work. Before: coverage report shows the inherited tools
and shared helpers as largely uncovered. After: coverage report shows
those paths exercised, and the only files still showing low coverage
are ones whose remaining lines are unreachable from outside (e.g.,
defensive branches that depend on Node-internal failure modes); the
report stops growing — i.e., further test additions yield no
additional covered statements without modifying production code.

**Acceptance Scenarios**:

1. **Given** the coverage report from Story 1 identifies uncovered
   paths in the upstream-inherited tools (`get_file_contents`,
   `batch_get_file_contents`, `put_content`, `append_content`,
   `list_files_in_vault`, `list_files_in_dir`, `search`,
   `complex_search`, `pattern_search`, `get_active_file`,
   `open_file`, `list_commands`, `execute_command`,
   `get_periodic_note`, `get_recent_periodic_notes`,
   `get_recent_changes`, `semantic_search`, `find_similar_notes`)
   and their shared helpers (axios setup, vault selection logic,
   error-propagation layer, frontmatter parsing if any),
   **When** the AS-IS backfill is complete, **Then** every previously
   uncovered statement, branch, and function reachable from outside
   the module is exercised by at least one test that asserts the
   currently observed behaviour (request shape, response handling,
   error propagation).
2. **Given** the AS-IS tests are written, **When** a reviewer diffs
   `src/` between the baseline (the commit before this feature
   branch) and the PR head, **Then** there are no changes — `src/`
   is byte-for-byte identical, and the PR description includes that
   diff (or a `git diff --stat` line showing zero changes) as
   evidence. Test files, coverage config, and `package.json`
   additions live outside `src/`.
3. **Given** a tester intentionally edits one line of an inherited
   tool to flip its behaviour (e.g., changes the HTTP method from
   `POST` to `PUT`, or swaps the order of two arguments to the
   shared axios helper), **When** the test suite runs, **Then** at
   least one AS-IS test fails with a message that points at the
   tool whose behaviour changed — i.e., the safety net catches a
   regression a user would otherwise hit at runtime.
4. **Given** the AS-IS tests use a single shared HTTP-mocking
   layer, **When** a new test is added later (for this feature or
   any future one), **Then** it consumes that layer rather than
   introducing its own ad-hoc HTTP stubbing, so mocking conventions
   do not diverge over time.
5. **Given** the AS-IS tests live alongside the existing
   feature-spec tests, **When** a future maintainer needs to know
   which subset is "characterization of inherited code" versus
   "fork-authored feature tests", **Then** the directory layout (or
   filename convention) makes that distinction obvious without
   reading individual test bodies — important so future audits can
   tell at a glance which tests encode upstream behaviour as-is and
   which encode this fork's deliberate behaviour.

---

### Edge Cases

- **Coverage report path does not exist on first run.** The build
  creates the report directory itself; a fresh clone with no prior
  coverage artifact must succeed without manual setup.
- **Floor is set to 0% before the AS-IS work.** During the implementation
  order specified in the user description (wire up the tool first, then
  read the report, then write tests, then lock the floor), the floor
  starts unset / non-enforcing. The gate is only armed at the end,
  after the AS-IS tests are in place. No intermediate commit may ship
  with both the gate armed *and* a low floor — that would lock in the
  weak baseline.
- **A line in `src/` is genuinely unreachable** (e.g., a defensive
  branch that depends on Node-internal failure modes such as
  `JSON.parse` of a value that's already been schema-validated). The
  test author does *not* modify `src/` to make it reachable; instead,
  the line is left uncovered, the floor is set to a value that
  acknowledges it, and the case is documented in `TESTING.md` so
  future maintainers don't waste time re-litigating it.
- **An inherited code path has an obvious latent bug.** The AS-IS test
  encodes the buggy behaviour as the current contract and a follow-up
  spec (separate from this one) is opened to fix it. This spec does
  not patch the bug — fixing it here would violate the byte-for-byte
  invariant in Acceptance Scenario 2 of Story 2.
- **Existing feature-spec tests already cover a tool fully.** The
  coverage report should show 100% (or near it) for the
  fork-authored features (`patch_content` with its structural
  validator, Surgical reads, Graph tools wiring + path-separator
  fix, Recursive directory delete + verification, Tag Management's
  `list_tags`). Story 2 adds tests only where the report shows
  gaps; it does not duplicate coverage of already-tested paths.
- **An upstream merge later modifies an inherited tool.** The AS-IS
  test fails because the observed behaviour changed. The maintainer
  decides whether the new behaviour is intended (update the test) or
  an unintended regression (block the merge). Either way the change
  surfaces as a visible test diff, not a silent runtime drift.
- **Coverage tool reports differ in metric naming** (e.g., one tool
  calls "statement coverage" what another calls "line coverage").
  The repo-side config file canonicalizes the metric name used for
  the floor so the value's meaning is unambiguous regardless of the
  underlying tool.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `npm test` MUST run the full test suite — existing
  feature-spec tests plus the AS-IS backfill tests added by this
  feature — without requiring a running Obsidian instance and
  without making any real outbound HTTP requests. Any test that
  needs an HTTP response MUST obtain it from the shared mocking
  layer (FR-007).
- **FR-002**: The build MUST measure and emit statement, branch, and
  function coverage for every source file under `src/`, written to a
  known path as a structured artifact (LCOV or JSON summary, the exact
  format chosen during `/speckit-plan`). The artifact path MUST be
  documented in `TESTING.md` so CI and humans can find it without
  guessing. All three metrics MUST appear in the report (so reviewers
  and a future ratchet PR can see branch/function values), but only
  statement coverage is enforced by the gate (FR-003); branch and
  function coverage are advisory in this feature.
- **FR-003**: The build MUST fail with a non-zero exit code when
  *aggregate* statement coverage across `src/` (total covered
  statements ÷ total statements) drops below the configured floor.
  Per-file dips are NOT independently gated by this feature; only
  the aggregate value is enforced. This MUST be verified during
  implementation by deleting one test and confirming the build goes
  red, and that verification recorded in the PR description.
- **FR-004**: The coverage floor's initial value MUST equal whatever
  statement-coverage percentage the AS-IS backfill (Story 2) actually
  achieves — not a round number chosen in advance, and not zero. This
  is locked in only at the end of the implementation order described
  in the user input (wire up tool → measure → write tests until the
  report stops growing → set floor).
- **FR-005**: The coverage floor MUST be stored in a single
  repo-side config file (e.g., a top-level `coverage.config.*` or a
  dedicated section in `package.json`). Raising or lowering the floor
  MUST be a one-line edit to that file; CI scripts and build wiring
  MUST NOT hardcode a competing threshold value. Lowering the floor
  requires no additional override mechanism beyond that visible edit
  — the diff to the config value IS the override, so any downward
  change appears plainly in `git diff` and is caught by PR review.
  The build gate enforces the value as currently written; it does
  not separately enforce monotonic-upward ratcheting.
- **FR-006**: Production source code under `src/` MUST be
  byte-for-byte unchanged versus the baseline commit on `main` before
  this feature branch. The PR description MUST include evidence of
  this — e.g., `git diff main..HEAD -- src/` showing zero output, or
  an equivalent `git diff --stat` line. Every test added by this
  feature is a *characterization* test (encoding existing behaviour
  as the contract); no test is permitted to require a fix in `src/`
  to pass.
- **FR-007**: All HTTP interactions in tests MUST go through a single
  shared mocking layer (the specific library is a `/speckit-plan`
  decision). No test may introduce its own ad-hoc HTTP stubbing
  parallel to the shared layer. This includes both new AS-IS tests
  and any retrofit needed in the existing feature-spec tests if they
  currently use a different stubbing approach.
- **FR-008**: The repository MUST include a short `TESTING.md` (or an
  equivalent README section) covering: where the coverage report is
  written, where the floor lives and how to ratchet it, the
  convention for keeping AS-IS characterization tests visually
  distinct from feature-authored tests (so future audits can identify
  the AS-IS subset at a glance), and the rule that AS-IS tests must
  not require any change to `src/` to pass.
- **FR-009**: The AS-IS backfill MUST cover every uncovered code path
  reachable from outside the module in the upstream-inherited tools
  named in the user input — `get_file_contents`,
  `batch_get_file_contents`, `put_content`, `append_content`,
  `list_files_in_vault`, `list_files_in_dir`, `search`,
  `complex_search`, `pattern_search`, `get_active_file`,
  `open_file`, `list_commands`, `execute_command`,
  `get_periodic_note`, `get_recent_periodic_notes`,
  `get_recent_changes`, `semantic_search`, `find_similar_notes` —
  and their shared helpers (axios setup, vault selection logic,
  error-propagation layer, any frontmatter parsing). The
  termination condition is that the coverage report stops growing —
  i.e., further tests add no additional covered statements without
  modifying `src/`. Already-covered fork features (`patch_content`,
  Surgical reads, Graph tools wiring + path-separator fix,
  Recursive directory delete + verification, Tag Management's
  `list_tags`) MUST NOT be re-tested by this feature.
- **FR-010**: The set of files comprising the AS-IS test subset MUST
  be identifiable by directory layout or filename convention — not
  only by reading test bodies. This is so future maintainers and
  auditors can answer "which tests are encoding upstream behaviour
  as-is, and which are encoding this fork's deliberate behaviour?"
  without grepping every file.

### Key Entities *(include if data involved)*

- **Coverage Report**: A per-file, per-metric record of which
  statements/branches/functions were executed during the test run.
  Emitted as a structured artifact (LCOV or JSON summary) at a known
  repo path. Consumed by humans (during AS-IS work, to find gaps)
  and by the build gate (to enforce the floor).
- **Coverage Floor**: A single numeric value (statement-coverage
  percentage) recorded in one repo-side config file. The contract
  the build enforces: any test run whose statement coverage falls
  below this value fails the build. Ratchets upward but never
  downward without an explicit edit to that file.
- **Characterization Test**: A unit test whose role is to encode an
  existing line's *currently observed* behaviour as the contract,
  not to validate a desired specification. Added by this feature to
  protect inherited code; identifiable as a group via FR-010.
- **Shared Mocking Layer**: The single library and conventions
  through which every test obtains HTTP responses, instead of making
  real network calls. Configured once; consumed by every test.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After this feature lands, a maintainer who deletes a
  random test from the suite and runs `npm test` sees the build fail
  with a coverage-threshold message — i.e., the gate is real, not a
  warning that scrolls past in CI logs.
- **SC-002**: Statement coverage of `src/` measured by `npm test` is
  ≥ the value the AS-IS backfill achieves on the day this feature
  merges, and that value is recorded in exactly one place in the
  repo. (The absolute percentage is not predetermined by this spec;
  whatever the work achieves becomes the floor.)
- **SC-003**: Coverage of every named upstream-inherited tool
  (FR-009 list) and the shared helpers improves from "exercised
  only at runtime via Cowork" to "exercised by at least one
  automated test with no real network calls", measurable by
  comparing the coverage report on the baseline commit to the
  coverage report on the PR head.
- **SC-004**: A reviewer can verify, from the PR alone, that no
  production source file under `src/` was modified — by looking at
  `git diff main..HEAD -- src/` and seeing zero changes. (This is
  the structural integrity check that distinguishes a "safety net"
  PR from a "rewrite-while-claiming-to-test" PR.)
- **SC-005**: A maintainer who needs to ratchet the floor upward
  after a future coverage-improving PR can do so by editing one
  line in one file. No CI script edit, no second source of truth,
  no hidden default lurking in a runner config.
- **SC-006**: A future maintainer (or auditor) opening the test
  directory can identify the AS-IS characterization subset within
  seconds — by directory layout or filename — without reading test
  bodies. This is what makes the safety-net intent durable across
  contributors.
- **SC-007**: `npm test` on a fresh clone with no Obsidian instance
  running and no internet connection completes successfully (subject
  to dependency install having happened), demonstrating the suite is
  fully offline.

## Assumptions

- The existing `npm test` script (`vitest run` per `package.json`)
  is the entry point the build gate hooks into. Any framework or
  coverage-tool specifics — Vitest's built-in c8/v8 coverage,
  Istanbul/nyc as a wrapper, or another option — are a
  `/speckit-plan` decision and out of scope here. The spec is
  agnostic on tooling and will accept any choice that meets FR-001
  through FR-008.
- The HTTP-mocking library is similarly a `/speckit-plan` decision.
  The repo already lists `nock` as a dev dependency, which suggests
  it as the natural choice, but this spec does not constrain the
  decision; the constraint is "exactly one library used everywhere"
  (FR-007), not "this specific library".
- The coverage-report artifact format (LCOV vs JSON summary vs
  both) is a `/speckit-plan` decision; the spec only requires that
  the artifact exists at a known path and covers statement, branch,
  and function metrics for every file under `src/`.
- The list of fork-authored features that already have full coverage
  — `patch_content` with its structural validator, Surgical reads,
  Graph tools wiring + path-separator fix, Recursive directory
  delete + verification, Tag Management's `list_tags` — is taken
  at face value from the user description and confirmed during
  implementation by reading the coverage report. If the report
  shows otherwise, the discrepancy is recorded and resolved at
  `/speckit-plan` time, not silently absorbed.
- The "byte-for-byte unchanged `src/`" rule (FR-006) is absolute
  for the duration of this PR, even when a tester encounters what
  looks like a latent bug. Bug fixes belong in a separate, follow-up
  spec where the change is visible as a deliberate behaviour change
  and not hidden inside "test infrastructure".
- The two objectives — coverage gate (Story 1) and AS-IS backfill
  (Story 2) — ship in a single PR following the implementation
  order in the user description: (a) wire up the coverage tool with
  no enforced threshold, (b) read the report, (c) write AS-IS
  tests until the report stops growing, (d) lock the floor at the
  achieved level. Splitting into two PRs is rejected because
  shipping (a) without (c) leaves the gate either off (no value) or
  set near-zero (locking in the weak baseline).
- "Coverage stops growing" (FR-009 termination condition) is judged
  pragmatically by the implementer: tests are written until further
  tests would either duplicate existing coverage, exercise
  unreachable defensive branches, or require modifying `src/` (which
  is forbidden by FR-006). Remaining uncovered lines are listed in
  `TESTING.md` so the rationale is visible to future maintainers.
- The acceptance criteria enumerated in the user description (1
  through 7) are folded into the Functional Requirements and
  Success Criteria above; nothing material from that list is
  dropped.
