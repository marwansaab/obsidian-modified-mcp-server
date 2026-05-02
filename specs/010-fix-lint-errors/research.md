# Research: Fix Lint Errors (010)

This document records the decisions taken during Phase 0 of the plan.
Each decision states what was chosen, why, and what was considered and
rejected. References point at concrete repo state observed on
2026-05-02 against branch `010-fix-lint-errors` at HEAD.

## R-1 — Resolution to make top-level `*.config.ts` files visible to typescript-eslint

**Decision**: Add the glob `"*.config.ts"` to `tsconfig.json`'s `include`
array. (Option (a) in the spec input.)

**Rationale**:

- `tsconfig.json`'s `include` already uses the same idiom for whole
  directories (`"src"`, `"tests"`, `"scripts"`); a `*.config.ts` glob is
  the natural shape for "every top-level `*.config.ts` file at the repo
  root, present and future". This satisfies FR-006's "must scale without
  per-file plumbing" without any per-file additions today.
- The typescript-eslint project service then resolves these files under
  the same compiler options as the rest of the codebase. Typed-lint
  rules (which today are sparse but may grow) behave consistently
  whether they target a `src/` file or a top-level config file.
- The fix is mechanically tiny (one new include glob) and is
  self-documenting in `tsconfig.json` — a future contributor adding
  `playwright.config.ts` does not need to touch ESLint configuration.

**Alternatives considered**:

