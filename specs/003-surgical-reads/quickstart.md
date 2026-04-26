# Quickstart: developer how-to for Surgical Reads (`get_heading_contents`, `get_frontmatter_field`)

**Branch**: `003-surgical-reads` | **Date**: 2026-04-26

This is the developer-facing entry point. It tells you what to write,
how to run the tests, and how to smoke-test the new tools against a
real Obsidian instance.

This feature **adds no new dependencies**. The test runner (`vitest`),
HTTP mock (`nock`), and zod↔JSON-Schema bridge (`zod-to-json-schema`)
were all installed by feature 001. Skip straight to step 1.

---

## 1. Add the upstream service-layer methods

Add two methods to
[src/services/obsidian-rest.ts](../../src/services/obsidian-rest.ts),
following the patterns already established in that file.

```ts
/**
 * Get the body content under a heading path within a note.
 * @param filepath - Path relative to vault root
 * @param headingPath - H1::H2[::H3...] form, validated upstream by the wrapper
 */
async getHeadingContents(filepath: string, headingPath: string): Promise<string> {
  return this.safeCall(async () => {
    const segments = headingPath.split('::').map(encodeURIComponent).join('/');
    const response = await this.client.get<string>(
      `/vault/${encodeURIComponent(filepath)}/heading/${segments}`,
      {
        headers: { Accept: 'text/markdown' },
        responseType: 'text',
      }
    );
    return response.data;
  });
}

/**
 * Get a single frontmatter field's value from a note.
 * @param filepath - Path relative to vault root
 * @param field - The frontmatter field name
 * @returns The decoded JSON value (string, number, boolean, array, object, or null)
 */
async getFrontmatterField(filepath: string, field: string): Promise<unknown> {
  return this.safeCall(async () => {
    const response = await this.client.get<unknown>(
      `/vault/${encodeURIComponent(filepath)}/frontmatter/${encodeURIComponent(field)}`
    );
    return response.data;
  });
}
```

Notes:

- `safeCall` is the existing helper that converts axios errors into
  `Error("Obsidian API Error <code>: <message>")` (see
  [src/services/obsidian-rest.ts:35](../../src/services/obsidian-rest.ts#L35)).
  No new error handling here.
- For `getFrontmatterField`, axios automatically `JSON.parse`s the
  response body unless `responseType: 'text'` is set. Returning
  `unknown` is intentional — the handler does not narrow further;
  it just wraps and stringifies.
- For `getHeadingContents`, splitting `headingPath` on `::` then
  encoding each segment is correct because the structural validator
  (which runs in the handler before this call) has already guaranteed
  ≥ 2 non-empty segments.

---

## 2. Implement the tools

Create the following files (paths and responsibilities are
authoritative; internal structure is at the implementer's discretion):

```text
src/tools/surgical-reads/
├── schema.ts                # zod schemas + asserters for both tools (imports isValidHeadingPath)
├── tool.ts                  # exports SURGICAL_READ_TOOLS: Tool[] (two entries)
├── handler-heading.ts       # exports handleGetHeadingContents(args, restService): Promise<CallToolResult>
└── handler-frontmatter.ts   # exports handleGetFrontmatterField(args, restService): Promise<CallToolResult>
```

### `schema.ts`

```ts
import { z } from 'zod';

// Single source of truth for the heading-path predicate (FR-003 / ADR-001).
import { isValidHeadingPath } from '../patch-content/schema.js';

const HEADING_RULE = 'heading targets must use the full H1::H2[::H3...] path';

export const GetHeadingContentsRequestSchema = z.object({
  filepath: z.string().min(1, 'filepath must be a non-empty string').describe(
    'Path to the file (relative to vault root).'
  ),
  heading: z.string().min(1, 'heading must be a non-empty string').describe(
    "Full heading path: at least two non-empty segments separated by '::' (i.e., the H1::H2[::H3...] form). Top-level headings and headings whose literal text contains '::' are unreachable through this tool — fall back to get_file_contents for those cases."
  ),
  vaultId: z.string().optional().describe(
    'Optional vault ID (defaults to configured default vault).'
  ),
});

export type GetHeadingContentsRequest = z.infer<typeof GetHeadingContentsRequestSchema>;

export function assertValidGetHeadingContentsRequest(args: unknown): GetHeadingContentsRequest {
  const req = GetHeadingContentsRequestSchema.parse(args);
  if (!isValidHeadingPath(req.heading)) {
    throw new Error(
      `${HEADING_RULE} — received: "${req.heading}" — e.g., "<Parent Heading>::${
        req.heading.length === 0 || req.heading.trim().length === 0
          ? '<Sub Heading>'
          : req.heading.replace(/::/g, ' ')
      }"`
    );
  }
  return req;
}

