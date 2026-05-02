# Implementation Plan: Test Infrastructure (Coverage Gate + AS-IS Backfill)

**Branch**: `009-test-infrastructure` | **Date**: 2026-05-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/009-test-infrastructure/spec.md`

## Summary

Add a build-time coverage gate and an AS-IS characterization-test
backfill of every upstream-inherited public tool that this fork has
not yet covered. Two changes ship in one PR, in this order:

1. **Coverage gate.** Wire Vitest's first-party V8 coverage provider
   (`@vitest/coverage-v8`) into `npm test`. The provider measures
   statement, branch, and function coverage for every file under
   `src/`, emits LCOV (for tooling/CI viewers) and a JSON summary (for
   the gate to read), and fails the build when *aggregate statement
   coverage* across `src/` drops below a configured floor. The floor
   is one numeric field in `vitest.config.ts`
   (`coverage.thresholds.statements`) — the only place the value lives.
2. **AS-IS backfill.** Add unit tests under a new `tests/inherited/`
   directory exercising every uncovered code path in the
   upstream-inherited tools (`src/tools/file-tools.ts`,
   `search-tools.ts`, `write-tools.ts`, `vault-tools.ts`,
   `periodic-tools.ts`, `semantic-tools.ts`,
   `obsidian-tools.ts`) and their shared helpers in
   `src/services/obsidian-rest.ts` and
   `src/services/smart-connections.ts`. Tests use `nock` (already a
   `devDependency`, already the established mocking library used by
   every existing test) so the suite is fully offline. Tests encode
   each line's *currently observed* behaviour as the contract — no
   `src/` modifications are permitted; the byte-for-byte invariant
   (FR-006) is enforced by `git diff main..HEAD -- src/` showing zero
   changes in the PR.

A short top-level `TESTING.md` documents the report path, the
ratchet procedure for the floor, and the convention that
`tests/inherited/` holds AS-IS characterization tests separate from
fork-authored feature tests in `tests/tools/<feature>/` — so a
future maintainer or auditor can identify the AS-IS subset at a
glance (FR-010, SC-006).

## Technical Context

**Language/Version**: TypeScript 5.6+ targeting Node.js >= 18 (per
`package.json` `engines`). Compiled with `tsc --noEmit` clean and
bundled with `tsup`. Tests are TypeScript run directly by Vitest.
**Primary Dependencies**: `vitest@4.1.5` (already installed),
`@vitest/coverage-v8@^4.1.5` (NEW devDependency — must match the
Vitest major), `nock@14.0.13` (already installed and already the
established mocking library used by every existing test). No new
runtime dependencies; this feature is dev-tooling only.
**Storage**: N/A. The build emits the coverage report to
`coverage/` (Vitest's default reportsDirectory). The floor value is
stored in `vitest.config.ts`. No runtime storage.
**Testing**: `vitest run` (existing `npm test` script — unchanged).
The change is a new `coverage` block in `vitest.config.ts` plus
`coverage` reporters (`text` for stdout, `lcov` for CI tools, `json-summary`
for the gate) and `coverage.thresholds.statements` for the gate.
**Target Platform**: Local developer machines and CI runners (the
project's existing GitHub-flow setup). The coverage tool must
function in both; V8 coverage is supported on all Node 18+ targets
and matches the existing `engines` constraint.
**Project Type**: Single project. Source under `src/`, tests under
`tests/` mirroring the source layout. This feature adds one new
top-level test directory: `tests/inherited/`.
**Performance Goals**: SC-007 — `npm test` on a fresh clone with no
network connection completes successfully. The V8 provider runs
in-process (no instrumentation step), so the suite's wall-clock
overhead vs. the current `vitest run` is single-digit percent on a
codebase this size (~1,890 lines of services + ~874 lines of tools).
**Constraints**:
- FR-006 / SC-004: `git diff main..HEAD -- src/` must show zero
  changes. The plan permits zero edits to any file under `src/` for
  the duration of this PR.
- FR-007: All HTTP interactions in tests use the single shared
  mocking layer (`nock`). No per-test ad-hoc stubbing parallel to
  `nock` is permitted.
- FR-009 termination: tests are written until coverage stops
  growing — i.e., further tests would either duplicate existing
  coverage, exercise unreachable defensive branches, or require
  modifying `src/`. The remaining uncovered lines are documented in
  `TESTING.md`.
**Scale/Scope**: Source under test is ~2,764 lines. Inherited tool
modules requiring AS-IS coverage: 7 tool files + 2 service files +
`src/index.ts` dispatcher arms for inherited tools + `src/config.ts`
+ `src/types.ts` (mostly pass-through). Estimated ~30–50 new test
files in `tests/inherited/`, plus `vitest.config.ts` changes,
`TESTING.md`, `package.json` devDependency addition. Zero changes
to `src/`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1
design.*

The four constitutional principles map to this feature as follows:

### Principle I — Modular Code Organization

**Status**: PASS (pre-design and post-design).

This feature adds zero code under `src/`. The byte-for-byte
invariant (FR-006) means module boundaries, import directions, and
single-responsibility decomposition in `src/` are untouched. The
new code lives entirely under `tests/inherited/` and in three repo-
root files (`vitest.config.ts`, `TESTING.md`, `package.json`).
`tests/inherited/` mirrors the `tests/tools/<feature>/` precedent
established by the fork-authored features — one directory per
inherited module, single-purpose test files inside.

### Principle II — Public Tool Test Coverage (NON-NEGOTIABLE)

**Status**: PASS — and this feature actively *resolves* a long-
standing latent violation of this principle.

Principle II requires every tool registered with the MCP server to
have at least one happy-path test and at least one input-validation-
failure-or-upstream-error test. The inherited upstream tools listed
in spec FR-009 do not currently meet this bar — they ship in
`tools/list` but have no tests. Story 2 of this feature adds the
missing tests, retroactively bringing the inherited tools into
Principle II compliance. Concretely, every tool named in FR-009
gets:

- a happy-path test (verifies the tool's request shape against
  `nock`-recorded upstream expectations and that the response is
  forwarded correctly), AND
- an upstream-error path test (mocks a 4xx/5xx/timeout from the
  upstream and asserts the wrapper propagates the error verbatim
  per Principle IV / spec edge case).

Where a tool has required input fields, the input-validation-failure
test is added in addition. Where it has no required fields (e.g.,
`list_files_in_vault`), the upstream-error path satisfies the
"non-happy-path" requirement on its own — same precedent as
`list_tags` in spec 008.

### Principle III — Boundary Input Validation with Zod

**Status**: PASS.

This feature adds no new tool wrappers, no new zod schemas, and no
new input boundaries. It exercises the existing zod schemas in
`src/tools/*.ts` via the AS-IS tests (encoding their current
validation behaviour as the contract), but does not introduce or
modify any of them. If an existing wrapper currently uses a
hand-rolled `typeof`/`instanceof` chain instead of zod, the AS-IS
test encodes that current behaviour as the contract; correcting it
to zod is a follow-up bug-fix spec, not this feature.

### Principle IV — Explicit Upstream Error Propagation

**Status**: PASS.

This feature adds no new error-handling code. The AS-IS tests
exercise each inherited tool's *current* error-propagation
behaviour and lock it in as the contract. If an inherited tool
currently swallows an error (a Principle IV violation), the AS-IS
test encodes the swallowing as the current contract — and a
separate follow-up bug-fix spec opens to remedy the violation. The
characterization-test discipline (FR-006) explicitly prevents this
feature from quietly fixing such issues; the safety-net intent is
to *surface* future regressions, not to *fix* existing bugs while
claiming to test.

### Post-design re-check

Re-evaluated after Phase 1 (data-model + contracts + quickstart):
all four principles still PASS. No Complexity Tracking entries
required. The "byte-for-byte unchanged `src/`" constraint is
unusual for a feature spec but is the central design discipline of
the characterization-test pattern; it does not violate any
principle and is enforced by the Acceptance Scenario 2 / SC-004
diff check.

## Project Structure

### Documentation (this feature)

```text
specs/009-test-infrastructure/
├── plan.md                  # This file
├── research.md              # Phase 0 — coverage tool / mock library / floor config
├── data-model.md            # Phase 1 — Coverage Report, Floor, Characterization Test, Mock Layer
├── contracts/
│   ├── build-gate.md        # Phase 1 — npm test exit codes, threshold semantics
│   └── coverage-config.md   # Phase 1 — vitest.config.ts coverage block schema
├── quickstart.md            # Phase 1 — running tests, viewing coverage, ratcheting the floor
├── spec.md                  # Feature spec
├── checklists/
│   └── requirements.md      # Spec-quality checklist
└── tasks.md                 # Phase 2 output (NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
# UNCHANGED (FR-006 / SC-004 — byte-for-byte invariant):
src/
├── index.ts                 # NO CHANGES
├── config.ts                # NO CHANGES
├── types.ts                 # NO CHANGES
├── services/                # NO CHANGES — tested in tests/inherited/services/
│   ├── graph-service.ts
│   ├── obsidian-rest.ts
│   ├── obsidian-rest-errors.ts
│   └── smart-connections.ts
├── tools/                   # NO CHANGES — inherited tools tested in tests/inherited/tools/
│   ├── file-tools.ts        (inherited)
│   ├── search-tools.ts      (inherited)
│   ├── vault-tools.ts       (inherited)
│   ├── write-tools.ts       (inherited)
│   ├── periodic-tools.ts    (inherited)
│   ├── semantic-tools.ts    (inherited)
│   ├── obsidian-tools.ts    (inherited)
│   ├── delete-file/         (fork-authored, already covered)
│   ├── graph/               (fork-authored, already covered)
│   ├── list-tags/           (fork-authored, already covered)
│   ├── patch-content/       (fork-authored, already covered)
│   └── surgical-reads/      (fork-authored, already covered)
└── utils/
    └── path-normalisation.ts # NO CHANGES (already covered by tests/utils/)

# UNCHANGED:
tests/
├── tools/                   # NO CHANGES — fork-authored feature tests stay here
│   ├── delete-file/
│   ├── graph/
│   ├── list-tags/
│   ├── patch-content/
│   ├── semantic-tools/
│   └── surgical-reads/
└── utils/                   # NO CHANGES
    └── path-normalisation.test.ts

# NEW — AS-IS characterization tests (FR-010, SC-006):
tests/
└── inherited/                       # NEW top-level dir; contains ONLY AS-IS tests
    ├── README.md                    # 1-page note: "these tests encode upstream
    │                                #  behaviour as-is; do not modify src/ to
    │                                #  make them pass."
    ├── tools/
    │   ├── file-tools.test.ts       # get_file_contents, batch_get_file_contents
    │   ├── search-tools.test.ts     # search, complex_search, pattern_search
    │   ├── vault-tools.test.ts      # list_files_in_vault, list_files_in_dir
    │   ├── write-tools.test.ts      # put_content, append_content
    │   ├── periodic-tools.test.ts   # get_periodic_note, get_recent_periodic_notes,
    │   │                            #   get_recent_changes
    │   ├── semantic-tools.test.ts   # semantic_search, find_similar_notes (smart-conn helpers)
    │   └── obsidian-tools.test.ts   # get_active_file, open_file, list_commands,
    │                                #   execute_command
    └── services/
        ├── obsidian-rest.test.ts    # axios setup, safeCall error layer, vault selection,
        │                            #   per-method request shapes for inherited methods
        └── smart-connections.test.ts # smart-connections client setup + helpers

# NEW (repo root):
vitest.config.ts             # NEW — adds `coverage` block; floor lives in
                             #   coverage.thresholds.statements
TESTING.md                   # NEW — report path, ratchet procedure, AS-IS convention
package.json                 # MODIFIED — adds @vitest/coverage-v8 to devDependencies
```

**Structure Decision**: Single project. AS-IS tests live in a new
`tests/inherited/` top-level directory rather than being interleaved
into `tests/tools/<tool>/`. The interleaved alternative was rejected
because Acceptance Scenario 5 / SC-006 require the AS-IS subset to
be identifiable at a glance — a sibling top-level directory beside
`tests/tools/` and `tests/utils/` makes that immediate (one `ls`
shows the boundary). The interleaved alternative would have made the
distinction visible only by filename suffix, which is also workable
but harder to scan and easier for future contributors to drift away
from. The directory-level boundary also means a future maintainer
running `npm test -- tests/inherited/` can isolate the
characterization subset, useful during upstream-merge audits.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. Every constitutional principle passes; this feature *resolves*
a latent Principle II violation rather than introducing one. The
"byte-for-byte unchanged `src/`" constraint is a feature-level
discipline (FR-006), not a constitutional deviation — the
constitution is silent on whether tests may be added without
changing source, and characterization tests are one of the use cases
the principle was designed to enable. No principle is bypassed and
no Complexity Tracking entries are required.
