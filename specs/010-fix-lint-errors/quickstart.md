# Quickstart: Verify the Fix Lint Errors PR (010)

A reviewer can verify this feature in five steps from a fresh clone of
the feature branch. The whole sequence runs in under a minute on a
modern dev machine.

## Prerequisites

- Node.js >= 18 (per `package.json` `engines`).
- The repository checked out at the tip of `010-fix-lint-errors`.
- `npm ci` (or `npm install`) already run.

## Steps

### 1. Reproduce the original failure on the parent commit

(Optional, only if the reviewer wants to see the regression first-hand.)

```bash
git stash push -- .   # if any uncommitted changes
git checkout main
npm run lint   # expect: "✖ 9 problems (8 errors, 1 warning)"
git checkout 010-fix-lint-errors
```

### 2. Run lint on the feature branch — should be clean

```bash
npm run lint
```

**Expected**: exit code `0`, zero errors, zero warnings. (Contract C-001.)

### 3. Run the test suite — should pass with the coverage gate intact

```bash
npm test
```

**Expected**:

- Exit code `0`.
- The `text` reporter prints an `All files` row with statement
  coverage `>= 82.4%`.
- The build does not print
  `Coverage for statements (X%) does not meet global threshold`.
- (Contracts C-006, C-007.)

### 4. Re-run lint after coverage was regenerated — still clean

The previous step regenerated `coverage/`. Linting again must still
be clean — proving the ignore is config-level, not a stale cache.

```bash
npm run lint
```

**Expected**: exit code `0`, zero errors, zero warnings, no path
under `coverage/` mentioned anywhere in the output. (Contract C-002.)

### 5. Confirm the production source was not touched

```bash
git diff main..HEAD -- src/
```

**Expected**: empty output. (Contract C-005.)

## Five-line summary the reviewer can paste into the PR review

```text
Lint clean (npm run lint → 0 errors / 0 warnings).
Tests pass (npm test → green, statement coverage ≥ 82.4%).
Re-lint after npm test still clean (coverage/ excluded at config level).
src/ diff vs main is empty (no production code changes).
TESTING.md note added explaining the coverage-tree lint exclusion.
```

## What this quickstart deliberately does NOT cover

- Wiring the lint command into CI or pre-commit. That is the
  Recommended Follow-Up in `spec.md`, not part of this feature's
  acceptance.
- The 82.45% → 82.4% spec patch. That is a one-character spec edit
  scheduled as Phase 2 task #7 in `plan.md`; it is independent of the
  contracts above, which all reference the real (82.4%) value.
- Any change to `tsup.config.ts`'s lint posture. `tsup.config.ts` was
  already in `eslint.config.js`'s `ignores` before this feature and
  stays there after. The `*.config.ts` include glob in `tsconfig.json`
  makes it visible to the typescript-eslint project service, which is
  harmless because ESLint still skips it.

## If something fails

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm run lint` still reports `was not found by the project service` for `vitest.config.ts` | The `*.config.ts` glob is missing from `tsconfig.json` `include`. | Re-apply the include edit. |
| `npm run lint` reports any path under `coverage/` | The `'coverage/**'` entry is missing from `eslint.config.js` `ignores`. | Re-apply the ignore edit. |
| `npm test` fails with `Coverage for statements (X%) does not meet global threshold (82.4%)` | A test was inadvertently dropped or skipped. | Run `git diff main..HEAD -- tests/` and verify only the two lines explicitly named in the spec changed. |
| `npm run lint` reports `'beforeAll'` or `'beforeEach'` is defined but never used | The hand-edit step was skipped. | Re-do the imports per `data-model.md`. |
| `npm run typecheck` newly fails on `vitest.config.ts` or `tsup.config.ts` | Adding `*.config.ts` to `tsconfig.json` `include` brought in a file with a real type error. | Investigate the specific TS error; fix in this PR (it is part of the same configuration change). |