export const GetFrontmatterFieldRequestSchema = z.object({
  filepath: z.string().min(1, 'filepath must be a non-empty string').describe(
    'Path to the file (relative to vault root).'
  ),
  field: z
    .string()
    .min(1, 'field must be a non-empty string')
    .refine((s) => s.trim().length > 0, { message: 'field must not be whitespace-only' })
    .describe(
      'The name of the single frontmatter field to read. Must be non-empty after trimming whitespace.'
    ),
  vaultId: z.string().optional().describe(
    'Optional vault ID (defaults to configured default vault).'
  ),
});

export type GetFrontmatterFieldRequest = z.infer<typeof GetFrontmatterFieldRequestSchema>;

export function assertValidGetFrontmatterFieldRequest(args: unknown): GetFrontmatterFieldRequest {
  return GetFrontmatterFieldRequestSchema.parse(args);
}
```

### `tool.ts`

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  GetFrontmatterFieldRequestSchema,
  GetHeadingContentsRequestSchema,
} from './schema.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const headingInputSchema = zodToJsonSchema(GetHeadingContentsRequestSchema, {
  $refStrategy: 'none',
}) as Tool['inputSchema'];

const frontmatterInputSchema = zodToJsonSchema(GetFrontmatterFieldRequestSchema, {
  $refStrategy: 'none',
}) as Tool['inputSchema'];

export const SURGICAL_READ_TOOLS: Tool[] = [
  {
    name: 'get_heading_contents',
    description:
      'Returns the raw markdown body content under the targeted heading. ' +
      'Frontmatter, tags, and file metadata are not included — use get_file_contents ' +
      'for the whole note or get_frontmatter_field for individual frontmatter values. ' +
      'Heading targets MUST use the full path of the heading: at least two non-empty ' +
      'segments separated by "::" (i.e., the H1::H2[::H3...] form). ' +
      'Top-level headings (no parent) are unreachable through this tool — ' +
      'use get_file_contents and slice the note client-side. ' +
      'Headings whose literal text contains "::" are also unreachable through this tool ' +
      '(the validator treats every "::" as a path separator and there is no escape syntax) — ' +
      'use get_file_contents in that case as well.',
    inputSchema: headingInputSchema,
  },
  {
    name: 'get_frontmatter_field',
    description:
      "Returns the named frontmatter field's value with its original type preserved — " +
      'string, number, boolean, array, object, or null. ' +
      'If the field or the note does not exist, the upstream\'s 4xx error is propagated unchanged. ' +
      'To read all frontmatter fields at once, use get_file_contents.',
    inputSchema: frontmatterInputSchema,
  },
];
```

### `handler-heading.ts`

```ts
import { assertValidGetHeadingContentsRequest } from './schema.js';

import type { ObsidianRestService } from '../../services/obsidian-rest.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export async function handleGetHeadingContents(
  args: Record<string, unknown>,
  rest: ObsidianRestService
): Promise<CallToolResult> {
  const req = assertValidGetHeadingContentsRequest(args);
  const body = await rest.getHeadingContents(req.filepath, req.heading);
  return { content: [{ type: 'text', text: body }] };
}
```

### `handler-frontmatter.ts`

