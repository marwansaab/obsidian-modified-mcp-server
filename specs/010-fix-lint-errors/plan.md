# Implementation Plan: Fix Lint Errors

**Branch**: `010-fix-lint-errors` | **Date**: 2026-05-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/010-fix-lint-errors/spec.md`

## Summary

Restore a clean `npm run lint` on the post-009-merge tree by making three
configuration-only changes plus surgical test-file housekeeping, all in one
PR. No production source code changes; no test runtime-behaviour changes;
no coverage-gate threshold change.

The plan resolves the one decision the spec deferred — how to make
top-level `*.config.ts` files visible to the typescript-eslint project
service. **Decision: extend `tsconfig.json`'s `include` array with the
glob `*.config.ts`** (option (a) in the spec input). Rationale, rejected
alternative, and version-fallback notes are in
[research.md](research.md).

The plan also corrects one factual carry-over from the input description:
the actual coverage floor is **82.4%** (the value in
[`vitest.config.ts`](../../vitest.config.ts) and [TESTING.md](../../TESTING.md)),
not the 82.45% the spec text quotes. FR-012 / SC-002 will be patched to
match real state when the spec is touched again; the implementation
honours the real value either way.

## Technical Context

**Language/Version**: TypeScript 5.6.x, Node.js >= 18 (per `package.json` `engines`).
**Primary Dependencies**: ESLint 9.12.x (flat config), `@typescript-eslint/{eslint-plugin,parser}` 8.50.x, vitest 4.1.x, `@vitest/coverage-v8` 4.1.x.
**Storage**: N/A (developer-tooling change).
**Testing**: vitest with `@vitest/coverage-v8` (statement-coverage gate at 82.4% over `src/**`); see [TESTING.md](../../TESTING.md).
**Target Platform**: Developer workstations and (recommended follow-up) any future CI/pre-commit harness — no runtime target affected.
**Project Type**: Single TypeScript project (library + CLI bin), see [`package.json`](../../package.json) and the existing layout under `src/`, `tests/`, and `scripts/`.
**Performance Goals**: N/A (no runtime code touched).
**Constraints**:
- MUST NOT modify any file under `src/` (FR-010).
- MUST NOT modify the coverage threshold value or coverage-gate configuration shape (FR-012).
- MUST land all three fix categories in one PR (FR-013).
- The fix to FR-005/FR-006 MUST scale to additional top-level `*.config.ts` files without per-file plumbing.
**Scale/Scope**: 4 file edits (1 lint config, 1 ts config, 2 test files) + 1 doc edit (`TESTING.md`). Approx. 15–25 lines net.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution at [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) v1.0.0 imposes four principles and a Technical Standards block. Mapping this feature to each:

| Principle / standard | Applies? | Verdict |
|---|---|---|
| I. Modular Code Organization | No change to module boundaries; only configuration files and test imports edited. | **PASS** |
| II. Public Tool Test Coverage (NON-NEGOTIABLE) | No public tool added, removed, renamed, or modified; no test-coverage shift. | **PASS** |
| III. Boundary Input Validation with Zod | No tool wrapper touched. | **PASS** |
| IV. Explicit Upstream Error Propagation | No error-handling code touched. | **PASS** |
| TS standard "no `any` in tool wrapper signatures" | No tool wrapper signatures changed. The `eslint-disable @typescript-eslint/no-explicit-any` removal at `tests/inherited/index.test.ts:101` is in a test file, not a wrapper, and removing the *directive* (the rule already wasn't firing) does not introduce any. | **PASS** |
| Lint & format gate ("eslint flat config MUST pass with zero warnings before merge") | This feature is the literal enforcement of this gate against the post-009-merge tree. | **PASS** (re-establishes compliance) |
| Quality gate 1 (`npm run lint` passes) | Currently violated on the post-merge tree; this feature restores compliance. | **PASS** (after this feature lands) |
| Quality gate 2 (`npm run typecheck` passes) | Adding `*.config.ts` to `tsconfig.json` `include` brings `vitest.config.ts` and `tsup.config.ts` into the typecheck graph. Both files already type-check today (they are valid TS using public types from `vitest/config` and `tsup`). Verified during research; see [research.md](research.md). | **PASS** |
| Quality gate 3 (`npm run build` succeeds) | `tsup` compiles only from `src/` per current build pipeline; configuration-file inclusion in `tsconfig.json` `include` does not change the `tsup` entrypoints, so the published `dist/` is unaffected. | **PASS** |
| Quality gate 4 (test suite covering all public tools passes) | No test added, removed, or skipped; only unused vitest helper imports dropped and import order corrected. The coverage gate at 82.4% remains untouched. | **PASS** |

**Constitution Check verdict**: All gates pass. No "Complexity Tracking" entry required. No deviation to justify.

## Project Structure

### Documentation (this feature)

```text
specs/010-fix-lint-errors/
├── plan.md                      # This file
├── research.md                  # Phase 0 — resolution (a) vs (b), version-fallback, threshold-typo
├── data-model.md                # Phase 1 — entities (lint config, language project config, ...)
├── quickstart.md                # Phase 1 — exact verification recipe for a reviewer
├── contracts/
│   └── lint-and-config-contracts.md   # Phase 1 — concrete contract assertions per FR
├── checklists/
│   └── requirements.md          # Spec-quality checklist (already filled by /speckit-specify)
└── tasks.md                     # Phase 2 output — created by /speckit-tasks
```

### Source Code (repository root)

```text
obsidian-modified-mcp-server/
├── eslint.config.js                 # EDIT — add 'coverage/**' to flat-config `ignores`
├── tsconfig.json                    # EDIT — extend `include` with the glob "*.config.ts"
├── vitest.config.ts                 # NO EDIT — already exists and parses correctly under TS;
│                                    #          the include-glob fix makes it visible to the
│                                    #          eslint project service.
├── tsup.config.ts                   # NO EDIT — currently in eslint.config.js `ignores`; left
│                                    #          ignored because un-ignoring it is out of scope
│                                    #          (FR-010 / Out of Scope).
├── coverage/                        # GENERATED — newly excluded from lint via the ignore added
│                                    #             to eslint.config.js.
├── TESTING.md                       # EDIT — one-line note: "the coverage tree is excluded from
│                                    #         lint at the eslint flat-config level."
├── tests/
│   ├── inherited/
│   │   ├── index.test.ts            # EDIT — drop unused `beforeAll` import; reorder imports
│   │   │                            #        so `nock` precedes `node:fs` and the empty line
│   │   │                            #        inside the import group is removed; delete the
│   │   │                            #        unused `eslint-disable @typescript-eslint/no-
│   │   │                            #        explicit-any` directive at line 101.
│   │   └── services/
│   │       └── smart-connections.test.ts  # EDIT — drop unused `beforeEach` import.
│   └── (all other tests untouched)
└── src/                             # NO EDIT — production source untouched (FR-010).
```

**Structure Decision**: Single-project layout — same shape as the rest of the
repository. No new directories created at the source-tree level. The only new
directory is the spec directory itself
(`specs/010-fix-lint-errors/`). The plan touches **6 files** in total (5 edits
+ 1 doc edit; no creates, no deletes).

### Files NOT touched (intentional)

- Anything under `src/` (FR-010).
- The vitest coverage-threshold value (FR-012).
- `tsup.config.ts` itself — left in `eslint.config.js` `ignores` because lifting that ignore would expand scope beyond the spec.
- `eslint.config.js` self-ignore (`'eslint.config.js'`) — likewise out of scope.
- Any test other than the two listed (FR-011).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

(No violations. Section intentionally empty.)

## Phase 0 — Research

Captured in [research.md](research.md). Key decisions:
1. **R-1** Resolution (a) over (b) for FR-005/FR-006 — adopt the `tsconfig.json` `include` glob `*.config.ts`. typescript-eslint 8.50.1 supports `allowDefaultProject` (option b), but option (a) gives consistent typed-lint behaviour and a glob already scales to future config files. (b) reserved as fallback only if a future tooling regression breaks (a).
2. **R-2** Coverage tree ignore pattern is `'coverage/**'`, matching the existing `'dist/**/*'` style in [`eslint.config.js`](../../eslint.config.js) line 13.
3. **R-3** The coverage-floor figure quoted in the spec ("82.45%") is a typo; the canonical value is **82.4%** in [`vitest.config.ts`](../../vitest.config.ts) line 15 and [TESTING.md](../../TESTING.md) line 41. FR-012/SC-002 require a one-character spec patch; the implementation does not depend on the patch.
4. **R-4** The `eslint-disable @typescript-eslint/no-explicit-any` directive at [`tests/inherited/index.test.ts:101`](../../tests/inherited/index.test.ts#L101) is genuinely unnecessary — the next line uses `unknown` (no `any`). Resolution: delete the directive (FR-009 first branch).
5. **R-5** Auto-fix order: run `npx eslint --fix` first to resolve `import/order` and the unused-disable, then hand-edit the unused vitest helper imports the auto-fixer is too conservative to drop.

## Phase 1 — Design & Contracts

- [data-model.md](data-model.md) — concrete entity field-list keyed to the four Key Entities the spec names.
- [contracts/lint-and-config-contracts.md](contracts/lint-and-config-contracts.md) — testable contract assertions, one per FR, each with the exact verification command.
- [quickstart.md](quickstart.md) — five-step reviewer verification recipe (run lint, run tests, regenerate coverage, re-run lint, confirm no regressions). Designed to fit on one screen.
- [`CLAUDE.md`](../../CLAUDE.md) — agent context updated to point at this plan (between SPECKIT markers).

### Re-evaluation of Constitution Check after Phase 1

All Phase 1 artifacts confirm: zero `src/` edits planned, zero test-runtime edits planned, zero coverage-threshold edits planned, and all three fix categories land together. **Constitution Check still PASSES**. No new complexity to track.

## Phase 2 — Hand-off to `/speckit-tasks`

`/speckit-tasks` will produce `tasks.md` from the artifacts above. The expected task graph is small and almost entirely sequential within a single PR:

1. Add `'coverage/**'` to `eslint.config.js` `ignores`. (FR-002, FR-003)
2. Extend `tsconfig.json` `include` with `"*.config.ts"`. (FR-005, FR-006)
3. Run `npx eslint --fix` and accept the auto-fixed import order + unused-disable removal in `tests/inherited/index.test.ts`. (FR-008, FR-009)
4. Hand-edit `tests/inherited/index.test.ts` to drop the unused `beforeAll` import. (FR-007)
5. Hand-edit `tests/inherited/services/smart-connections.test.ts` to drop the unused `beforeEach` import. (FR-007)
6. Add a one-line note to `TESTING.md` explaining the coverage-tree lint exclusion. (FR-004)
7. Patch the spec's "82.45%" → "82.4%" typo in FR-012 and SC-002. (R-3)
8. Verification: `npm run lint` exits zero, zero errors, zero warnings; `npm test` passes; coverage gate still at 82.4%. (FR-001, FR-011, FR-012)