- **Option (b): `parserOptions.projectService.allowDefaultProject`.**
  typescript-eslint 8.50.1 does support `allowDefaultProject`. Rejected
  because: (i) files matched by `allowDefaultProject` are parsed under
  typescript-eslint's *default project* rather than the repo's own
  `tsconfig.json` — small but real divergence from the rest of the
  codebase; (ii) the feature carries an upstream warning ("intended for
  files genuinely outside the project graph"), which would obscure
  legitimate signal if ever raised; (iii) `allowDefaultProject` has
  historically had file-count limits enforced by typescript-eslint.
  Option (a) avoids all three.
- **Per-file include**: enumerate `vitest.config.ts` and `tsup.config.ts`
  explicitly. Rejected for failing FR-006 (would re-litigate per-file).
- **Multiple `tsconfig` files**: a separate `tsconfig.eslint.json` for
  config files. Rejected as over-engineering for a two-file problem.

**Fallback** (only if R-1 (a) regresses): switch to (b) by adding
`projectService: { allowDefaultProject: ['*.config.ts'] }` to the
language-options block of `eslint.config.js`. typescript-eslint 8.50.1
supports the glob form; if the repo upgrades to a major version that
removes `allowDefaultProject`, fall back to (b)'s explicit-list form.

**References**:

- typescript-eslint v8.0.0 release notes (introducing the
  `projectService` API).
- [`tsconfig.json`](../../tsconfig.json) line 16 (existing `include`).
- [`eslint.config.js`](../../eslint.config.js) lines 18–26 (`projectService: true` already on).

## R-2 — Coverage-tree ignore glob

**Decision**: Add `'coverage/**'` to the `ignores` array on line 13 of
[`eslint.config.js`](../../eslint.config.js).

**Rationale**: Matches the style of the existing `'dist/**/*'` entry
(directory + double-star + child match). FR-003 requires that newly
emitted files in the coverage tree are excluded automatically; the
glob form covers any file extension and any nesting depth. A bare
`'coverage'` would only match the directory entry itself, not its
children — confirmed by the ESLint flat-config docs and consistent with
the existing `dist` precedent in this same file.

**Alternatives considered**:

- **`coverage/**/*`** — equivalent in practice. Rejected for trivial
  inconsistency with the leaner `coverage/**` form, which the ESLint
  flat-config documentation gives as the recommended idiom for
  "everything under this directory".
- **Per-file inline `eslint-disable`**: explicitly forbidden by FR-002
  ("via project configuration, not via per-file inline directives").

**References**:

- [`eslint.config.js`](../../eslint.config.js) line 13.
- ESLint flat-config `ignores` docs.

## R-3 — Coverage-floor figure: 82.4%, not 82.45%

**Decision**: The canonical statement-coverage floor is **82.4%**, the
value present in:

- [`vitest.config.ts`](../../vitest.config.ts) line 15: `thresholds: { statements: 82.4 }`
- [TESTING.md](../../TESTING.md) line 41: "The current floor is **82.4%**"
- The 009 commit message: `feat(009): arm coverage gate at 82.4% statement floor`

The spec text in FR-012 and SC-002 quotes "82.45%" — this is a typo
copied from the user's input description.

**Resolution**:

- The implementation depends only on the floor value not changing, so
  the typo does not block the work.
- The spec must be patched (one-character edit, two locations) so
  future readers do not believe the contract is 82.45%. Captured as
  task in `/speckit-tasks` (Phase 2 task #7 in `plan.md`).

**Alternatives considered**:

- **Bump the floor to 82.45%** to match the spec text. Rejected: out of
  scope per FR-012 and the constitutional ban on bundling unrelated
  work with feature changes.
- **Leave the spec unpatched.** Rejected: a spec that contradicts the
  code it governs is itself a defect.

## R-4 — Disposition of the unused `eslint-disable` directive

**Decision**: Delete the directive at
[`tests/inherited/index.test.ts:101`](../../tests/inherited/index.test.ts#L101).

**Rationale**: The line immediately following the directive is:

```ts
(process as unknown as { exit: (code?: number) => void }).exit = (code) => {
```

This uses `unknown` and a structural cast, not `any`. The ESLint rule
`@typescript-eslint/no-explicit-any` is therefore not triggered on that
line, and the `// eslint-disable-next-line` directive is suppressing
nothing — exactly what the linter's "Unused eslint-disable directive"
warning is reporting. Deleting the directive is the first branch of
FR-009 ("either be removed (when the directive is genuinely
unnecessary)"). No relocation is required.

**Alternative considered**: Leaving the directive but with a
`@ts-expect-error`-style narrower scope. Rejected because there is no
underlying `any` to suppress; adding a directive would be cargo-cult.

## R-5 — Auto-fix sequencing

**Decision**: When implementing, run `npx eslint --fix` *before*
hand-editing the unused vitest helper imports.

**Rationale**: ESLint's `--fix` flag autocorrects:

- `import/order` (the empty-line-in-group at line 35 and the
  `nock`-before-`node:fs` ordering at line 37 in
  `tests/inherited/index.test.ts`).
- `eslint-comments`-style "Unused eslint-disable directive" warnings —
  removed automatically.

But `--fix` does **not** automatically drop unused imports flagged by
`@typescript-eslint/no-unused-vars` (the rule has no `--fix` autofix
for imports). Those have to be hand-edited:

- `beforeAll` from the vitest helper line at
  `tests/inherited/index.test.ts:42`.
- `beforeEach` from the same-line import at
  `tests/inherited/services/smart-connections.test.ts:16`.

If the unused vitest helper edits are made *first*, the auto-fixer's
`import/order` pass might decide to put the trimmed lines somewhere
unexpected. Doing the auto-fix first, then trimming, gives a
deterministic resulting layout that matches the rule.

**Verification step**: after the manual trims, re-run `npm run lint`
once more to confirm no further errors arose from the trim.

## Side notes (non-decisions, kept for the next /speckit-clarify or planner)

- **`tsup.config.ts` is currently ignored by ESLint** (line 13 of
  `eslint.config.js`). With `*.config.ts` added to `tsconfig.json`'s
  `include`, the typescript-eslint project service can now resolve it,
  but ESLint will still skip it because of the existing ignore. Lifting
  that ignore is intentionally out of scope (it might surface new
  lint findings; that's a separate spec). This is the same posture the
  spec takes on `eslint.config.js` itself, which is also ignored.

- **`@vitest/coverage-v8` 4.1.x is installed.** `vitest.config.ts`
  imports from `vitest/config`; the `*.config.ts` include glob covers
  any future config files added at root, including a hypothetical
  `playwright.config.ts` or `tsup.config.ts` rewrite. No special
  handling needed.

- **The recommended CI / pre-commit follow-up.** The constitution
  already mandates `npm run lint` clean for merge (Quality Gate 1), and
  the user's input description requested raising "wire lint into CI"
  as a backlog item rather than expanding scope. Recorded in
  spec.md → "Recommended Follow-Up". No CI/pre-commit work is part of
  this feature.