```ts
import { assertValidGetFrontmatterFieldRequest } from './schema.js';

import type { ObsidianRestService } from '../../services/obsidian-rest.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export async function handleGetFrontmatterField(
  args: Record<string, unknown>,
  rest: ObsidianRestService
): Promise<CallToolResult> {
  const req = assertValidGetFrontmatterFieldRequest(args);
  const value = await rest.getFrontmatterField(req.filepath, req.field);
  return { content: [{ type: 'text', text: JSON.stringify({ value }) }] };
}
```

---

## 3. Wire the tools into the registry and dispatcher

### `src/tools/index.ts`

Add:

```ts
import { SURGICAL_READ_TOOLS } from './surgical-reads/tool.js';

export const ALL_TOOLS: Tool[] = [
  ...VAULT_TOOLS,
  ...FILE_TOOLS,
  ...WRITE_TOOLS,
  ...SEARCH_TOOLS,
  ...PERIODIC_TOOLS,
  ...OBSIDIAN_TOOLS,
  ...GRAPH_TOOLS,
  ...SEMANTIC_TOOLS,
  ...SURGICAL_READ_TOOLS,
];

export {
  // ... existing exports ...
  SURGICAL_READ_TOOLS,
};
```

### `src/index.ts`

Add two new switch cases inside `handleToolCall`:

```ts
case 'get_heading_contents':
  return handleGetHeadingContents(args, rest);

case 'get_frontmatter_field':
  return handleGetFrontmatterField(args, rest);
```

Add the imports near the existing `handlePatchContent` import:

```ts
import { handleGetHeadingContents } from './tools/surgical-reads/handler-heading.js';
import { handleGetFrontmatterField } from './tools/surgical-reads/handler-frontmatter.js';
```

