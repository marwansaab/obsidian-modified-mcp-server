# Contract: `get_note_connections`

**Feature**: [../spec.md](../spec.md)
**Plan**: [../plan.md](../plan.md)
**Date**: 2026-04-27

This contract documents the input and output of the `get_note_connections` MCP tool after the path-separator normalisation fix. Pre-existing fields and shapes are unchanged unless explicitly noted.

---

## Input

The tool's `inputSchema` is derived from `GetNoteConnectionsRequestSchema` ([src/tools/graph/schemas.ts:47](../../../src/tools/graph/schemas.ts#L47)) via `zod-to-json-schema`. **Schema unchanged** — the normalisation behaviour is a runtime property of the handler, not a schema property.

| Field | Type | Required | Description |
|---|---|---|---|
| `filepath` | string (min length 1) | yes | Path to the note, relative to the vault root. **Separator-tolerant**: forward-slash, backslash, and mixed forms all resolve to the same indexed entry on every platform (Windows, macOS, Linux). |
| `depth` | integer (positive) | no | Reserved — currently unused by the service implementation but accepted in the schema. |
| `vaultId` | string | no | Optional vault ID; defaults to `config.defaultVaultId`. |

**Behaviour change from the fix**: a `filepath` with `/` separators is no longer rejected with `note not found:` on Windows for nested files. The handler normalises to OS-native via `toOsNativePath` before calling `GraphService.getNoteConnections`. Backslash and mixed-separator inputs continue to work exactly as before.

**Examples** (Windows host):

| Input `filepath` | Resolves to graph node ID |
|---|---|
| `000-Meta/Vault Identity.md` | `000-Meta\Vault Identity.md` (post-fix; previously failed with `note not found:`) |
| `000-Meta\Vault Identity.md` | `000-Meta\Vault Identity.md` (unchanged from pre-fix) |
| `000-Meta\subdir/file.md` | `000-Meta\subdir\file.md` (mixed separators, post-fix) |
| `README.md` | `README.md` (top-level file, unchanged) |
| `does-not-exist.md` | (no match — surfaces `note not found: does-not-exist.md`) |

---

## Output

### Success

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"filepath\": \"000-Meta\\\\Vault Identity.md\",\n  \"outgoingLinks\": [...],\n  \"backlinks\": [...],\n  \"tags\": [...]\n}"
    }
  ]
}
```

The `filepath` field of the returned `NoteConnections` payload is the **resolved graph node ID** (OS-native form on Windows). This is unchanged from pre-fix behaviour for backslash callers and matches the existing `graph-service.ts` contract. A future improvement could echo the caller's input form here, but doing so requires changes to `GraphService` and is out of scope for this feature.

| Response field | Type | Description |
|---|---|---|
| `filepath` | string | Resolved graph node ID. OS-native separators on Windows. |
| `outgoingLinks` | string[] | Graph node IDs the source note links to. OS-native. |
| `backlinks` | string[] | Graph node IDs that link to the source note. OS-native. |
| `tags` | string[] | Tags extracted from the source note. |

### Error: input fails zod validation

Returned as MCP error content:

```text
Error: <zod path>: <reason>
e.g., Error: filepath: filepath must be a non-empty string
```

Unchanged from pre-fix.

### Error: file not present after normalisation

```text
Error: note not found: <normalised-form-path>
```

If the caller supplied an explicit `vaultId`, the existing decorator appends ` (vault: <id>)` ([handlers.ts:49](../../../src/tools/graph/handlers.ts#L49)).

The path in the error message is the **post-normalisation form** (per [research.md R4](../research.md#r4--error-message-form-when-the-lookup-misses)). On Windows, callers who passed forward-slash will see the backslash form in the error. The path is still recognisable as the same logical file. No FR mandates form-preservation in error messages.

### Error: graph service / filesystem failure

Existing pass-through behaviour: errors raised during `buildGraph()` (filesystem read failures, OBSIDIAN_VAULT_PATH not configured, etc.) propagate as structured MCP errors. Unchanged.

---

## Acceptance criteria coverage

| Spec FR / Story | Where verified |
|---|---|
| FR-001 (forward-slash accepted) | Story 1 acceptance scenario 1 + extended test in `tests/tools/graph/handler-per-note.test.ts` |
| FR-004 (backslash regression-safe) | Story 1 acceptance scenario 2 + existing test cases preserved |
| FR-005 (mixed separators) | Spec edge case + test case in `tests/tools/graph/handler-per-note.test.ts` |
| FR-006 (genuine miss → clear error) | Story 1 acceptance scenario 3 + test case |
| FR-007 (input contract forward-slash-friendly) | Documented in this contract; reflected in `inputSchema` description |
| FR-008 (regression test) | `tests/tools/graph/handler-per-note.test.ts` covers both separator forms |
