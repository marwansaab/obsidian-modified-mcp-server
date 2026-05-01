# Phase 0 Research: Test Infrastructure

This document records the design decisions made during Phase 0 of
spec 009. Each decision resolves a `/speckit-plan`-deferred choice
in the spec's Assumptions section. Alternatives considered are
listed for the audit trail; rationale focuses on fit with the
existing fork rather than abstract merits.

---

## R1 — Coverage tool: `@vitest/coverage-v8`

**Decision**: Use `@vitest/coverage-v8` (Vitest's first-party V8
coverage provider). Add as a `devDependency` matching the existing
Vitest major (`^4.1.5`).

**Rationale**:

- The existing test runner is `vitest@4.1.5` invoked via
  `npm test` → `vitest run`. The V8 provider is built into the
  Vitest ecosystem and integrates as a configuration block in
  `vitest.config.ts` — no separate runner, no second test command,
  no Babel/transform step.
- Uses Node's built-in V8 coverage instrumentation. Zero source
  rewrite, fast: on a codebase this size (~2,764 lines of `src/`)
  the wall-clock overhead vs. plain `vitest run` is single-digit
  percent.
- Native LCOV reporter (for human/CI viewers and for tools like
  Codecov/SonarQube if the maintainer adds them later) AND native
  JSON-summary reporter (machine-readable totals at
  `coverage/coverage-summary.json`, suitable for the build gate to
  read aggregate statement coverage).
- Native `text` reporter prints a concise per-file coverage summary
  to stdout on every `npm test` run, so a developer running tests
  locally sees the gap without opening LCOV — addresses the
  "console output on failure" question raised but deferred during
  `/speckit-clarify`.
- Built-in support for `coverage.thresholds.statements` — i.e., the
  gate the spec requires (FR-003) is a single existing config field
  that Vitest already enforces with a non-zero exit code on
  threshold violation. No custom script needed.

**Alternatives considered**:

| Alternative | Why rejected |
|-------------|-------------|
| `@vitest/coverage-istanbul` | Fully supported by Vitest, but Istanbul instrumentation rewrites source on every run, slower, and produces output that is functionally equivalent to V8 for this project's needs. No tradeoff worth the slowdown. |
| `nyc` (Istanbul standalone) | Would require running Vitest under `nyc`, duplicating the wrapper layer. More moving parts, less idiomatic for a Vitest project. |
| `c8` (standalone V8) | Predecessor of `@vitest/coverage-v8`; uses the same V8 provider but without Vitest integration. Choosing it over `@vitest/coverage-v8` would mean reinventing the integration the Vitest team already maintains. |
| Hand-rolled coverage (e.g., custom Jest-style instrumentation) | Vastly more work; no upside. |

---

## R2 — HTTP mocking layer: `nock`

**Decision**: Use `nock@14.0.13` (already a `devDependency`) as the
single shared HTTP-mocking layer. All AS-IS tests under
`tests/inherited/` consume it; no new mocking library is added.

**Rationale**:

- `nock` is already the established HTTP-mocking layer in this
  fork: every existing test that needs an upstream HTTP response
  (`tests/tools/delete-file/*.test.ts`,
  `tests/tools/list-tags/handler.test.ts`,
  `tests/tools/list-tags/upstream-error.test.ts`) uses `nock`. FR-007
  in the spec says "exactly one library used everywhere" — that one
  library is already `nock` for the existing tests. Choosing
  anything else for the AS-IS subset would create two mocking
  conventions, the exact divergence FR-007 forbids.
- `nock` intercepts at the `http`/`https` module level, which is
  what `axios` (used by `obsidian-rest.ts` and `smart-connections.ts`)
  ultimately calls into. Verified by reading the existing
  `delete-file` tests: the same `nock(BASE_URL).get(...)` pattern
  works for every wrapper method.
- `nock.cleanAll()` + `nock.enableNetConnect()` in `afterEach`
  isolates tests from each other and prevents real network calls
  if a test forgets to register an interceptor — critical for
  SC-007 (the suite must work offline).

**Alternatives considered**:

| Alternative | Why rejected |
|-------------|-------------|
| `msw` (Mock Service Worker) | Newer, idiomatic for browser-side React testing and Node service worker. Strictly worse fit here — the existing tests are nock and migrating them would be churn outside the scope of "test infrastructure". |
| `undici` MockAgent | Bundled with Node 18+, no extra dep. But `axios` doesn't use undici by default in the relevant Node versions, and routing axios through a custom `httpAgent` to undici-mock is more plumbing than nock's transparent interception. |
| Per-test ad-hoc HTTP stubs | Explicitly forbidden by FR-007. |

---

## R3 — Coverage report path and emitted formats

**Decision**: The coverage report is written to `coverage/` (the
default `coverage.reportsDirectory` in Vitest). Three reporters are
enabled:

| Reporter | Output | Consumed by |
|----------|--------|-------------|
| `text` | stdout (printed on every `npm test`) | Developers reading test output locally |
| `lcov` | `coverage/lcov.info` + `coverage/lcov-report/index.html` | CI viewers, Codecov-style tools, humans clicking through |
| `json-summary` | `coverage/coverage-summary.json` | The build gate (Vitest reads it via `coverage.thresholds`) and any future automation |

