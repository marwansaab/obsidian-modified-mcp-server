# Contract: `get_vault_stats`

**Tool name**: `get_vault_stats`
**Backed by**: `GraphService.getVaultStats()` ([src/services/graph-service.ts:223](../../../src/services/graph-service.ts#L223))
**Spec source**: FR-003, FR-004, FR-006 (deep regression test), FR-008, FR-009, FR-011, SC-005

## Precondition

`OBSIDIAN_VAULT_PATH` must be set for the targeted vault (i.e. `vault.vaultPath` is non-empty in the resolved `VaultConfig`). Without it, the handler throws — surfaced as MCP `isError: true` with message `Vault "<id>" does not have vaultPath configured (required for graph tools).` The tool description states this precondition explicitly (FR-008).

## Input

```json
{
  "vaultId": "string?  // optional; defaults to configured default vault"
}
```

Validated by `assertValidGetVaultStatsRequest(args)` — derived from `GetVaultStatsRequestSchema` zod schema. Failures throw `ZodError` whose message preserves zod's field paths.

## Output

```json
{
  "totalNotes": "number",
  "totalLinks": "number",
  "orphanCount": "number",
  "tagCount": "number",
  "clusterCount": "number",
  "skipped": "number      // always present, may be 0",
  "skippedPaths": "string[]  // up to 50 entries; truncated when skipped > 50"
}
```

Returned as `{ content: [{ type: 'text', text: JSON.stringify(envelope) }] }`.

## Error responses

- **`Unknown tool`**: MUST NOT occur (FR-003) — the dispatcher routes the call to the handler.
- **Vault path unset** (FR-009): `Error: Vault "<id>" does not have vaultPath configured (required for graph tools).`
- **Vault id unknown**: `Error: Vault "<id>" is not configured`
- **`ZodError`** for malformed input (e.g. `vaultId` is not a string).
- **`fs` errors during graph build**: filesystem-level errors during `findMarkdownFiles` propagate (Constitution Principle IV); per-file errors are absorbed into `skippedPaths` (FR-011).

## Acceptance scenarios mapped

- **US1 acceptance scenario 1**: this tool's response is the canonical "stats payload" referenced.
- **US2 acceptance scenario 1**: the `get_vault_stats` regression test (FR-006) passes on a clean checkout.
- **US2 acceptance scenario 2**: removing `case 'get_vault_stats':` from the dispatcher causes the regression test to fail with a message naming the missing dispatch branch.
- **SC-005**: a single call returns a complete payload with no retry needed.
