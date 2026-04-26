# Contract: `find_path_between_notes`

**Tool name**: `find_path_between_notes`
**Backed by**: `GraphService.findPathBetweenNotes(source, target, maxDepth)` ([src/services/graph-service.ts:313](../../../src/services/graph-service.ts#L313))
**Spec source**: FR-003, FR-004, FR-008, FR-009, FR-012, FR-013

## Precondition

`OBSIDIAN_VAULT_PATH` must be set for the targeted vault.

## Input

```json
{
  "source": "string  // REQUIRED",
  "target": "string  // REQUIRED",
  "maxDepth": "number?  // default 5",
  "vaultId": "string?"
}
```

Validated by `assertValidFindPathBetweenNotesRequest(args)`. `source` and `target` MUST be non-empty strings.

## Output

No envelope (per-note tool, FR-011 carve-out):

```json
{
  "path": ["source.md", "intermediate.md", "target.md"]
  // OR null when both notes exist but no walk connects them within maxDepth
}
```

`null` is the "no path" indicator — distinct from any error case.

## Error responses (FR-012)

- **`Unknown tool`**: MUST NOT occur.
- **One endpoint missing**: `Error: note not found: <missing-path>`
- **Both endpoints missing**: `Error: notes not found: <source>, <target>`
- **With explicit `vaultId`**: ` (vault: <id>)` is appended to the message.
- **Vault path unset**: standard precondition error.
- **`ZodError`** for malformed input.

## Smoke-test row (FR-013)

```ts
{ name: 'find_path_between_notes', args: { source: 'a.md', target: 'b.md' } }
```

Expected to fail with `notes not found: a.md, b.md` (or `note not found: a.md` if only one is missing — depends on what the smoke vault contains). The failure proves dispatch occurred. Happy-path coverage (including the "no path found" `{ path: null }` success case) lives in `tests/tools/graph/handler-per-note.test.ts` (Constitution Principle II, remediation C1).