**Rationale**:

- `coverage/` is Vitest's documented default and is the convention
  CI tools expect; using it means no custom configuration is
  required to wire in Codecov or similar later.
- All three reporters add negligible cost (the V8 provider gathers
  data once; the reporters serialize from the same in-memory model).
- The path will be added to `.gitignore` so coverage artifacts are
  not committed. CI runners that publish coverage fetch it from
  this path.

**Alternatives considered**:

| Alternative | Why rejected |
|-------------|-------------|
| `text-summary` instead of `text` | Less informative; doesn't show per-file breakdown. The `text` reporter is the one developers actually want to see. |
| Only LCOV (no JSON summary) | The build gate would have to parse LCOV — verbose and slow. JSON summary is the canonical machine-readable format. |
| Custom path under `tests/` | Conflates artifacts with source. Deviates from convention with no benefit. |

---

## R4 — Floor configuration location: `vitest.config.ts`

**Decision**: The coverage floor lives in `vitest.config.ts` at
`coverage.thresholds.statements`. This is the single source of
truth; CI scripts and build wiring do not duplicate the value.

**Rationale**:

- FR-005 says: "The coverage floor MUST be stored in a single
  repo-side config file (e.g., a top-level `coverage.config.*` or a
  dedicated section in `package.json`). Raising or lowering the
  floor MUST be a one-line edit to that file." `vitest.config.ts`
  satisfies this: it is a single repo-side config file, and the
  threshold is a single field. Editing `coverage.thresholds.statements`
  from one number to another is the one-line edit.
- Vitest natively enforces `coverage.thresholds.statements`: when
  the run's aggregate statement coverage falls below the value,
  Vitest exits non-zero with a diagnostic message naming the
  threshold and the actual value. No custom build script is
  required to enforce the gate.
- Per the `/speckit-clarify` Q1 decision, only the *aggregate* `src/`
  floor is enforced, not per-file. Vitest's
  `coverage.thresholds.statements` is the aggregate threshold;
  per-file thresholds are a separate, opt-in field
  (`coverage.thresholds.perFile`) that we leave unset.
- Per the `/speckit-clarify` Q2 decision, only statement coverage is
  gated. The `coverage.thresholds.branches` and
  `coverage.thresholds.functions` fields are *not* set; both metrics
  are still measured and emitted in the report (FR-002), but neither
  fails the build.
- Per the `/speckit-clarify` Q3 decision, lowering the floor is just
  an edit to the same field — visible in `git diff` and reviewed in
  PR. No additional override flag.

**Alternatives considered**:

| Alternative | Why rejected |
|-------------|-------------|
| Top-level `coverage.config.ts` (separate file) | Would either duplicate the value (one in `vitest.config.ts`, one in `coverage.config.ts`) or require Vitest to import from it — extra plumbing for no benefit. |
| `package.json` `"vitest"` block | `package.json` doesn't natively host Vitest config; would either require a non-trivial loader or split config across two files. |
| CI YAML threshold | Forbidden by FR-005 — CI scripts must not hardcode a competing threshold. |

---

## R5 — AS-IS test directory layout: `tests/inherited/`

**Decision**: All AS-IS characterization tests live under a new
top-level directory `tests/inherited/`, mirroring the inherited
`src/` modules: `tests/inherited/tools/<tool-file>.test.ts` and
`tests/inherited/services/<service-file>.test.ts`. A 1-page
`tests/inherited/README.md` explicitly states the AS-IS discipline
(no `src/` modifications; encode current behaviour as the contract).

**Rationale**:

- FR-010 / SC-006: a future maintainer or auditor must be able to
  identify the AS-IS subset at a glance, without reading test
  bodies. A sibling top-level directory is the most visible
  distinction possible — `ls tests/` shows
  `tools/`, `utils/`, `inherited/`, and the boundary is immediate.
