# Contract: `rename_file` MCP tool

**Feature**: 012-safe-rename | **Phase**: 1 (Design & Contracts) | **Date**: 2026-05-02
**Defines**: The single source of truth for the `rename_file` MCP tool's wire contract — what callers see in `tools/list`, what they may send, what they receive on success, and what they receive on failure.

This contract MUST be honoured exactly by the implementation. The zod schema below is the **single source of truth** (Constitution Principle III): the runtime parser and the published JSON `inputSchema` both derive from it via `zod-to-json-schema`. If the schema and this document ever disagree, fix this document — the schema wins.

---

## Tool registration

| Field | Value |
|---|---|
| `name` | `rename_file` |
| `description` | See "Description text" below — verbatim. |
| `inputSchema` | Derived from `RenameFileRequestSchema` (below) via `zodToJsonSchema(..., { $refStrategy: 'none' })`. |

### Description text (verbatim, including the precondition)

> Rename a file in the vault while preserving wikilink integrity vault-wide. Accepts `old_path` and `new_path` (both vault-relative). Dispatches Obsidian's built-in "Rename file" command via the existing command-execution endpoint, so every `[[wikilink]]` and `![[embed]]` referencing the old name is rewritten in the same operation.
>
> **Precondition: this tool's wikilink-integrity guarantee depends on Obsidian's "Automatically update internal links" setting being enabled in the focused vault (Settings → Files & Links). If that setting is off, the file rename will still succeed but referencing wikilinks will NOT be rewritten. Verify the setting before relying on this tool.**
>
> Scope: any vault file (markdown notes and attachments such as images, PDFs, audio). Folder paths are out of scope and will be rejected. Missing parent folders are not auto-created — the caller must ensure the destination folder exists. Errors from the underlying Obsidian command (file not found, destination already exists, missing folder, locked file, etc.) are propagated verbatim.

This text MUST appear unchanged in `src/tools/rename-file/tool.ts`'s `description` field. The `tests/tools/rename-file/registration.test.ts` test pins the substrings:

- `"Automatically update internal links"`
- `"Settings → Files & Links"`
- `"Folder paths are out of scope"`
- `"Missing parent folders are not auto-created"`

so that any accidental edit fails CI (User Story 3 / FR-005 / SC-002).

---

## Input schema (zod)

```ts
// src/tools/rename-file/schema.ts
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
| `vaultId` is optional and trimmed if present | R8 in [research.md](../research.md) | zod `.trim().optional()` |
| `old_path === new_path` is a no-op success | FR-009 | Handler-level early return (after zod) |
| `old_path` exists | FR-007 | **Delegated** to Obsidian (no pre-flight) — Q1 |
| `new_path` does not collide | FR-006 | **Delegated** to Obsidian (no pre-flight) — Q1 |
| `old_path` is a file, not a folder | FR-001a / Q2 | **Delegated** — error propagates from upstream `openFile` / `executeCommand` per R6 in [research.md](../research.md) |
| `new_path`'s parent folder exists | FR-012 | **Delegated** — no auto-create, no `create_parents` flag |
| Either path is inside the vault | FR-010 | **Delegated** to the REST plugin's path resolution |

---

## Derived JSON inputSchema (the published shape)

What MCP clients see when they call `tools/list`:

```json
{
  "type": "object",
  "properties": {
    "old_path": {
      "type": "string",
      "description": "Vault-relative path to the file (markdown note or attachment) to rename."
    },
    "new_path": {
      "type": "string",
      "description": "Vault-relative destination path. The parent folder must already exist."
    },
    "vaultId": {
      "type": "string",
      "description": "Optional vault ID (defaults to configured default vault)."
    }
  },
  "required": ["old_path", "new_path"],
  "additionalProperties": false
}
```

(Exact serialisation is whatever `zod-to-json-schema` produces for the schema above; this document is illustrative. The `registration.test.ts` test should not pin the full JSON shape — only the description substrings — to avoid coupling to `zod-to-json-schema`'s formatting.)

---

## Output: success

When the underlying flow (`openFile` → `executeCommand`) resolves without throwing, the handler returns:

```ts
{
  content: [
    {
      type: 'text',
      text: JSON.stringify(
        { old_path: <validated old_path>, new_path: <validated new_path> },
        null,
        2
      ),
    },
  ],
}
```

Concretely, a caller invoking `rename_file({ old_path: 'notes/alpha.md', new_path: 'notes/beta.md' })` receives:

```text
{
  "old_path": "notes/alpha.md",
  "new_path": "notes/beta.md"
}
```

inside a single `text` content block. Reasoning: R7 in [research.md](../research.md). Honors FR-011 (response identifies both paths) and SC-004 (single round-trip confirmation).

### Idempotent no-op (FR-009)

When `old_path === new_path` after trim, the handler skips the REST calls entirely and returns the same shape, reflecting the trimmed paths. No upstream interaction occurs.

---

## Output: failure

The handler does NOT construct error objects. Three failure paths exist:

### 1. Validation failure (zod)

The zod schema rejects malformed input. The handler catches `z.ZodError`, extracts the first issue's path + message, and rethrows a plain `Error`:

```ts
throw new Error(`Invalid input — ${path}: ${message}`);
```

This matches the [list-tags handler pattern](../../../src/tools/list-tags/handler.ts) and is intercepted by the dispatcher's outer `try/catch` in `src/index.ts`, which converts it to MCP `{content: [{type: 'text', text: <message>}], isError: true}`.

Example caller-visible payload for `rename_file({})`:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Invalid input — old_path: old_path is required" }]
}
```

### 2. Upstream failure from `rest.openFile`

