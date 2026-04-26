# Contract: `detect_note_clusters`

**Tool name**: `detect_note_clusters`
**Backed by**: `GraphService.detectNoteClusters(minClusterSize)` ([src/services/graph-service.ts:362](../../../src/services/graph-service.ts#L362))
**Spec source**: FR-003, FR-004, FR-008, FR-009, FR-011, FR-013

## Precondition

`OBSIDIAN_VAULT_PATH` must be set for the targeted vault.

## Input

```json
{
  "minClusterSize": "number?  // default 3; positive integer",
  "vaultId": "string?"
}
```

Validated by `assertValidDetectNoteClustersRequest(args)`.

## Output

```json
{
  "clusters": [
    { "id": 0, "notes": ["a.md", "b.md", "c.md", ...], "size": 12 },
    { "id": 4, "notes": [...], "size": 8 },
    ...
  ],
  "skipped": "number",
  "skippedPaths": "string[]"
}
```

`clusters` is sorted descending by `size`. Only clusters with `size >= minClusterSize` are returned. Detection uses Louvain community detection (graphology-communities-louvain).

## Error responses

- **`Unknown tool`**: MUST NOT occur.
- **Vault path unset**: standard precondition error.
- **`ZodError`** for malformed input.

## Smoke-test row (FR-013)

```ts
{ name: 'detect_note_clusters', args: {} }
```

Smoke assertions: (1) `result.content[0].text` does not contain `Unknown tool`; (2) parsed JSON has top-level `clusters` (array), `skipped` (number), `skippedPaths` (array) — closes Constitution Principle II happy-path gap per remediation C2.
