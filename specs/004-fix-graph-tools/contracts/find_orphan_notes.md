# Contract: `find_orphan_notes`

**Tool name**: `find_orphan_notes`
**Backed by**: `GraphService.findOrphanNotes(includeBacklinks)` ([src/services/graph-service.ts:257](../../../src/services/graph-service.ts#L257))
**Spec source**: FR-003, FR-004, FR-008, FR-009, FR-011, FR-013

## Precondition

`OBSIDIAN_VAULT_PATH` must be set for the targeted vault.

## Input

```json
{
  "includeBacklinks": "boolean?  // default true",
  "vaultId": "string?"
}
```

Validated by `assertValidFindOrphanNotesRequest(args)`.

When `includeBacklinks` is `true` (default), a note is an orphan iff it has zero in-degree AND zero out-degree. When `false`, only out-degree is considered (notes that have inbound links but no outbound ones are NOT considered orphans).

## Output

```json
{
  "orphans": ["folder/note.md", "another.md", ...],
  "skipped": "number",
  "skippedPaths": "string[]"
}
```

`orphans` is an array of file paths relative to vault root. Empty array when no orphans exist.

## Error responses

- **`Unknown tool`**: MUST NOT occur.
- **Vault path unset**: standard precondition error.
- **`ZodError`** for malformed input.

## Smoke-test row (FR-013)

```ts
{ name: 'find_orphan_notes', args: {} }
```

Smoke assertions: (1) `result.content[0].text` does not contain `Unknown tool`; (2) parsed JSON has top-level `orphans` (array), `skipped` (number), `skippedPaths` (array) — closes Constitution Principle II happy-path gap per remediation C2.
