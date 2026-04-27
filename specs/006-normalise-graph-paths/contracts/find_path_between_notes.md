# Contract: `find_path_between_notes`

**Feature**: [../spec.md](../spec.md)
**Plan**: [../plan.md](../plan.md)
**Date**: 2026-04-27

This contract documents the input and output of the `find_path_between_notes` MCP tool after the path-separator normalisation fix. Pre-existing fields and shapes are unchanged unless explicitly noted.

---

## Input

The tool's `inputSchema` is derived from `FindPathBetweenNotesRequestSchema` ([src/tools/graph/schemas.ts:64](../../../src/tools/graph/schemas.ts#L64)). **Schema unchanged** — the normalisation behaviour is a runtime property of the handler, not a schema property.

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | string (min length 1) | yes | Source note path, relative to the vault root. **Separator-tolerant**: forward-slash, backslash, and mixed forms all resolve to the same indexed entry. |
| `target` | string (min length 1) | yes | Target note path, relative to the vault root. **Separator-tolerant**, same treatment as `source`. |
| `maxDepth` | integer (positive) | no | Maximum path length to search. Default: 5. |
| `vaultId` | string | no | Optional vault ID; defaults to `config.defaultVaultId`. |

**Behaviour change from the fix**: both `source` and `target` are normalised to OS-native via `toOsNativePath` at the handler boundary before delegating to `GraphService.findPathBetweenNotes`. Either argument can be in any separator form independently — the handler does not require both arguments to use the same form.

---

## Output

### Success — path found

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"path\": [\"000-Meta\\\\A.md\", \"010-Notes\\\\Bridge.md\", \"010-Notes\\\\B.md\"]\n}"
    }
  ]
}
```

The `path` array contains graph node IDs in OS-native form on Windows (the same form as the index keys). The first element matches the resolved `source`; the last element matches the resolved `target`. Same form-handling rationale as `get_note_connections` (see [contracts/get_note_connections.md](get_note_connections.md)).

### Success — no path

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"path\": null\n}"
    }
  ]
}
```

Both notes exist and are reachable in the graph but no link path of length ≤ `maxDepth + 1` connects them.

### Error: input fails zod validation

Unchanged from pre-fix. Field path identifies which argument failed.

### Error: source or target missing after normalisation

```text
# Source missing only
Error: note not found: <normalised-source>

# Target missing only
Error: note not found: <normalised-target>

# Both missing
Error: notes not found: <normalised-source>, <normalised-target>
```

If the caller supplied an explicit `vaultId`, ` (vault: <id>)` is appended.

The error path uses the post-normalisation form for the same reason as `get_note_connections` ([research.md R4](../research.md#r4--error-message-form-when-the-lookup-misses)). FR-002 explicitly forbids "note not found" from firing when **both** files exist — the fix ensures forward-slash inputs no longer trigger this error spuriously.

---

## Acceptance criteria coverage

| Spec FR / Story | Where verified |
|---|---|
| FR-002 (forward-slash accepted on both args; never `note not found:` when both exist) | Story 2 acceptance scenarios 1 & 2 + extended test in `tests/tools/graph/handler-per-note.test.ts` |
| FR-004 (backslash regression-safe) | Existing tests preserved |
| FR-005 (mixed separators) | Test case |
| FR-006 (genuine miss → clear error identifying the missing arg) | Story 2 acceptance scenario 3 + test case |
| FR-007 (input contract forward-slash-friendly) | Documented in this contract |
