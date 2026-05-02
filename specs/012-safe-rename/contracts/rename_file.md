# Contract: `rename_file` MCP tool — Option B

**Feature**: 012-safe-rename | **Phase**: 1 (Design & Contracts) | **Date**: 2026-05-02 (Option B revision)
**Defines**: The single source of truth for the `rename_file` MCP tool's wire contract under Option B — what callers see in `tools/list`, what they may send, what they receive on success, what they receive on failure, and the full composition algorithm the handler executes.

This contract MUST be honoured exactly by the implementation. The zod schema below is the **single source of truth** (Constitution Principle III): the runtime parser and the published JSON `inputSchema` both derive from it via `zod-to-json-schema`. If the schema and this document ever disagree, fix this document — the schema wins.

**Status**: The schema (T003) and the tool registration (T004) are already shipped (commit `bebe709`); the description text in T004 is rewritten to the Option-B language in this Option-B pivot commit. The handler (T005) is deferred until Tier 2 backlog item 25 ships and `rest.findAndReplace` is importable (FR-013 / research §R12).

---

## Tool registration

| Field | Value |
|---|---|
| `name` | `rename_file` |
| `description` | See "Description text" below — verbatim. |
| `inputSchema` | Derived from `RenameFileRequestSchema` (below) via `zodToJsonSchema(..., { $refStrategy: 'none' })`. |

### Description text (verbatim, including the four pinned substrings)