If `POST /open/?file={old_path}` returns a non-2xx, `safeCall` throws one of `ObsidianApiError` / `ObsidianTimeoutError` / `ObsidianNotFoundError`. The handler does not catch these — they propagate to the dispatcher and become an MCP `isError: true` response carrying the upstream status code and message.

This is the path that fires for FR-007 (missing source) and FR-001a (folder path) per R6 in [research.md](../research.md), since both fail at `openFile` time.

### 3. Upstream failure from `rest.executeCommand`

If `POST /commands/{commandId}` returns a non-2xx, the same propagation chain applies. This is the path that fires for FR-006 (collision), FR-008 (locked file / read-only / plugin error), FR-012 (missing parent folder).

In all three failure paths, the vault is unchanged from the pre-call state (SC-003).

---

## Behavioural contract: the dispatch flow

Pseudocode for the handler (the actual implementation should mirror this shape almost exactly):

```ts
// src/tools/rename-file/handler.ts
const RENAME_COMMAND_ID = '<spike-confirmed id>'; // see R2/R5 in research.md

export async function handleRenameFile(
  args: unknown,
  rest: ObsidianRestService
): Promise<CallToolResult> {
  let req: RenameFileRequest;
  try {
    req = assertValidRenameFileRequest(args);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issue = err.issues[0];
      const path = issue?.path.join('.') ?? '';
      throw new Error(`Invalid input — ${path}: ${issue?.message ?? 'invalid'}`);
    }
    throw err;
  }

  // FR-009: idempotent no-op
  if (req.old_path === req.new_path) {
    return successResponse(req.old_path, req.new_path);
  }

  // R3: Obsidian commands operate on the active editor
  await rest.openFile(req.old_path);

  // R1: compose at the service layer to honour Principle IV / Q1
  await rest.executeCommand(RENAME_COMMAND_ID);

  // FR-011 / SC-004
  return successResponse(req.old_path, req.new_path);
}

function successResponse(old_path: string, new_path: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ old_path, new_path }, null, 2),
      },
    ],
  };
}
```

**Note on the dispatch step**: R4 in [research.md](../research.md) flags that conveying `new_path` to the rename command is an open empirical question. The pseudocode above shows the simplest case (command takes no args); the implementer adjusts the `rest.executeCommand(...)` call shape based on the spike's findings. If the spike reveals that the command needs a body or query parameter, the change is local to this single line plus a corresponding addition to `ObsidianRestService.executeCommand` (or a sibling method).

---

## Mapping: requirements → contract elements

| Requirement | How it shows up in the contract |
|---|---|
| FR-001 (tool name + parameters) | `name: 'rename_file'`, `RenameFileRequestSchema` with `old_path`, `new_path` required strings |
| FR-001a (folder rejection) | Description text declares scope; rejection enforced by error propagation from upstream |
| FR-002 (dispatch via command endpoint) | Pseudocode `rest.executeCommand(RENAME_COMMAND_ID)` |
| FR-003 (thin composition; no parsing) | Handler contains no file-content reads/writes; success response synthesised from validated inputs |
| FR-004 (link integrity on success) | Inherited from Obsidian's command behaviour — no contract surface in this tool |
| FR-005 (precondition in description) | Explicitly bolded in the Description text; pinned by `registration.test.ts` |
| FR-006 (collision rejection) | Delegated; failure path #3 |
| FR-007 (missing-source rejection) | Delegated; failure path #2 |
| FR-008 (surface upstream failures) | Failure paths #2 + #3; no try/catch in handler beyond the zod re-throw |
| FR-009 (identical-paths no-op) | Handler-level early return before any REST call |
| FR-010 (out-of-vault rejection) | Delegated to the REST plugin's path resolution |
| FR-011 (response identifies both paths) | Success output JSON shape |
| FR-012 (no auto-create / no create_parents flag) | Schema has no `create_parents` field; handler does not pre-create folders; failure path #3 |
| SC-001 (100% link rewriting) | Inherited from Obsidian; verified manually via [quickstart.md](../quickstart.md) |
| SC-002 (description discoverability) | `registration.test.ts` substring assertions |
| SC-003 (zero modification on failure) | All three failure paths exit before mutating vault state (or before the second REST call lands) |
| SC-004 (single round-trip confirmation) | Success response is synchronous; no follow-up call needed |
| SC-005 (no file-content code) | Handler imports no `getFileContents` / `putContent` / `appendContent` / `patchContent` methods; can be enforced as a grep in CI if needed |

---

## Test-coverage contract (Principle II, NON-NEGOTIABLE)

`tests/tools/rename-file/` MUST contain at minimum:

| Test file | Test | Purpose |
|---|---|---|
| `registration.test.ts` | "description includes the link-update precondition" | Pins the FR-005 / SC-002 substring contract. |
| `registration.test.ts` | "description includes the folder-out-of-scope clause" | Pins Q2 / FR-001a contract surface. |
| `registration.test.ts` | "description includes the no-auto-create clause" | Pins Q3 / FR-012 contract surface. |
| `handler.test.ts` | "happy path: opens the source file then dispatches the rename command" | Mocked `rest.openFile` + `rest.executeCommand`; asserts both were called with the right arguments and that the response echoes the validated paths. |
| `handler.test.ts` | "failure path: upstream `executeCommand` error propagates verbatim" | Mocked `rest.executeCommand` throws an `ObsidianApiError`; asserts the handler does not catch it and the error propagates with status code intact (Principle IV / Q1). |
| `handler.test.ts` | "validation: missing `old_path` rethrows as `Invalid input — old_path: …`" | Pins the zod re-throw shape used by the dispatcher. |
| `handler.test.ts` | "FR-009: identical paths short-circuits with no REST calls" | Mocked `rest` recording calls; asserts neither `openFile` nor `executeCommand` was invoked. |

Adding more tests is encouraged; removing any of these violates Principle II.
