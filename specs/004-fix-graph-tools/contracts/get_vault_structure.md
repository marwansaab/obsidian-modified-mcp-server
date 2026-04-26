# Contract: `get_vault_structure`

**Tool name**: `get_vault_structure`
**Backed by**: `GraphService.getVaultStructure(maxDepth, includeFiles)` ([src/services/graph-service.ts:390](../../../src/services/graph-service.ts#L390))
**Spec source**: FR-003, FR-004, FR-008, FR-009, FR-011, FR-013

## Precondition

`OBSIDIAN_VAULT_PATH` must be set for the targeted vault. Stated in the tool description (FR-008).

## Input

```json
{
  "maxDepth": "number?  // non-negative integer; default unlimited",
  "includeFiles": "boolean?  // default false (folders only)",
  "vaultId": "string?  // optional"
}
```

Validated by `assertValidGetVaultStructureRequest(args)` (zod).

## Output

```json
{
  "tree": {
    "FolderA/": { "Subfolder/": {}, "note.md": null },
    "FolderB/": { ... }
  },
  "skipped": "number",
  "skippedPaths": "string[]  // up to 50 entries"
}
```

Folders are object keys ending in `/`; files (when `includeFiles: true`) are keys with `null` values. Nested objects represent subfolders. Per [research.md R9](../research.md#r9--get_vault_structure-response-shape).

## Error responses

- **`Unknown tool`**: MUST NOT occur.
- **Vault path unset**: `Error: Vault "<id>" does not have vaultPath configured (required for graph tools).`
- **`ZodError`** for malformed input (e.g. negative `maxDepth`).

## Smoke-test row (FR-013)

```ts
{ name: 'get_vault_structure', args: {} }  // minimal valid; uses defaults
```

Smoke assertion: `result.content[0].text` does not match `/Unknown tool/`.
