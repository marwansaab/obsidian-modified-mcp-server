# Phase 1 Data Model: Test Infrastructure

This feature has no runtime data — it is dev-tooling. The
"entities" are the configuration values, artifacts, and conventions
the build gate produces and consumes. Documenting them here
canonicalizes their fields so contracts and tasks can refer to
them precisely.

---

## Entity 1 — Coverage Floor

**What it represents**: The single numeric threshold the build
gate enforces against aggregate statement coverage of `src/`.

**Storage**: `vitest.config.ts`, field
`test.coverage.thresholds.statements`. One number, integer or float
in `[0, 100]`.

**Fields**:

| Field | Type | Source | Constraint |
|-------|------|--------|------------|
| value | number | manual edit to `vitest.config.ts` | `0 ≤ value ≤ 100`; written as a percentage (e.g., `82.4` means 82.4 %) |
| metric | implicit (statements) | hardcoded in Vitest config block | only the `statements` field is set; `branches` and `functions` are intentionally absent |
| scope | implicit (aggregate `src/`) | hardcoded in Vitest config block | the `coverage.include: ['src/**']` setting and the absence of `coverage.thresholds.perFile` together imply aggregate-only |

**Lifecycle**:

| Transition | Trigger | Authorized? |
|------------|---------|-------------|
| unset → first value | This feature's final commit, after AS-IS work completes | Yes (FR-004) |
| value N → value M, M > N | A future PR that improves coverage and ratchets the floor | Yes (FR-005, SC-005) |
| value N → value M, M < N | A future PR that intentionally lowers the floor | Yes, but only via a visible one-line diff to this same field (FR-005, `/speckit-clarify` Q3) — the diff IS the override |
| value → removed/null | A future PR that disarms the gate | Discouraged but technically permitted; would show up as a deletion in `git diff` |

**Validation rules**:

- The build gate (Vitest's threshold check) applies the value
  literally. There is no separate enforcement of monotonic-upward
  ratcheting; the rule "never lower without explicit override" is
  enforced by PR review against the visible diff.
- Removing the field is *not* equivalent to setting it to `0` — it
  disarms the gate entirely (Vitest skips the threshold check).
  PR review must catch removals the same way it catches lowerings.

---

## Entity 2 — Coverage Report

**What it represents**: A per-file, per-metric record of which
statements/branches/functions were executed during the test run.
Produced by the V8 provider on every `npm test`.

**Storage**: `coverage/` directory at repo root, in three formats:

| File | Format | Purpose |
|------|--------|---------|
| (stdout) | `text` reporter | Per-file table printed during `npm test` for developers |
| `coverage/lcov.info` | LCOV | Standard format consumed by Codecov, SonarQube, IDE viewers |
| `coverage/lcov-report/index.html` | HTML (auto-generated from LCOV) | Human-clickable line-by-line view |
| `coverage/coverage-summary.json` | JSON | Aggregate totals; canonical machine-readable format |

**Fields** (using the JSON-summary shape as the canonical model;
LCOV carries equivalent information in its own format):

```text
{
  "total": {
    "statements": { "total": N, "covered": M, "skipped": 0, "pct": M/N*100 },
    "branches":   { "total": N, "covered": M, "skipped": 0, "pct": M/N*100 },
    "functions":  { "total": N, "covered": M, "skipped": 0, "pct": M/N*100 },
    "lines":      { "total": N, "covered": M, "skipped": 0, "pct": M/N*100 }
  },
  "<absolute-path-to-source-file>": { ...same shape per file }
}
```

**Relationships**:

- The Coverage Floor (Entity 1) is the threshold compared against
  `total.statements.pct` from this report. Vitest does the
  comparison; the build exit code is non-zero iff
  `total.statements.pct < floor.value`.
- The report covers every file matched by `coverage.include`
  (`src/**`). Files matched by `coverage.exclude` are absent — but
  per R7, no source files are excluded.

**Lifecycle**:

- Generated fresh on every `npm test` run that includes the
  coverage block.
- Written to `coverage/`. The directory is in `.gitignore`; reports
  are never committed.
- Read by Vitest's threshold check for the gate, and by
  developers/CI for diagnosis.

---

## Entity 3 — Characterization Test

**What it represents**: A unit test added by this feature whose
role is to encode an existing line's *currently observed* behaviour
as the contract — not to validate a desired specification. Each
characterization test is identifiable by its location under
`tests/inherited/` (FR-010, SC-006).

**Fields** (per test file):

| Field | Type | Source / Convention |
|-------|------|---------------------|
| location | filesystem path | `tests/inherited/{tools,services}/<source-file>.test.ts` |
| target | source file path | mirrored from `tests/inherited/...` to `src/...` (e.g., `tests/inherited/tools/file-tools.test.ts` targets `src/tools/file-tools.ts`) |
| mocking layer | string identifier | `nock` — required by FR-007; no other library used |
| modifies `src/`? | boolean | always `false` — required by FR-006 |
| tests fork-authored feature? | boolean | always `false` — required by FR-009 |
| asserts current behaviour as contract? | boolean | always `true` — the discipline of this feature |

**Relationships**:

- Targets a specific source file under `src/` and exercises its
  paths via the public entry points of the tool/service (handler
  functions, exported methods).
- Uses the Shared Mocking Layer (Entity 4) for any HTTP
  interaction.
- Contributes to the Coverage Report (Entity 2) by exercising
  previously-uncovered paths.

**Identification convention**: A future maintainer answers "is
this an AS-IS characterization test or a fork-authored feature
test?" by location alone:

- Path begins with `tests/inherited/` → AS-IS characterization
- Path begins with `tests/tools/` or `tests/utils/` → fork-authored

The 1-page `tests/inherited/README.md` reinforces this rule for
contributors opening the directory.

---

## Entity 4 — Shared Mocking Layer

**What it represents**: The single library and conventions through
which every test obtains HTTP responses, instead of making real
network calls. This feature does not introduce a new mocking layer —
it canonicalizes `nock` (already used by every existing test) as
the single layer (FR-007).

**Fields**:

| Field | Value |
|-------|-------|
| library | `nock@14.0.13` (existing `devDependency`) |
| interception level | `http`/`https` Node modules (transparent to `axios`) |
| isolation per test | `nock.cleanAll()` + `nock.enableNetConnect()` in `afterEach` |
| offline guarantee | A test that forgets to register an interceptor and tries to make a real call gets a `Nock: No match for request` error, failing fast — never reaches the network |

**Conventions** (extracted from existing fork tests, codified in
`TESTING.md`):

- Mock the upstream by `BASE_URL = ${vault.protocol}://${vault.host}:${vault.port}`,
  matching how `ObsidianRestService` constructs its axios client.
- Use specific path matchers (e.g., `.get('/vault/foo.md')`)
  rather than regex — keeps test failures pointing at the exact
  endpoint that mismatched.
- For error-path tests, use `.reply(401, { errorCode: 401, message: '...' })`
  matching the upstream's actual error shape; this exercises
  `safeCall`'s `data?.errorCode ?? error.response?.status` fallback
  in `obsidian-rest.ts`.

**Relationships**:

- Consumed by every Characterization Test (Entity 3) that needs an
  upstream response.
- Already consumed by every fork-authored feature test (no change
  to those tests is required for FR-007 — they already comply).

---

## Non-entities (intentionally out of scope)

The spec lists "frontmatter parsing" as a possible shared helper.
Reading `src/services/obsidian-rest.ts` and the inherited tool
files confirms there is no dedicated frontmatter-parsing module
in this fork — frontmatter handling lives inline inside specific
handlers (e.g., `surgical-reads/frontmatter-handler.ts`, which is
fork-authored and already covered). No new entity is needed for
"frontmatter parsing"; if AS-IS work later finds inline parsing
inside an inherited handler, it is exercised as part of that
handler's characterization test under `tests/inherited/tools/`,
not as a separate entity.