> Rename a file in the vault while preserving wikilink integrity vault-wide. Accepts `old_path` and `new_path` (both vault-relative). Performs a multi-step composition: pre-flight checks (source exists, destination doesn't, parent folder exists), reads the source, writes the destination, runs vault-wide wikilink rewrites via `find_and_replace`, then deletes the source.
>
> **The operation is multi-step and not atomic.** Failure after the destination write leaves the vault in a partial state; the structured response identifies the failed step and what was written. The wrapper performs no automated recovery.
>
> **Precondition: invoke against a clean git working tree.** `git restore .` from the pre-call commit is the documented rollback baseline for any partial state. The same precondition applies to `find_and_replace` (Tier 2 backlog item 25), which this tool composes.
>
> **Wikilink shape coverage.** Reliably rewritten on rename: `[[basename]]`, `[[basename|alias]]`, `[[basename#heading]]`, `[[basename#heading|alias]]`, `[[basename#^block-id]]`, `![[basename]]`, `![[basename|alias]]`. For cross-folder renames, full-path forms (`[[old-folder/basename]]` and variants) are also rewritten. Out of scope: relative-path forms (`[[../folder/basename]]`) and markdown-style links (`[text](path.md)`) — callers needing these must perform additional `find_and_replace` passes themselves.
>
> **The Obsidian "Automatically update internal links" setting is irrelevant under this implementation.** Wikilink integrity comes from the wrapper's own regex passes through `find_and_replace`, not from Obsidian's index. The setting need not be enabled and has no effect when toggled.
>
> Scope: any vault file (markdown notes and attachments such as images, PDFs, audio). Folder paths are out of scope and will be rejected. Missing parent folders are not auto-created — the caller must ensure the destination folder exists.

This text MUST appear unchanged in `src/tools/rename-file/tool.ts`'s `description` field. The `tests/tools/rename-file/registration.test.ts` test pins the four substrings:

- `"multi-step and not atomic"`
- `"clean git working tree"`
- `"Wikilink shape coverage"` (or any equivalent substring covering the FR-014 catalogue — the test pins the literal heading)
- `"Automatically update internal links" setting is irrelevant`

so that any accidental edit fails CI (User Story 3 / FR-005 / SC-002).

---

## Input schema (zod) — UNCHANGED from Option A

```ts
// src/tools/rename-file/schema.ts (already shipped in commit bebe709, no edit needed)
import { z } from 'zod';

export const RenameFileRequestSchema = z.object({
  old_path: z
    .string()
    .trim()
    .min(1, 'old_path is required')
    .describe('Vault-relative path to the file (markdown note or attachment) to rename.'),
  new_path: z
    .string()
    .trim()
    .min(1, 'new_path is required')
    .describe('Vault-relative destination path. The parent folder must already exist.'),
  vaultId: z
    .string()
    .trim()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export type RenameFileRequest = z.infer<typeof RenameFileRequestSchema>;

export function assertValidRenameFileRequest(args: unknown): RenameFileRequest {
  return RenameFileRequestSchema.parse(args);
}
```

### Validation rules (from FRs and clarifications)

| Rule | Source | Enforced where |
|---|---|---|
| `old_path` is a non-empty string after trim | FR-001 | zod `.trim().min(1)` |
| `new_path` is a non-empty string after trim | FR-001 | zod `.trim().min(1)` |
| `vaultId` is optional and trimmed if present | research.md R8 | zod `.trim().optional()` |
| `old_path === new_path` is a no-op success | FR-009 | Handler-level early return (after zod) |
| `old_path` exists | FR-007 | **Wrapper-side pre-flight** via `rest.getFileContents` step 1 (404 propagated verbatim) |
| `new_path` does not collide | FR-006 | **Wrapper-side pre-flight** via `rest.getFileContents` step 2 (200 → wrapper-constructed `"destination already exists: <new_path>"` error). Single Q1 supersession. |
| `dirname(new_path)` exists | FR-012 | **Wrapper-side pre-flight** via `rest.listFilesInDir` step 3 (404 propagated verbatim) |
| `old_path` is a file, not a folder | FR-001a | **Delegated** — `rest.getFileContents` step 1 fails for folder paths |
| Either path is inside the vault | FR-010 | **Delegated** — each REST primitive's path resolution rejects `..`/absolute paths |
| `find_and_replace` is available | FR-013 | **Build-time** — handler imports `rest.findAndReplace`; absent → build fails |

---

## Composition algorithm — the heart of Option B

The handler executes the following 8 steps in order. Each step is named so it can be referenced from the structured response's `failedAtStep` field (FR-011). Steps 1–3 are pre-flight (failures here keep the vault unchanged — FR-015 atomicity holds). Steps 4–8 are the mid-flight zone (failures here may leave a partial state — atomicity does NOT hold; the structured response surfaces what was written).

```text
0. Validate input. assertValidRenameFileRequest(args) → RenameFileRequest.
   FR-009 short-circuit: if old_path === new_path, return idempotent success without REST calls.

Step 1 — pre_flight_source.
  await rest.getFileContents(old_path)
  - Captures source contents into a local variable (reused at step 5; not re-read).
  - 404 → propagate verbatim. FR-007. (Atomicity: vault unchanged.)
  - Non-2xx (folder, locked, etc.) → propagate verbatim. FR-001a / FR-008.
  - 2xx → store contents, proceed to step 2.

Step 2 — pre_flight_destination.
  await rest.getFileContents(new_path)
  - 200 → wrapper-constructed error: throw new Error("destination already exists: <new_path>"). FR-006. (Atomicity: vault unchanged.)
  - 404 → proceed to step 3.
  - Other non-2xx → propagate verbatim. FR-008.

Step 3 — pre_flight_parent.
  await rest.listFilesInDir(dirname(new_path))
  - 404 → propagate verbatim. FR-012. (Atomicity: vault unchanged.)
  - Non-2xx → propagate verbatim. FR-008.
  - 2xx → proceed to step 4.

  (Edge case: if dirname(new_path) === "" — the destination is at the vault root —
  the pre-flight uses rest.listFilesInVault() instead. Vault root always exists.)

Step 4 — read_source.
  No-op. The source content was captured at step 1 and is reused at step 5.
  This step exists in the `failedAtStep` enum for symmetry but in practice never fails on its own.

Step 5 — write_destination.
  await rest.putContent(new_path, sourceContents)
  - putContent's default semantic is overwrite, which is safe here because step 2 confirmed new_path is empty.
  - Non-2xx → propagate. FAILURE HERE: the destination may or may not be partially written; partialState.destinationWritten is set to "unknown".
  - 2xx → proceed to step 6.

Step 6 — find_and_replace_pass_A through _D.
  Build derived strings (regex-escaped via escapeRegex):
    oldBasename  = basename(old_path) without extension (or with — implementation choice; document)
    newBasename  = basename(new_path) without extension
    oldFolder    = dirname(old_path)
    newFolder    = dirname(new_path)
    crossFolder  = (oldFolder !== newFolder)

  For each pass in [A, B, C] and (if crossFolder) [D]:
    const { pattern, replacement } = buildPassN(escapeRegex(oldBasename), escapeRegex(newBasename), ...)
    const result = await rest.findAndReplace({
      pattern,
      replacement,
      flags: "g",
      skipCodeBlocks: true,
      skipHtmlComments: true,
    })
    wikilinkPassesRun.push(passLetter)
    wikilinkRewriteCounts[passLetter] = result.totalReplacements

  Pass A regex (bare + aliased; negative lookbehind excludes embed forms):
    /(?<!!)\[\[(<oldBasename>)(\|[^\]]*)?\]\]/g
    → "[[<newBasename>$2]]"

  Pass B regex (heading-targeted, with optional alias; negative lookbehind excludes embed-with-heading forms):
    /(?<!!)\[\[(<oldBasename>)(#[^\]|]*)(\|[^\]]*)?\]\]/g
    → "[[<newBasename>$2$3]]"

  Pass C regex (embed forms — REQUIRES the leading `!`):
    /!\[\[(<oldBasename>)(\|[^\]]*)?\]\]/g
    → "![[<newBasename>$2]]"

  Pass D regex (full-path forms, only when crossFolder; negative lookbehind excludes embed-full-path forms):
    /(?<!!)\[\[<oldFolder>\/(<oldBasename>)(#[^\]|]*)?(\|[^\]]*)?\]\]/g
    → "[[<newFolder>/<newBasename>$2$3]]"

  The (?<!!) negative lookbehind on Passes A, B, D ensures each pass owns
  exactly one shape family — embeds (`![[…]]`) are handled exclusively by
  Pass C, never inadvertently by the others.

  - Failure in any pass → propagate the find_and_replace error. partialState.passesCompleted records the passes that completed before the failure.

Step 7 — delete_source.
  await rest.deleteFile(old_path)
  - 200 → proceed.
  - Non-2xx → propagate. partialState.sourceDeleted = false; the destination is written and wikilinks rewritten, but the source still exists. The caller can manually delete or git-restore.

Step 8 — return success response.
  Build and return the FR-011 success shape (see "Output: success" below).
```

**Implementation notes**:

- `<oldBasename>` and `<newBasename>` extraction: discuss with the implementer whether to include the file extension or strip it. Wikilinks in Obsidian typically omit the `.md` extension but include other extensions (e.g. `.png`). The right move is probably: strip `.md` for markdown notes, keep the full filename for attachments. Document the choice in the handler's docstring.
- `dirname("")` and `basename("")` edge cases: the validated `old_path`/`new_path` are non-empty after trim (zod), but a path of just `"file.md"` (no folder) yields `dirname() === ""`. Handle by treating empty dirname as vault root and using `rest.listFilesInVault()` for step 3.
- The structured response is built incrementally throughout the algorithm and returned at step 8 OR thrown alongside the error at any failed step. See "Output: failure" below.

---

## Derived JSON inputSchema (the published shape) — UNCHANGED from Option A

What MCP clients see when they call `tools/list`:

```json
{
  "type": "object",
  "properties": {
    "old_path": { "type": "string", "description": "Vault-relative path to the file (markdown note or attachment) to rename." },
    "new_path": { "type": "string", "description": "Vault-relative destination path. The parent folder must already exist." },
    "vaultId":  { "type": "string", "description": "Optional vault ID (defaults to configured default vault)." }
  },
  "required": ["old_path", "new_path"],
  "additionalProperties": false
}
```

---

## Output: success

When all 8 algorithm steps complete without throwing, the handler returns:

```ts
{
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        ok: true,
        oldPath: <validated old_path>,
        newPath: <validated new_path>,
        wikilinkPassesRun: [<subset of "A", "B", "C", "D">],
        wikilinkRewriteCounts: {
          passA: <number>,
          passB: <number>,
          passC: <number>,
          passD: <number | null>,  // null when same-folder rename (Pass D skipped)
        },
        totalReferencesRewritten: <sum of non-null counts>,
      }, null, 2),
    },
  ],
}
```

Concretely, a caller invoking `rename_file({ old_path: 'notes/alpha.md', new_path: 'notes/beta.md' })` after a successful rename of a note with 7 wikilink references and 0 embed references would receive:

```json
{
  "ok": true,
  "oldPath": "notes/alpha.md",
  "newPath": "notes/beta.md",
  "wikilinkPassesRun": ["A", "B", "C"],
  "wikilinkRewriteCounts": {
    "passA": 7,
    "passB": 0,
    "passC": 0,
    "passD": null
  },
  "totalReferencesRewritten": 7
}
```

inside a single `text` content block. Reasoning: research.md §R7. Honors FR-011 (response identifies both paths + per-pass counts) and SC-004 (single round-trip confirmation including all data needed for caller to know what changed).

### Idempotent no-op (FR-009)

When `old_path === new_path` after trim, the handler skips all REST calls and returns:

```json
{
  "ok": true,
  "oldPath": "notes/alpha.md",
  "newPath": "notes/alpha.md",
  "wikilinkPassesRun": [],
  "wikilinkRewriteCounts": { "passA": null, "passB": null, "passC": null, "passD": null },
  "totalReferencesRewritten": 0
}
```

The empty `wikilinkPassesRun` array distinguishes "no-op" from "ran passes, found zero references" — for the latter, the array would be `["A", "B", "C"]` and the counts would be zero (not null).

---

## Output: failure

The handler does NOT construct error objects for upstream failures. There are four failure paths:

### 1. Validation failure (zod) — pre-step-1, atomicity holds

The zod schema rejects malformed input. The handler catches `z.ZodError`, extracts the first issue's path + message, and rethrows a plain `Error`:

```ts
throw new Error(`Invalid input — ${path}: ${message}`);
```

This matches the [list-tags handler pattern](../../../src/tools/list-tags/handler.ts). Caller-visible MCP payload for `rename_file({})`:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Invalid input — old_path: old_path is required" }]
}
```

### 2. Pre-flight failure (steps 1, 2, 3) — atomicity holds

If any pre-flight step fails, the wrapper either propagates the upstream typed error verbatim (steps 1, 3, and step 2's non-200-non-404 case) or constructs the FR-006 collision error (step 2's 200 case). In both sub-cases, **no `putContent`, `findAndReplace`, or `deleteFile` call is issued** — the vault is byte-for-byte unchanged from its pre-call state.

The dispatcher's outer `try/catch` in `src/index.ts` converts the propagated/constructed exception to MCP `{content: [{type: 'text', text: <message>}], isError: true}`.

### 3. Mid-flight failure (steps 5, 6, 7) — atomicity does NOT hold

If a step at or after `write_destination` fails, the handler:

1. Catches the error from the failing REST call.
2. Builds a structured failure response (this is the one place beyond zod where the handler wraps an upstream error rather than propagating raw):

```json
{
  "ok": false,
  "oldPath": "<validated old_path>",
  "newPath": "<validated new_path>",
  "failedAtStep": "find_and_replace_pass_B",
  "partialState": {
    "destinationWritten": true,
    "passesCompleted": ["A"],
    "sourceDeleted": false
  },
  "error": "<upstream error message verbatim>"
}
```

3. Returns this as the MCP `CallToolResult` content (NOT throwing — because the structured response IS the value the caller needs to recover). However, the result is still flagged with `isError: true` so MCP-aware clients can distinguish success from partial-failure without parsing the JSON body.

This is the FR-008 / FR-011 / FR-015 contract working together. Note: the catch is justified by the structured-response requirement; the underlying error message is preserved verbatim in the `error` field.

### 4. Cross-cutting (any step's typed error vs. an unexpected throw)

For `ObsidianApiError` / `ObsidianTimeoutError` / `ObsidianNotFoundError` thrown by `safeCall`, the handler treats them per their step (pre-flight = path 2; mid-flight = path 3). For unexpected non-typed errors (e.g. a TypeError from the JSON serialiser), the handler propagates without wrapping — the dispatcher's default error handler stringifies them.

---

## Behavioural contract: pseudocode for the handler

The implementation should mirror this shape almost exactly. **This pseudocode is part of the contract; the handler in T005 imports `buildPassA` etc. from `./regex-passes.js`.**

```ts
// src/tools/rename-file/handler.ts (DEFERRED — written when item 25 ships)
import { z } from 'zod';
import { assertValidRenameFileRequest } from './schema.js';
import { buildPassA, buildPassB, buildPassC, buildPassD, escapeRegex } from './regex-passes.js';
import type { ObsidianRestService } from '../../services/obsidian-rest.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';

