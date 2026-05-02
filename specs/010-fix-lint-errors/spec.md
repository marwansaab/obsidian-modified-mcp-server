# Feature Specification: Fix Lint Errors

**Feature Branch**: `010-fix-lint-errors`
**Created**: 2026-05-02
**Status**: Draft
**Input**: User description: "Fix Lint Errors — Resolve all 9 problems (8 errors + 1 warning) reported by `npm run lint` against the post-Test-infrastructure-merge tree. Three categories of fix, all in one surgical PR."

## User Scenarios & Testing *(mandatory)*

<!--
  This spec restores a clean lint signal that was broken when the Test
  infrastructure feature (009) merged. The "user" here is a contributor
  who runs `npm run lint` either locally or in their editor. Stories are
  ordered so any one of them, shipped alone, would still leave the tree
  in a strictly better state than it is today.
-->

### User Story 1 - Clean lint signal restored on the post-merge tree (Priority: P1)

A contributor (or an automated check) runs the project's lint command against the current working tree
and gets back a clean, zero-noise result instead of a wall of errors and parser failures. The signal is
trustworthy again: a non-zero exit code or any reported problem indicates a real regression they
introduced, not pre-existing baseline noise.

**Why this priority**: Without this, every contributor sees the same 9 unrelated problems on every lint
run, which trains the team to ignore the lint output entirely. New genuine errors get lost in the noise,
defeating the purpose of running the linter at all. Restoring a clean baseline is the minimum viable
outcome — every other story in this spec is in service of keeping it clean.

**Independent Test**: From a clean checkout of the feature branch, run the lint command. It must exit
with status zero and report zero errors and zero warnings.

**Acceptance Scenarios**:

1. **Given** the post-merge tree on the feature branch, **When** the contributor runs the lint command,
   **Then** the command exits with status zero, prints zero errors, and prints zero warnings.
2. **Given** the post-merge tree on the feature branch, **When** the contributor runs the test command,
   **Then** the test suite passes with no regressions introduced by the lint-fix changes.

---

### User Story 2 - Generated coverage output is excluded from linting at the configuration level (Priority: P1)

A contributor regenerates coverage output (by running the test suite with coverage enabled) and then
runs the linter. The linter does not attempt to parse, analyze, or report on any file inside the
generated coverage tree, regardless of the file extension or contents inside it.

**Why this priority**: The coverage tree is regenerated on every coverage run and contains third-party
HTML-report assets the project does not own. Letting the linter walk into it produces parser errors that
are not actionable and that re-appear every time coverage is regenerated. The exclusion needs to live in
project configuration (not in per-file inline directives) so it survives regeneration and applies
uniformly to every file the coverage tool emits, present and future.

**Independent Test**: Regenerate coverage so the coverage tree exists on disk, then run the lint command
and confirm no diagnostic of any kind references a path inside the coverage tree.

**Acceptance Scenarios**:

1. **Given** the coverage tree exists on disk, **When** the contributor runs the lint command,
   **Then** no error, warning, or parser failure references any path inside the coverage tree.
2. **Given** the coverage tooling later emits an additional file inside the coverage tree, **When** the
   contributor runs the lint command, **Then** that new file is also excluded without any further
   configuration change.
3. **Given** a contributor reads the project's testing/coverage documentation, **When** they look for
   how coverage interacts with linting, **Then** they find a one-line note explaining that the coverage
   tree is excluded from lint and why.

---

### User Story 3 - Top-level configuration files do not produce parser-service errors (Priority: P1)

A contributor or editor integration lints the test-runner configuration file (and any other top-level
project configuration file written in TypeScript). The linter parses the file successfully under the
same typed-lint settings used for the rest of the project, with no "file not found by the project
service" diagnostic.

**Why this priority**: Top-level configuration files are first-class project artifacts — they are
checked in, reviewed, and edited like any other file. Today, at least one of them is invisible to the
typed-lint project service, producing a parser error that masks any real issue the file might have. The
fix must scale: when the project later adds a second or third top-level configuration file in the same
language, the same resolution mechanism must cover it without per-file plumbing.

**Independent Test**: Run the lint command against the post-merge tree. The test-runner configuration
file (and any other top-level configuration file in the same language) produces zero parser-service
diagnostics.

**Acceptance Scenarios**:

1. **Given** the post-merge tree, **When** the contributor runs the lint command, **Then** no
   diagnostic of the form "file was not found by the project service" appears for any top-level
   configuration file.
2. **Given** a contributor later adds a new top-level configuration file in the same language, **When**
   they run the lint command, **Then** the new file is parsed successfully without requiring any
   additional configuration change.

