# Contract: `get_note_connections`

**Tool name**: `get_note_connections`
**Backed by**: `GraphService.getNoteConnections(filepath)` ([src/services/graph-service.ts:279](../../../src/services/graph-service.ts#L279))
**Spec source**: FR-003, FR-004, FR-008, FR-009, FR-012, FR-013

## Precondition

`OBSIDIAN_VAULT_PATH` must be set for the targeted vault.

## Input

```json
{
  "filepath": "string  // REQUIRED; path to note relative to vault root, with or without .md",
  "depth": "number?  // optional; reserved (currently ignored by service)",
  "vaultId": "string?"
}
```

Validated by `assertValidGetNoteConnectionsRequest(args)`. `filepath` MUST be a non-empty string.

## Output

`NoteConnections` shape — **no envelope** (per-note tool, FR-011 carve-out):

```json
{
  "filepath": "folder/note.md",   // normalized (with .md if input lacked it)
  "outgoingLinks": ["a.md", "b.md", ...],
  "backlinks": ["c.md", ...],
  "tags": ["projects", "open"]
}
```

Empty arrays are valid: a note that exists but has no incoming or outgoing links returns `outgoingLinks: []`, `backlinks: []`. This is the "found but no connections" case — distinct from "note not found".

## Error responses (FR-012)

- **`Unknown tool`**: MUST NOT occur.
- **Note not found** (target path absent from vault): `Error: note not found: <path>` — or `Error: note not found: <path> (vault: <id>)` when `vaultId` was explicitly supplied. This MUST be distinct from the "found but no connections" case (which returns success with empty arrays).
- **Vault path unset**: standard precondition error.
- **`ZodError`** for malformed input (e.g. missing `filepath`).
- **Note present but unparseable** (broken frontmatter, unreadable file, invalid UTF-8): same `note not found:` error shape — the note isn't in the graph because the build skipped it.

## Smoke-test row (FR-013)

```ts
{ name: 'get_note_connections', args: { filepath: 'smoke-test-nonexistent.md' } }
```

The smoke test EXPECTS this call to fail with `note not found: smoke-test-nonexistent.md` — the failure proves the dispatcher routed the call (FR-013 accepts non-`Unknown tool` errors as proof of dispatch).
