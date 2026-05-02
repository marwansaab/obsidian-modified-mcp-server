# Data Model: Fix Lint Errors (010)

This is a developer-tooling feature; "data" here refers to the
configuration entities the spec calls out and the surface each one
exposes that this feature touches. There is no application data model.

## Entities

### Lint configuration

- **File**: `eslint.config.js` (flat config; ESLint 9.x).
- **Owns**: the global `ignores` array; the per-file rule blocks; the
  `parserOptions.projectService` flag.
- **Fields touched by this feature**:
  - `ignores` (array of glob strings) — current value
    `['dist/**/*', 'tsup.config.ts', 'eslint.config.js']`. **Add**
    `'coverage/**'`. No other entries change.
- **Fields read but not modified**:
  - `parserOptions.projectService: true` — already set at line 21.
- **Validation rule**: post-edit, the `ignores` array MUST contain
  literal strings only (no inline comments interpolated into the array)
  and MUST remain a valid JavaScript array. Verified by `npm run lint`
  not erroring on the config file's own parse.

### Language project configuration

- **File**: `tsconfig.json` at repo root.
- **Owns**: `compilerOptions`, `include`, `exclude`.
- **Fields touched by this feature**:
  - `include` (array of strings) — current value
    `["src", "tests", "scripts"]`. **Append** `"*.config.ts"`. No other
    entries change.
- **Fields read but not modified**:
  - `compilerOptions.strict: true`, `compilerOptions.target`,
    `compilerOptions.module` — left untouched.
- **Validation rule**: post-edit, `npm run typecheck` MUST still pass.
  `vitest.config.ts` and `tsup.config.ts` are valid TypeScript using
  the public types from `vitest/config` and `tsup` respectively;
  including them in the typecheck graph does not introduce new
  type errors.

### Generated coverage tree

- **Path**: `coverage/` at repo root, written by `@vitest/coverage-v8`.
- **Lifecycle**: regenerated on every `npm test` run (provider `v8`,
  reporters `text`, `lcov`, `json-summary`, per
  [`vitest.config.ts`](../../vitest.config.ts)).
- **Contents** (as observed today):
  - `coverage/lcov.info`
  - `coverage/coverage-summary.json`
  - `coverage/coverage-final.json`
  - `coverage/lcov-report/` (HTML report — owns the third-party JS
    files that produced today's parser errors:
    `block-navigation.js`, `prettify.js`, `sorter.js`, plus
    `index.html`, `prettify.css`, `sort-arrow-sprite.png`, etc.).
- **Fields touched by this feature**: none (the feature does not write
  into this tree). The feature *changes the linter's relationship to
  this tree* by adding `'coverage/**'` to the lint ignore list.
- **Validation rule**: post-edit, `npm run lint` MUST report zero
  diagnostics referencing any path under `coverage/`, regardless of
  what `npm test` writes there.

### Affected test files

#### File 1 — `tests/inherited/index.test.ts`

- **Role**: AS-IS characterization test for upstream-inherited code in
  `src/index.ts`. Imports vitest helpers, `nock` for HTTP mocking, and
  Node built-ins `node:fs`, `node:os`, `node:path`.
- **Imports as found today** (lines 33–47):
  ```ts
  import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';

  import nock from 'nock';
  import {
    describe,
    it,
    expect,
    beforeAll,         // ← unused (FR-007 requires removal)
    afterAll,
    beforeEach,
    afterEach,
    vi,
  } from 'vitest';
  ```
- **Imports after this feature's edits**:
  ```ts
  import nock from 'nock';
  import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import {
    describe,
    it,
    expect,
    afterAll,
    beforeEach,
    afterEach,
    vi,
  } from 'vitest';
  ```
  Notes:
  - `nock` precedes `node:fs` (the `import/order` rule treats `nock` as
    `external` and `node:fs` as `builtin`; the rule's configured
    `groups` flatten `[builtin, external]` into one group with
    alphabetical-asc within it — so `nock` < `node:fs` puts `nock`
    first).
  - The empty line between `node:path` and `nock` is removed because the
    rule says `'newlines-between': 'always'` *between* groups, and these
    are now in the same flattened group.
  - `beforeAll` is removed; the other names on the vitest line stay.
- **Disable directive at line 101**: `// eslint-disable-next-line @typescript-eslint/no-explicit-any` — **deleted** (FR-009 / R-4).
- **Validation rule**: every name in the post-edit imports MUST be
  referenced in the file body; auto-checked by
  `@typescript-eslint/no-unused-vars`.

#### File 2 — `tests/inherited/services/smart-connections.test.ts`

- **Role**: AS-IS characterization test for `src/services/smart-connections.ts`.
- **Imports as found today** (lines 14–20):
  ```ts
  import { AxiosError } from 'axios';
  import nock from 'nock';
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';

  import { SmartConnectionsService } from '../../../src/services/smart-connections.js';

  import type { VaultConfig } from '../../../src/types.js';
  ```
- **Imports after this feature's edits**:
  ```ts
  import { AxiosError } from 'axios';
  import nock from 'nock';
  import { describe, it, expect, afterEach } from 'vitest';

  import { SmartConnectionsService } from '../../../src/services/smart-connections.js';

  import type { VaultConfig } from '../../../src/types.js';
  ```
  - Only `beforeEach` is dropped from the vitest line; the other names
    on the line stay.
- **Validation rule**: same as File 1.

## State transitions

This feature has no state machine. The only ordering constraint is
operational, captured in [research.md](research.md) R-5: run
`npx eslint --fix` *before* the manual trims so the auto-formatter does
not race with hand edits.

## Documentation entity

- **File**: [TESTING.md](../../TESTING.md).
- **Section to amend**: the "Running the tests" section (lines 11–34),
  immediately after the bullet that lists what `coverage/` contains.
- **Edit**: append a sentence (≤ 40 words) noting that the `coverage/`
  tree is excluded from `npm run lint` at the ESLint flat-config level
  because its contents are generated artifacts (FR-004).
- **Validation rule**: a reviewer reading TESTING.md from the top
  encounters this note before they encounter the lint discussion
  elsewhere.

## Cross-cutting invariants

- **No `src/` file is in this data model.** Anything under `src/` is
  immutable for this feature (FR-010).
- **No vitest threshold field is in this data model.** The
  `thresholds: { statements: 82.4 }` field in `vitest.config.ts` is
  read-only for this feature (FR-012).
- **No new file is created in this data model.** Every entity above is
  an existing file; the feature edits exist files only.
