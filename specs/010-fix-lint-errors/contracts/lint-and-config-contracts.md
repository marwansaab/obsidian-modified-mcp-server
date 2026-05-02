# Contracts: Fix Lint Errors (010)

The "interfaces" exposed by this feature are not language APIs but
configuration-and-tool contracts that a reviewer (human or CI) can
verify with shell commands. Each contract below states an FR, the
exact verification command, and the post-condition that must hold.

All commands assume the repository root as the working directory and
the feature branch (`010-fix-lint-errors`) as HEAD.

## C-001 — Clean lint signal

**Covers**: FR-001, SC-001.

**Verify**:

```bash
npm run lint
echo $?   # PowerShell: $LASTEXITCODE
```

**Post-condition**:

- Exit code is `0`.
- Stdout contains zero lines matching `error` or `warning` from any
  of the project's source, test, or configuration files.

## C-002 — Coverage-tree exclusion is configuration-level, not inline

**Covers**: FR-002, FR-003, SC-003.

**Verify** (run after a fresh `npm test` so the coverage tree is
populated):

```bash
npm test
npm run lint
```

**Post-condition**:

- The lint command's output contains no line matching `coverage/` (no
  matter how many files exist under that path).
- `eslint.config.js` contains `'coverage/**'` in the top-level
  `ignores` array; no `// eslint-disable` directive exists inside any
  file under `coverage/` (auto-true: those are generated files we do
  not edit).

**Verify (config-shape only — fast)**:

```bash
grep -F "coverage/**" eslint.config.js
```

Returns at least one match.

## C-003 — Top-level `*.config.ts` is resolved by the project service

**Covers**: FR-005, FR-006, SC-004.

**Verify**:

```bash
npm run lint 2>&1 | grep -F "was not found by the project service" || echo OK
```

**Post-condition**:

- The grep finds zero matches (the `|| echo OK` branch fires).
- `tsconfig.json`'s `include` array contains `"*.config.ts"`.

**Scalability check (manual)**: a reviewer who creates a placeholder
`playwright.config.ts` at the repo root (`{}` literal contents are
enough) and re-runs `npm run lint` MUST observe zero
project-service errors against the new file. They MUST then delete
the placeholder before pushing — this is verification only, not part
of the merge.

## C-004 — Test-file imports are tidy and ordered

**Covers**: FR-007, FR-008, FR-009, SC-001 (lint clean).

**Verify**:

```bash
npm run lint -- tests/inherited/index.test.ts \
                tests/inherited/services/smart-connections.test.ts
```

**Post-condition**:

- Exit code `0`.
- Output contains no `@typescript-eslint/no-unused-vars` line for
  either file.
- Output contains no `import/order` line for `tests/inherited/index.test.ts`.
- Output contains no `Unused eslint-disable directive` line for either
  file.
- `tests/inherited/index.test.ts` does not contain the literal string
  `beforeAll` anywhere (since the directive was its only use).
- `tests/inherited/services/smart-connections.test.ts` does not contain
  the literal string `beforeEach` anywhere.

## C-005 — Production source untouched

**Covers**: FR-010, SC-005.

**Verify**:

```bash
git diff main..HEAD -- src/
```

**Post-condition**: empty output. (The PR for this feature must not
modify any file under `src/`.)

## C-006 — Test runtime behaviour unchanged

**Covers**: FR-011, SC-002.

**Verify**:

```bash
npm test
```

**Post-condition**:

- Exit code `0`.
- The same set of test files exists on this branch as on `main`
  (verifiable with `git diff main..HEAD --stat -- tests/`), with
  no additions, deletions, renames, or `.skip` calls introduced.
- The reported aggregate statement coverage is `>= 82.4%` (the
  threshold from `vitest.config.ts`).

## C-007 — Coverage gate untouched

**Covers**: FR-012, SC-002.

**Verify**:

```bash
git diff main..HEAD -- vitest.config.ts
```

**Post-condition**: either empty output (no edit needed) or a
near-empty diff that does NOT change the value of
`thresholds.statements`. The constant `82.4` (or whichever value is on
`main`) MUST appear unchanged on the post-feature side of the diff.

## C-008 — Single-PR landing

**Covers**: FR-013, SC-006.

**Verify**: by inspection of the merge commit on `main`. The merge
commit MUST contain edits to `eslint.config.js`, `tsconfig.json`,
`tests/inherited/index.test.ts`, `tests/inherited/services/smart-connections.test.ts`,
and `TESTING.md` together — not split across multiple merges.

**Post-condition**: a reviewer running `npm run lint` against the
merge commit (HEAD of `main` immediately after merge) sees exit code
`0`. There is no intermediate state on `main` where two of the three
fix categories landed without the third.

## C-009 — Documentation note present

**Covers**: FR-004.

**Verify**:

```bash
grep -F "coverage" TESTING.md | grep -E -i "lint|eslint" | head -5
```

**Post-condition**: at least one matching line. The matching line MUST
explicitly say the coverage tree is excluded from lint and MUST be
located in or near the "Running the tests" section so a reader
encounters it while reading about coverage tooling.