type FailedStep =
  | 'pre_flight_source' | 'pre_flight_destination' | 'pre_flight_parent'
  | 'read_source' | 'write_destination'
  | 'find_and_replace_pass_A' | 'find_and_replace_pass_B'
  | 'find_and_replace_pass_C' | 'find_and_replace_pass_D'
  | 'delete_source';

export async function handleRenameFile(
  args: unknown,
  rest: ObsidianRestService
): Promise<CallToolResult> {
  // 0. Validate input
  let req;
  try {
    req = assertValidRenameFileRequest(args);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issue = err.issues[0];
      const fieldPath = issue?.path.join('.') ?? '';
      throw new Error(`Invalid input — ${fieldPath}: ${issue?.message ?? 'invalid'}`);
    }
    throw err;
  }

  // FR-009 idempotent no-op
  if (req.old_path === req.new_path) {
    return successResponse(req.old_path, req.new_path, [], {
      passA: null, passB: null, passC: null, passD: null,
    });
  }

  const oldBasename = stripMdExtension(path.posix.basename(req.old_path));
  const newBasename = stripMdExtension(path.posix.basename(req.new_path));
  const oldFolder = path.posix.dirname(req.old_path);
  const newFolder = path.posix.dirname(req.new_path);
  const crossFolder = oldFolder !== newFolder;

  // Step 1: pre_flight_source (also captures content for step 5)
  let sourceContent: string;
  try {
    sourceContent = await rest.getFileContents(req.old_path);
  } catch (err) { throw err; }  // FR-007 / FR-001a / FR-008 — propagate verbatim, atomicity holds

  // Step 2: pre_flight_destination (collision check — wrapper-side per Q1 supersession)
  try {
    await rest.getFileContents(req.new_path);
    // 200 = collision
    throw new Error(`destination already exists: ${req.new_path}`);
  } catch (err) {
    if (err instanceof ObsidianNotFoundError) { /* 404 = no collision, proceed */ }
    else { throw err; }  // wrapper-constructed collision error OR genuine upstream error
  }

  // Step 3: pre_flight_parent (FR-012 — no auto-create)
  try {
    if (newFolder === '' || newFolder === '.') {
      await rest.listFilesInVault();
    } else {
      await rest.listFilesInDir(newFolder);
    }
  } catch (err) { throw err; }  // FR-012 / FR-008 — propagate verbatim, atomicity holds

  // Steps 4-7 — mid-flight zone, atomicity does NOT hold
  const partial = { destinationWritten: false, passesCompleted: [] as string[], sourceDeleted: false };
  const counts = { passA: 0, passB: 0, passC: 0, passD: crossFolder ? 0 : null };

  try {
    // Step 5: write_destination
    await rest.putContent(req.new_path, sourceContent);
    partial.destinationWritten = true;

    // Step 6: find_and_replace passes
    for (const pass of (crossFolder ? ['A', 'B', 'C', 'D'] : ['A', 'B', 'C']) as const) {
      const builder = { A: buildPassA, B: buildPassB, C: buildPassC, D: buildPassD }[pass];
      const args = pass === 'D'
        ? { oldBasename, newBasename, oldFolder, newFolder }
        : { oldBasename, newBasename };
      const { pattern, replacement } = builder(args as any);
      const result = await rest.findAndReplace({
        pattern, replacement, flags: 'g',
        skipCodeBlocks: true, skipHtmlComments: true,
      });
      counts[`pass${pass}` as keyof typeof counts] = result.totalReplacements;
      partial.passesCompleted.push(pass);
    }

    // Step 7: delete_source
    await rest.deleteFile(req.old_path);
    partial.sourceDeleted = true;
  } catch (err) {
    return midFlightFailureResponse(req.old_path, req.new_path, partial, err);
  }

  // Step 8: success response
  return successResponse(req.old_path, req.new_path, partial.passesCompleted, counts);
}
```

(Helper functions `successResponse`, `midFlightFailureResponse`, `stripMdExtension` to be defined in the handler module. The exact shapes match the Output sections above.)

---

## Mapping: requirements → contract elements

| Requirement | How it shows up in the contract |
|---|---|
| FR-001 (tool name + parameters) | `name: 'rename_file'`, `RenameFileRequestSchema` with `old_path`, `new_path` required strings |
| FR-001a (folder rejection) | Description text declares scope; rejection enforced by step 1 (`getFileContents` fails for folder paths) |
| FR-002 (composition over service-layer REST primitives) | Pseudocode: 5 distinct `rest.*` methods; no Obsidian command dispatch |
| FR-003 (thin composition; no markdown AST) | Handler imports only the schema, the regex-passes module, and `rest`; no AST library |
| FR-004 (link integrity on success — wikilinks + embeds) | Inherited from the four `find_and_replace` passes. `wikilinkRewriteCounts` reports per-pass results. |
| FR-004a (alias preservation) | Capture group in Passes A/B/C preserves the alias literally (`$2` or `$3`) in the replacement |
| FR-005 (description discloses precondition + non-atomicity + shape coverage + setting irrelevance) | Description text contains all four pinned substrings; pinned by `registration.test.ts` |
| FR-006 (collision rejection — wrapper-side per Q1 supersession) | Step 2 in algorithm; failure path #3 of "Output: failure" |
| FR-007 (missing-source rejection — delegated) | Step 1 in algorithm; failure path #2 (verbatim propagation) |
| FR-008 (surface upstream failures) | All five `rest.*` calls propagate `safeCall` errors. The single explicit wrap is the FR-006 collision construction. |
| FR-009 (identical-paths no-op) | Handler-level early return before step 1; structured response with empty `wikilinkPassesRun` |
| FR-010 (out-of-vault rejection) | Delegated to each REST primitive's path resolution; first failing step propagates |
| FR-011 (response identifies both paths + structured detail) | Success and failure response shapes documented above |
| FR-012 (no auto-create / no `create_parents` flag) | Schema has no `create_parents` field; step 3 fails when parent missing; failure path #2 |
| FR-013 (find_and_replace build-time dependency) | Handler imports `rest.findAndReplace`; build fails if absent |
| FR-014 (wikilink shape coverage) | Description text lists reliable shapes; Passes A/B/C/D in algorithm step 6 implement them |
| FR-015 (multi-step non-atomic; structured `failedAtStep`) | Failure path #3 ("Mid-flight failure") returns structured response with `failedAtStep` + `partialState` |
| SC-001 (100% reliable-shape coverage) | Inherited from regex correctness (regex-passes.test.ts) + `find_and_replace`'s vault traversal |
| SC-002 (description discoverability) | `registration.test.ts` substring assertions |
| SC-003 (atomicity for pre-flight rejections only) | Pre-flight failure paths #1 and #2 exit before any mutation; mid-flight failures explicitly best-effort per FR-015 |
| SC-004 (single round-trip confirmation) | Success/failure responses are synchronous; structured response includes all data needed |
| SC-005 (no markdown AST parsing) | Handler imports no markdown-AST library; T017a import-guard test pins this |

---

## Test-coverage contract (Principle II, NON-NEGOTIABLE)

`tests/tools/rename-file/` MUST contain at minimum:

| Test file | Test | Purpose |
|---|---|---|
| `registration.test.ts` | "RENAME_FILE_TOOLS exports exactly one entry named rename_file" | Pins the tool registration shape |
| `registration.test.ts` | "inputSchema is the zod-to-json-schema derivative of RenameFileRequestSchema" | Pins Constitution Principle III (single source of truth) |
| `registration.test.ts` | "description discloses the multi-step / non-atomic nature" | Pins FR-005(a) substring |
| `registration.test.ts` | "description discloses the git-clean precondition" | Pins FR-005(b) substring |
| `registration.test.ts` | "description discloses the wikilink shape coverage" | Pins FR-005(c) — substrings naming "Wikilink shape coverage" + the reliable shape catalogue |
| `registration.test.ts` | "description discloses irrelevance of the Obsidian setting" | Pins FR-005(d) substring |
| `regex-passes.test.ts` | "Pass A — bare wikilink rewrites" | `[[old]] → [[new]]` correctness against synthetic input |
| `regex-passes.test.ts` | "Pass A — aliased wikilink preserves alias" | `[[old\|alias]] → [[new\|alias]]` (FR-004a) |
| `regex-passes.test.ts` | "Pass A — does NOT match within a different basename" | `[[older]]` is unchanged when renaming `old`; word-boundary correctness |
| `regex-passes.test.ts` | "Pass B — heading-targeted wikilink rewrites" | `[[old#heading]] → [[new#heading]]` |
| `regex-passes.test.ts` | "Pass B — heading + alias preserves both" | `[[old#heading\|alias]] → [[new#heading\|alias]]` |
| `regex-passes.test.ts` | "Pass B — block-reference rewrites" | `[[old#^block-id]] → [[new#^block-id]]` (block refs are valid `#…` segments) |
| `regex-passes.test.ts` | "Pass C — embed wikilink rewrites" | `![[old]] → ![[new]]` |
| `regex-passes.test.ts` | "Pass C — embed with alias preserves alias" | `![[old\|alias]] → ![[new\|alias]]` |
| `regex-passes.test.ts` | "Pass D — full-path wikilink rewrites (cross-folder)" | `[[old-folder/old]] → [[new-folder/new]]` |
| `regex-passes.test.ts` | "Pass D — full-path with heading + alias" | `[[old-folder/old#heading\|alias]] → [[new-folder/new#heading\|alias]]` |
| `regex-passes.test.ts` | "escapeRegex handles parens and dots" | `escapeRegex("Foo (Bar).baz")` equals `"Foo \\(Bar\\)\\.baz"` |
| `regex-passes.test.ts` | "buildPassA escapes oldBasename before substitution" | Pattern for `oldBasename = "Foo (Bar)"` is a valid regex that matches `[[Foo (Bar)]]` literally |
| `handler.test.ts` (DEFERRED until item 25 ships) | "happy path: full 8-step composition runs in order, returns success structure" | Mocked `rest` with all 5 methods; assert call order + return shape |
| `handler.test.ts` (DEFERRED) | "FR-006: collision detected; constructs wrapper-side error; no put/F&R/delete" | Mock step 2 to return 200; assert wrapper-constructed error, assert no further calls |
| `handler.test.ts` (DEFERRED) | "FR-007: source missing; propagates verbatim; no further calls" | Mock step 1 to throw `ObsidianNotFoundError`; assert propagation, no further calls |
| `handler.test.ts` (DEFERRED) | "FR-012: parent folder missing; propagates verbatim; no further calls" | Mock step 3 to throw 404; assert propagation, no put/F&R/delete |
| `handler.test.ts` (DEFERRED) | "FR-009: identical paths short-circuits with no REST calls" | Identical inputs; assert 0 REST calls + correct idempotent response shape |
| `handler.test.ts` (DEFERRED) | "FR-015: mid-flight failure at find_and_replace_pass_B returns structured response" | Mock pass-B `findAndReplace` to throw; assert response has `ok: false, failedAtStep: "find_and_replace_pass_B", partialState.passesCompleted: ["A"]` |
| `handler.test.ts` (DEFERRED) | "validation: missing old_path rethrows as `Invalid input — old_path: …`" | Pins the zod re-throw shape |
| `handler.test.ts` (DEFERRED) | "SC-005 import guard" | Reads handler source from disk; asserts no markdown-AST library imports (`marked`, `unified`, `remark`, `mdast-util-*`, etc.) |

Adding more tests is encouraged; removing any of these violates Principle II.