No changes to the surrounding `try`/`catch` or to `safeCall` — the
handlers throw on validation failure and on upstream failure, both of
which are caught by the existing top-level `catch` in
[src/index.ts:251-258](../../src/index.ts#L251-L258).

---

## 4. Write the tests

Create:

```text
tests/tools/surgical-reads/
├── schema.test.ts                  # validator unit tests (no HTTP)
├── heading-handler.test.ts         # get_heading_contents handler tests (nock-mocked HTTP)
├── frontmatter-handler.test.ts     # get_frontmatter_field handler tests (nock-mocked HTTP)
└── registration.test.ts            # tools/list registration assertions for both tools
```

The full test matrices are in
[contracts/get_heading_contents.md §7](./contracts/get_heading_contents.md#7-test-matrix-contract-level)
(rows H1–H10 + HR — 13 rows) and
[contracts/get_frontmatter_field.md §7](./contracts/get_frontmatter_field.md#7-test-matrix-contract-level)
(rows F1–F12 + FR — 13 rows).

The test harness pattern is identical to
[tests/tools/patch-content/handler.test.ts](../../tests/tools/patch-content/handler.test.ts).
Build an `ObsidianRestService` against a fake host, prime nock in
`beforeEach`, clean in `afterEach`. Three patterns specific to this
feature:

**Asserting the URL path** (verifies R8 URL-encoding):

```ts
import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ObsidianRestService } from '../../../src/services/obsidian-rest.js';
import { handleGetHeadingContents } from '../../../src/tools/surgical-reads/handler-heading.js';
import type { VaultConfig } from '../../../src/types.js';

const VAULT: VaultConfig = {
  id: 'test', apiKey: 'k', host: 'localhost', port: 27123,
  protocol: 'https', verifySsl: false,
};
const BASE = `${VAULT.protocol}://${VAULT.host}:${VAULT.port}`;

describe('get_heading_contents handler', () => {
  let rest: ObsidianRestService;
  beforeEach(() => { rest = new ObsidianRestService(VAULT); });
  afterEach(() => { nock.cleanAll(); nock.enableNetConnect(); });

  it('H1c: URL-encodes each heading segment after splitting on "::"', async () => {
    const scope = nock(BASE)
      .get('/vault/note.md/heading/Project/Q3%20%2F%20Plan')
      .matchHeader('Accept', /text\/markdown/)
      .reply(200, '- planned item');

    const result = await handleGetHeadingContents(
      { filepath: 'note.md', heading: 'Project::Q3 / Plan' },
      rest
    );

    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]).toMatchObject({ type: 'text', text: '- planned item' });
    expect(scope.isDone()).toBe(true);
  });
});
```

**Asserting typed-value envelope** (verifies F2–F6 / Q2 clarification):

```ts
import { handleGetFrontmatterField } from '../../../src/tools/surgical-reads/handler-frontmatter.js';

it('F2: number value preserves its type', async () => {
  nock(BASE).get('/vault/note.md/frontmatter/count').reply(200, 5);
  const result = await handleGetFrontmatterField(
    { filepath: 'note.md', field: 'count' },
    rest
  );
  expect(result.content?.[0]).toMatchObject({
    type: 'text',
    text: '{"value":5}',           // not '{"value":"5"}'
  });
});

it('F6: null value is present-and-typed (distinct from missing)', async () => {
  nock(BASE).get('/vault/note.md/frontmatter/archived').reply(200, null);
  const result = await handleGetFrontmatterField(
    { filepath: 'note.md', field: 'archived' },
    rest
  );
  expect(result.isError).toBeFalsy();
  expect(result.content?.[0]).toMatchObject({
    type: 'text',
    text: '{"value":null}',
  });
});
```

**Asserting handler-level no-network on validation failure**
(verifies SC-001 at the integration boundary):

```ts
it('H2b: bare-target rejection — no HTTP call', async () => {
  nock.disableNetConnect();
  await expect(
    handleGetHeadingContents(
      { filepath: 'note.md', heading: 'Action Items' },
      rest
    )
  ).rejects.toThrow(/full H1::H2.*path/);
});
```

---

## 5. Run the tests

```bash
npm test
```

Expected: all 13 + 13 contract tests pass, in addition to the existing
`patch-content` tests (which must remain green — no regression).

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
# In another shell, with the Inspector or Claude Code as MCP client:

# get_heading_contents — happy path
#   filepath: "ScratchNote.md"
#   heading:  "Test::Read Sandbox"   # ensure this path exists in the note

# get_heading_contents — bare-target rejection (should fail at the wrapper)
#   filepath: "ScratchNote.md"
#   heading:  "Read Sandbox"         # no "::" — must be rejected before HTTP

# get_frontmatter_field — happy path
#   filepath: "ScratchNote.md"
#   field:    "status"               # ensure this field exists in the note

# get_frontmatter_field — missing field (should propagate upstream 4xx)
#   filepath: "ScratchNote.md"
#   field:    "definitely_not_a_real_field"
```

Verify:

- `get_heading_contents` returns just the body under the targeted
  heading (no frontmatter, no tags, no metadata).
- The bare-target call returns a validation error containing the
  rule, the offending value, and an example — **without** ever
  reaching the Obsidian instance (check the Local REST API plugin's
  request log; it should show no GET to that path).
- `get_frontmatter_field` returns `{"value":<typed-value>}` for the
  happy path. If the field's value is a number/boolean/list, the
  response preserves its type.
- The missing-field call returns an `isError: true` response with the
  upstream's status code and message preserved (not `{"value":null}`).

---

## 8. What to commit

- `src/services/obsidian-rest.ts` — modified (two new methods)
- `src/tools/surgical-reads/{schema,tool,handler-heading,handler-frontmatter}.ts` — new
- `src/tools/index.ts` — modified (aggregate `SURGICAL_READ_TOOLS`)
- `src/index.ts` — modified (two new switch cases + imports)
- `tests/tools/surgical-reads/{schema,heading-handler,frontmatter-handler,registration}.test.ts` — new
- No `package.json` or `package-lock.json` changes (no new deps)

---

## 9. Definition of done

All of the following must hold:

- [ ] `npm test` exits 0 with all 26 new contract tests passing
      (H1, H1b, H1c, H2, H2b, H3–H10, HR, F1–F12, FR), plus the
      existing `patch-content` tests still passing
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0
- [ ] `tools/list` over MCP includes `get_heading_contents` and
      `get_frontmatter_field` with the documented description
      substrings
- [ ] Smoke test in §7 passes against a real Obsidian
- [ ] PR description references this plan and the constitution
      Principles I–IV (per Governance section of the constitution)