---

### User Story 4 - Test files do not import helpers they don't use, and imports follow project order (Priority: P2)

The two affected test files are tidied so they import only the helpers they actually reference, and the
imports in the larger of the two files are in the order the project's `import/order` rule expects. A
stale lint-disable directive that no longer suppresses anything is removed.

**Why this priority**: This is small surface-area housekeeping that does not affect runtime behavior,
but it is a hard prerequisite for User Story 1: the lint signal cannot be clean while these errors and
warnings remain. It is split out as its own story because it touches test files (not configuration) and
because it can be verified by inspection in isolation from the configuration changes.

**Independent Test**: Inspect the two affected test files and confirm (a) every imported helper from the
test framework is actually referenced in the file body, (b) the imports satisfy the project's
`import/order` rule, and (c) no `eslint-disable` directive that the linter flags as unused remains.

**Acceptance Scenarios**:

1. **Given** the affected test files, **When** the contributor runs the lint command,
   **Then** no "imported but never used" diagnostic is reported for any test-framework helper.
2. **Given** the larger of the two files, **When** the contributor runs the lint command,
   **Then** no `import/order` diagnostic is reported for that file.
3. **Given** the larger of the two files, **When** the contributor runs the lint command,
   **Then** no "unused eslint-disable directive" warning is reported for that file.
4. **Given** the affected test files, **When** the contributor runs the test command,
   **Then** every test in those files still passes.

---

### Edge Cases

- **A test framework helper is the only name on its import line and is unused**: the entire import line
  is removed, not left behind as an empty `import {} from '…'`.
- **A test framework helper is unused but other helpers on the same import line are still used**: only
  the unused name is dropped; the import line itself stays.
- **The auto-fix pass produces a different but still-valid import order than a hand edit would**: the
  auto-fix output is accepted as long as the resulting file passes the `import/order` rule.
- **The lint-disable directive at the flagged location is genuinely needed for an `any` usage on a
  nearby line**: in that case the directive is moved to the tightest scope that actually suppresses the
  rule, instead of being deleted outright.
- **A future contributor adds a fourth top-level configuration file in the same language**: User Story 3
  must continue to hold without any per-file configuration change.
- **A future contributor regenerates coverage with a different reporter that emits new file types**: User
  Story 2 must continue to hold for those new files.
- **The typed-lint tooling installed in the repo is older than the version that supports the
  declarative project-service allowlist**: the resolution chosen by `/speckit-plan` must still produce a
  clean lint run on the version actually present in the repo.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Running the project's lint command against the feature branch's tree MUST exit with
  status zero and report zero errors and zero warnings.
- **FR-002**: The generated coverage tree MUST be excluded from linting via project-level
  configuration (an ignore entry in the lint configuration), not via per-file inline directives.
- **FR-003**: The exclusion described in FR-002 MUST apply to every file under the coverage tree
  regardless of file extension or position within that tree, so that newly emitted coverage files are
  excluded automatically.
- **FR-004**: The project's testing/coverage documentation MUST contain a short note explaining that
  the coverage tree is excluded from linting and why, so that future contributors do not re-introduce
  per-file ignores or attempt to lint coverage output.
- **FR-005**: Top-level project configuration files written in the project's primary language (such as
  the test-runner configuration file) MUST be resolvable by the typed-lint project service, producing
  zero "file was not found by the project service" diagnostics.
- **FR-006**: The mechanism that satisfies FR-005 MUST generalise: adding a new top-level configuration
  file in the same language at the repository root MUST NOT require any per-file plumbing in either the
  lint configuration or the language project configuration.
- **FR-007**: The two affected test files MUST NOT import any test-framework helper that is not
  referenced in the file body. If removing an unused name leaves the import line empty, the entire
  line MUST be removed.
- **FR-008**: The imports in the larger of the two affected test files MUST satisfy the project's
  configured `import/order` rule, including the rule's expectations about blank lines between import
  groups and ordering within a group.
- **FR-009**: The lint-disable directive at the location flagged as unused in the larger of the two
  affected test files MUST either be removed (when the directive is genuinely unnecessary) or relocated
  to the tightest scope where the underlying rule it disables is actually triggered.
- **FR-010**: This change MUST NOT modify any production source file under the project's source tree.
- **FR-011**: This change MUST NOT modify the runtime behaviour of any test: the test command MUST
  pass after the change with no test added, removed, skipped, or rewritten beyond the import-housekeeping
  edits described in FR-007 through FR-009.
