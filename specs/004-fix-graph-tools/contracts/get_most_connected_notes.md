# Contract: `get_most_connected_notes`

**Tool name**: `get_most_connected_notes`
**Backed by**: `GraphService.getMostConnectedNotes(limit, metric)` ([src/services/graph-service.ts:339](../../../src/services/graph-service.ts#L339))
**Spec source**: FR-003, FR-004, FR-008, FR-009, FR-011, FR-013

## Precondition

`OBSIDIAN_VAULT_PATH` must be set for the targeted vault.

## Input

```json
{
  "limit": "number?  // default 10; positive integer",
  "metric": "'links' | 'backlinks' | 'pagerank'?  // default 'backlinks'",
  "vaultId": "string?"
}
```

Validated by `assertValidGetMostConnectedNotesRequest(args)`.

## Output

```json
{
  "notes": [
    { "path": "highly-linked.md", "score": 42 },
    { "path": "second-place.md", "score": 39 },
    ...
  ],
  "skipped": "number",
  "skippedPaths": "string[]"
}
```

`notes` is sorted descending by `score`, capped at `limit`. Empty array when the vault has no notes.

## Error responses

- **`Unknown tool`**: MUST NOT occur.
- **Vault path unset**: standard precondition error.
- **`ZodError`** for malformed input (e.g. `metric: "centrality"`).

## Smoke-test row (FR-013)

```ts
{ name: 'get_most_connected_notes', args: {} }
```
