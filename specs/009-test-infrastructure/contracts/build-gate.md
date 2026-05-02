# Contract: Build Gate (`npm test`)

This contract specifies the observable behaviour of `npm test` after
this feature lands. It is the surface the build gate exposes to
developers and CI.

## Inputs

| Input | Source | Notes |
|-------|--------|-------|
| Test files | filesystem | All `*.test.ts` under `tests/` (existing `tests/tools/`, `tests/utils/`, plus new `tests/inherited/`) |
| Floor value | `vitest.config.ts` → `test.coverage.thresholds.statements` | Single number `[0,100]` (percentage). Absent ⇒ gate disarmed |
| Source under coverage | `vitest.config.ts` → `test.coverage.include` | `['src/**']` — every file under `src/` |
| Network | none | `nock` blocks all real HTTP via `nock.disableNetConnect()` in shared setup; SC-007 |

## Outputs

### stdout (always)

1. Vitest's standard test output (per-test pass/fail/skip).
2. The `text` coverage reporter's per-file summary table at end of
   run, e.g.:

   ```text
   ----------------------|---------|----------|---------|---------|
   File                  | % Stmts | % Branch | % Funcs | % Lines |
   ----------------------|---------|----------|---------|---------|
   All files             |   84.2  |   72.1   |   88.9  |   84.7  |
    src/services         |   91.0  |   80.4   |   94.0  |   91.2  |
     graph-service.ts    |  100.0  |   95.0   |  100.0  |  100.0  |
     obsidian-rest.ts    |   88.0  |   75.0   |   90.0  |   88.5  |
   ...
   ```

3. If the gate triggers, Vitest prints a threshold-violation
   message naming the metric, the configured floor, and the actual
   value:

   ```text
   ERROR: Coverage for statements (78.4%) does not meet global threshold (82.0%)
   ```

### Filesystem (always, when coverage block is enabled)

| Path | Format | Created on | Notes |
|------|--------|-----------|-------|
| `coverage/lcov.info` | LCOV | Every run | Standard machine-readable line/branch hit data |
| `coverage/lcov-report/index.html` (+ assets) | HTML | Every run | Click-through human view |
| `coverage/coverage-summary.json` | JSON | Every run | Aggregate totals; used by Vitest's threshold check |

The directory is created if absent (Edge case from spec: "Coverage
report path does not exist on first run").

The directory is `.gitignore`d; the reports are never committed.

### Exit code

| Condition | Exit code |
|-----------|-----------|
| All tests pass AND aggregate statement coverage ≥ floor (or floor unset) | `0` |
| Any test fails | non-zero (Vitest's standard failure code) |
| All tests pass BUT aggregate statement coverage < floor | non-zero (Vitest's threshold-failure exit code) |

The two failure modes are distinguished by the stdout message; both
produce non-zero exit. CI does not need to distinguish them — either
blocks the merge.

## Invariants

- **No real HTTP requests** are made during `npm test`. Verified by
  `nock.disableNetConnect()` in the shared setup and the absence of
  any test that calls `nock.enableNetConnect()` outside of an
  `afterEach` cleanup. (SC-007)
- **No Obsidian instance is required.** Every upstream interaction
  is satisfied by `nock` interceptors. (FR-001, SC-007)
- **No `src/` modification is required to pass the gate.** The
  initial floor is set to whatever the AS-IS work achieves
  (FR-004); the gate cannot demand coverage that requires changing
  source code. (FR-006, SC-004)
- **Branch and function coverage are reported but advisory.** Their
  values appear in the report; they do not influence the gate's
  exit code. (FR-002, `/speckit-clarify` Q2)
- **Per-file coverage dips do not fail the build.** Only aggregate
  `src/` statement coverage is gated. (FR-003, `/speckit-clarify` Q1)

## Verification (recorded in PR description)

The gate's behaviour MUST be verified during implementation by:

1. Running `npm test` and confirming the suite passes with coverage
   reports written to `coverage/`.
2. Temporarily deleting one test (e.g., `git rm
   tests/tools/list-tags/handler.test.ts`), running `npm test`,
   confirming the build exits non-zero with the threshold-violation
   message, then restoring the test.

Both steps are required; the second is what makes SC-001 ("the gate
is real, not a warning that scrolls past in CI logs") verifiable.