- **FR-012**: This change MUST NOT modify the coverage threshold values or the coverage gate
  configuration introduced by the Test infrastructure feature (009). The 82.45% statement-coverage floor
  MUST remain in force and unchanged.
- **FR-013**: All three fix categories (coverage-tree ignore, configuration-file resolution, and
  test-file housekeeping) MUST land together in a single pull request, so the lint signal is clean
  immediately after the PR merges rather than only after a follow-up.

### Out of Scope

- Adding new lint rules, tightening existing rules, or changing the project's lint configuration beyond
  what FR-002, FR-005, and FR-006 require.
- Rewriting any test for clarity or correctness beyond removing unused imports and reordering imports.
- Refactoring production source files, even ones the linter would flag if the configuration were
  stricter.
- Changing coverage reporters, coverage thresholds, or the coverage gate.
- Wiring the lint command into continuous-integration or pre-commit infrastructure. This is called out
  as a recommended follow-up below but is not part of this feature's acceptance.

### Recommended Follow-Up *(not part of this feature's acceptance)*

- If the project does not already enforce the lint command in continuous integration or in a
  pre-commit gate, file a follow-up backlog item to add it. Without that gate, a future commit can
  re-introduce any of the problems this feature fixes without anyone noticing until the next manual
  lint run.

### Key Entities *(include if feature involves data)*

- **Lint configuration**: The single source of truth for what the linter does and does not inspect.
  This feature edits its ignore list and (depending on the resolution chosen by `/speckit-plan`) its
  parser-options block.
- **Language project configuration**: The file that tells the typed-lint project service which files
  are part of the project. Depending on the resolution chosen by `/speckit-plan`, this feature may add
  top-level configuration files to its include list.
- **Generated coverage tree**: The directory the coverage reporter writes into on every coverage run.
  This feature does not change what the coverage tooling writes there; it only changes whether the
  linter looks at it.
- **Affected test files**: Two specific test files (the larger inherited integration test and a
  smaller service test) whose import blocks are tidied. No other test file is modified.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running the lint command against the feature branch produces zero errors and zero
  warnings, down from 8 errors and 1 warning on the post-merge tree.
- **SC-002**: Running the test command against the feature branch passes with the same set of tests
  that pass on the post-merge tree (no test added, removed, or skipped) and with the coverage gate
  still enforcing the 82.45% statement-coverage floor.
- **SC-003**: After regenerating coverage, the coverage tree contains zero files that the linter
  reports on, regardless of how many files the coverage reporter emits.
- **SC-004**: A contributor adding a new top-level configuration file in the project's primary
  language at the repository root and re-running the lint command sees zero diagnostics from the
  typed-lint project service for that new file, with no edit to either the lint configuration or the
  language project configuration required.
- **SC-005**: Zero files under the project's production source tree are modified by the pull request
  that closes this feature.
- **SC-006**: The pull request that closes this feature lands the coverage-tree ignore, the
  configuration-file resolution, and the test-file housekeeping together — verifiable by the lint
  command being clean on the merge commit, not only on a later follow-up commit.

## Assumptions

- The repository's lint configuration is the flat-config form (a single `eslint.config.js` at the
  repository root). The fix to FR-002 lands in the `ignores` array of that file, not in a separate
  legacy ignore file. (`/speckit-plan` should confirm this against the actual repo state and adapt if
  the form differs.)
- The typed-lint tooling installed in the repository supports `projectService: true` (it already
  uses it). Whether it also supports the declarative project-service allowlist is a version-dependent
  detail that `/speckit-plan` will check; if it does not, the fallback resolution (extending the
  language project configuration's include list) is acceptable and is explicitly listed as the
  fallback in the input description.
- The two affected test files inherit from an upstream project. The unused-import edits and import
  reordering are stylistic only and do not change the set of helpers or behaviours the file relies on
  at runtime.
- The coverage tree is the directory written by the coverage reporter wired up in feature 009, at the
  conventional top-level location (`coverage/`). The exact reporter inside that tree is not material
  to this spec; the ignore covers the whole tree.
- "Top-level configuration files in the project's primary language" today means the test-runner
  configuration file. If `/speckit-plan` finds additional ones at the repository root, the same
  resolution must cover them.
- The project's testing/coverage documentation lives in `TESTING.md` (or, failing that, the section of
  `README.md` that covers test and coverage tooling). The note required by FR-004 lands in whichever
  one of these the repository actually uses; `/speckit-plan` confirms.
- "Single pull request" in FR-013 means one merge into the main branch. The pull request may itself
  contain more than one commit.