- Filename-suffix conventions (e.g., `*.asis.test.ts` interleaved
  inside `tests/tools/<tool>/`) were considered but rejected:
  workable, but harder to scan, and easier for a future
  contributor to drift away from when adding a new test ("do I
  put it in `<tool>.test.ts` or `<tool>.asis.test.ts`?"). The
  directory-level boundary forces the answer.
- Running `npm test -- tests/inherited/` isolates the
  characterization subset — useful during upstream-merge audits
  ("did the merge break any of the AS-IS contracts?").
- The mirroring layout (`tests/inherited/tools/`,
  `tests/inherited/services/`) parallels `src/tools/` and
  `src/services/`, so test-to-source navigation stays mechanical.
- The 1-page README inside the directory is intentionally brief
  and is not the canonical doc — the canonical doc is the
  top-level `TESTING.md`. The README's only job is to remind a
  contributor opening the directory of the AS-IS rule before
  they write a test.

**Alternatives considered**:

| Alternative | Why rejected |
|-------------|-------------|
| Interleave AS-IS tests inside `tests/tools/<tool>/` with `*.asis.test.ts` filename suffix | Workable and idiomatic in some codebases, but Acceptance Scenario 5 / SC-006 require "at a glance" identification, which a directory boundary delivers more strongly than a filename suffix. |
| Single flat `tests/inherited/*.test.ts` (no `tools/` / `services/` subdirs) | Loses the source-mirroring; finding the test for a given source file requires reading filenames rather than navigating directories. Marginal but unnecessary. |
| Move existing fork-authored tests to `tests/feature/` to make the boundary symmetric | Out of scope — this PR adds the AS-IS subset; renaming existing test directories is gratuitous churn. |

---

## R6 — Baseline coverage measurement procedure

**Decision**: The implementer runs `npm test` *after* wiring up
`@vitest/coverage-v8` but *before* writing any AS-IS tests. The
report at that point shows coverage delivered by the existing
fork-authored feature tests only — this is the **baseline**. The
implementer reads `coverage/coverage-summary.json` and the
per-file breakdown to identify which files are at 0% (not yet
exercised) and which are partial (existing tests touch them
incidentally). AS-IS tests are added until the report stops growing
(FR-009 termination condition). The final aggregate statement
coverage at that point becomes the value of
`coverage.thresholds.statements` — committed in the same final
commit that adds the last AS-IS test.

**Rationale**:

- The user's prompt prescribes this order explicitly: "(a) wire up
  the coverage tool with no threshold set — just measurement and
  reporting against the existing feature-spec tests; (b) read the
  coverage report to identify uncovered paths; (c) backfill AS-IS
  unit tests for each uncovered path until the report stops
  growing; (d) lock the coverage floor at the achieved level in
  the build gate."
- Setting the floor before the AS-IS work is complete would either
  fail every intermediate run (if set high) or lock in a weak
  baseline (if set low). The spec edge case "Floor is set to 0%
  before the AS-IS work" notes this and prescribes the no-floor /
  measure-then-set sequence.
- The exact baseline percentage is not predictable in advance —
  it depends on which lines of inherited modules the existing
  feature-spec tests happen to touch. That's why FR-004 binds the
  initial floor to "whatever the AS-IS backfill achieves," not to
  a chosen number.

**No alternatives**: this is the user-prescribed sequence.

---

## R7 — Coverage exclusion list: minimal

**Decision**: No source files are excluded from coverage
measurement. Every file under `src/` contributes to the aggregate
denominator. The only exclusions are non-source paths (`dist/`,
`node_modules/`, `tests/` itself).

**Rationale**:

- The spec's central goal is "every line of code that is not
  currently covered" should have a test. Excluding files from the
  measurement would let some code escape the safety net by
  configuration rather than because it's unreachable.
- Common exclusion candidates (barrel `index.ts` files,
  type-only files) are small in this codebase. `src/types.ts`
  has 121 lines but is mostly TypeScript types (which contribute
  zero statements to V8's count after type-erasure compilation,
  so they do not need exclusion — V8 simply doesn't see them).
  `src/tools/index.ts` is a re-export barrel; its few executed
  lines are exercised by any test that imports a tool.
- If a genuinely unreachable defensive line is encountered during
  AS-IS work (per the spec edge case "A line in `src/` is
  genuinely unreachable"), the line is **left uncovered**, not
  excluded. The floor is set to a value that acknowledges the
  uncovered remainder, and the line is documented in
  `TESTING.md`. This keeps the measurement honest.

**Alternatives considered**:

| Alternative | Why rejected |
|-------------|-------------|
| Exclude `src/types.ts` from measurement | Unnecessary — V8 already produces zero statements for type-only files. Adding the exclusion adds maintenance burden for no behavioural change. |
| Exclude `src/index.ts` (entry point) | Would let the dispatcher's `case` arms escape coverage tracking, which is exactly the surface that matters most. Rejected. |
| Exclude all barrels (`*/index.ts`) | Same as above — barrels are tiny and trivially covered by any import; excluding them creates a precedent that grows. |

---

## R8 — Test runtime budget: not enforced in this feature

**Decision**: No hard wall-clock budget is set for `npm test`.
This is deferred to a future ratchet step if the suite grows past
a perceptible-pause threshold for local development.

**Rationale**:

- Estimated 30–50 new test files in `tests/inherited/`. With
  `nock` (in-process, no network) and Vitest's parallel-by-default
  execution, total runtime is expected to remain in the seconds
  range on a developer machine — well below any threshold worth
  enforcing.
- Setting an arbitrary budget now (e.g., "must complete in <60s")
  would constrain test design without evidence the constraint
  matters. Easier to add the budget later if a real problem
  emerges.
- This was raised but deferred during `/speckit-clarify` for the
  same reason.

---

## Open items deferred to implementation

- **The exact set of AS-IS tests per inherited tool.** Phase 1
  contracts (`contracts/build-gate.md`,
  `contracts/coverage-config.md`) define the gate's interface but
  not the per-tool test list. The per-tool test plan is
  produced by `/speckit-tasks` in Phase 2 and refined while
  reading the actual baseline coverage report.
- **The numeric floor value.** Bound by FR-004 to the AS-IS
  achievement; not knowable until Phase 2 implementation runs the
  coverage tool.
