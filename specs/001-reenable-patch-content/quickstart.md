# Quickstart: developer how-to for `patch_content`

**Branch**: `001-reenable-patch-content` | **Date**: 2026-04-26

This is the developer-facing entry point. It tells you what to install,
what to write, how to run the tests, and how to smoke-test the new tool
against a real Obsidian instance.

---

## 1. Install new dependencies

This feature adds three packages. Install with `npm`:

```bash
npm install --save-exact zod-to-json-schema
npm install --save-dev --save-exact vitest nock
```

Why each:

| Package | Why | Production / dev |
|---|---|---|
| `zod-to-json-schema` | Generate the MCP `inputSchema` from the zod schema; satisfies Constitution FR-010 (single source of truth). | production |
| `vitest` | Test runner; native ESM/TS support, jest-compatible API. | dev |
| `nock` | HTTP mock; intercepts axios at the Node `http` layer so tests do not need a real Obsidian instance. | dev |

`zod` is already in `dependencies` (currently unused in `src/`); this
feature is the first to actually require it at runtime.

---

## 2. Add an `npm test` script

Edit `package.json` and add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Verify:

```bash
npm test          # should report "no test files found" until step 4
```

---

## 3. Implement the tool

Create the following files (file paths and responsibilities are
authoritative; internal structure is at the implementer's discretion):

```text
src/tools/patch-content/
├── schema.ts    # zod schema + isValidHeadingPath predicate
├── tool.ts      # exports PATCH_CONTENT_TOOLS: Tool[] (inputSchema via zod-to-json-schema)
└── handler.ts   # exports handlePatchContent(args, restService): Promise<CallToolResult>
```

Then:

- In `src/tools/write-tools.ts`: replace the `// DISABLED: patch_content...`
  block with a re-export so `WRITE_TOOLS` includes the new tool. The
  cleanest pattern is to spread:

  ```ts
  import { PATCH_CONTENT_TOOLS } from './patch-content/tool.js';

  export const WRITE_TOOLS: Tool[] = [
    /* existing append_content, put_content */,
    ...PATCH_CONTENT_TOOLS,
  ];
  ```

- In `src/index.ts`: replace the commented `case 'patch_content':` block
  with:

  ```ts
  case 'patch_content':
    return handlePatchContent(args, rest);
  ```

  No changes to the surrounding `try`/`catch` or to `safeCall` — the
  handler throws on validation failure and on upstream failure, both
  of which are caught by the existing top-level `catch` in
  `src/index.ts:250-257`.

The validator details and the contract for the `Tool` entry are in
[contracts/patch_content.md](./contracts/patch_content.md). The data
shapes (validation rule, error message format) are in
[data-model.md](./data-model.md).

---

## 4. Write the tests

Create:

```text
tests/tools/patch-content/
├── schema.test.ts    # validator unit tests (no HTTP)
└── handler.test.ts   # handler integration tests (nock-mocked HTTP)
```

The full test matrix is in [contracts/patch_content.md §7](./contracts/patch_content.md#7-test-matrix-contract-level)
(C1–C12). Two patterns to follow:

**Schema tests** (`schema.test.ts`): import `isValidHeadingPath` and the
zod schema directly. Assert pass/fail for each row in the heading-path
table in [data-model.md](./data-model.md). For rejection tests, also
assert the error message contains the three required substrings (rule
name, `received: "..."`, `e.g., "..."`).

**Handler tests** (`handler.test.ts`): set up `nock` in `beforeEach`,
clean in `afterEach`. Construct an `ObsidianRestService` pointing at the
mocked host. For each row in the contract test matrix:

```ts
import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObsidianRestService } from '../../../src/services/obsidian-rest.js';
import { handlePatchContent } from '../../../src/tools/patch-content/handler.js';

describe('patch_content handler', () => {
  let rest: ObsidianRestService;
  let scope: nock.Scope;

  beforeEach(() => {
    rest = new ObsidianRestService({
      id: 'test',
      host: 'localhost',
      port: 27123,
      protocol: 'https',
      apiKey: 'test',
      verifySsl: false,
    } as any);
    scope = nock('https://localhost:27123');
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('C1: valid 2-segment path, 2xx → success', async () => {
    scope.patch('/vault/note.md').reply(200, '');
    const result = await handlePatchContent(
      {
        filepath: 'note.md',
        operation: 'append',
        targetType: 'heading',
        target: 'Weekly Review::Action Items',
        content: '- new item',
      },
      rest
    );
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it('C2: bare heading target → validation error, no HTTP call', async () => {
    await expect(
      handlePatchContent(
        {
          filepath: 'note.md',
          operation: 'append',
          targetType: 'heading',
          target: 'Action Items',
          content: '- new item',
        },
        rest
      )
    ).rejects.toThrow(/full H1::H2.*path/);
    expect(scope.pendingMocks()).toEqual([]); // no mocks were primed; verifies nothing tried to call
  });

  // ... C3 through C12 follow the same pattern
});
```

---

## 5. Run the tests

```bash
npm test
```

Expected: all 12 contract tests pass. If `tools/list` is asserted via
the `ListToolsRequestSchema` handler (C12), you may need to construct
the server in-test or move the registration assertion to a unit test
that imports `ALL_TOOLS` and asserts membership directly. The latter is
simpler and equally testable.

---

## 6. Verify lint and types

```bash
npm run lint
npm run typecheck
```

Both must pass with zero output.

---

## 7. Smoke-test against a real Obsidian (optional)

Recommended before merging. Requires a running Obsidian with the Local
REST API plugin enabled and an `OBSIDIAN_API_KEY` set in your
environment.

```bash
npm run build
# In another shell, with the Inspector or Claude Code as MCP client,
# call patch_content with:
#   filepath: "ScratchNote.md"
#   operation: "append"
#   targetType: "heading"
#   target: "Test::Patch Sandbox"   # ensure this path exists in the note
#   content: "- smoke test entry"
```

Verify:

- The new bullet appears under the correct heading.
- A bare-target call (`target: "Patch Sandbox"`) returns a validation
  error containing the rule, the offending value, and an example —
  **without** ever reaching the Obsidian instance (check the
  Local REST API plugin's request log; it should show no PATCH).

---

## 8. What to commit

- `src/tools/patch-content/{schema,tool,handler}.ts` — new
- `src/tools/write-tools.ts` — modified (re-exports new tools)
- `src/index.ts` — modified (replaces commented case with live handler)
- `tests/tools/patch-content/{schema,handler}.test.ts` — new
- `package.json` — modified (new deps + `test` script)
- `package-lock.json` — modified (lockfile updates) — but note: project
  `.gitignore` excludes `package-lock.json`, so this should not be
  committed unless the policy is changed in the same PR
- `vitest.config.ts` — only if you need a custom config; the default
  works for this layout

---

## 9. Definition of done

All of the following must hold:

- [ ] `npm test` exits 0 with all 12 contract tests passing
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0
- [ ] `tools/list` over MCP includes `patch_content` with the three
      required description substrings
- [ ] Smoke test in §7 passes against a real Obsidian
- [ ] PR description references this plan and the constitution
      Principles I–IV (per Governance section of the constitution)
