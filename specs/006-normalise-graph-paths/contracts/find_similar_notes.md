# Contract: `find_similar_notes`

**Feature**: [../spec.md](../spec.md)
**Plan**: [../plan.md](../plan.md)
**Date**: 2026-04-27

This contract documents the input and output of the `find_similar_notes` MCP tool after this feature wires the dispatcher case AND applies forward-slash normalisation at the wrapper boundary.

**Status note**: prior to this feature, calling `find_similar_notes` returned `Unknown tool: find_similar_notes` because the dispatcher in [src/index.ts](../../../src/index.ts) had no `case` for it — the tool was registered in `ALL_TOOLS` but unreachable. See [research.md R5](../research.md#r5--dispatcher-gap-for-find_similar_notes). This contract reflects the post-fix behaviour: the tool is now callable and applies the wrapper's canonical (forward-slash) input form regardless of what the caller sends.

---

## Input

The tool's `inputSchema` is derived from the **new** `FindSimilarNotesRequestSchema` ([data-model.md FindSimilarNotesRequest](../data-model.md#findsimilarnotesrequest-zod--srctoolssemantic-toolsts)) via `zod-to-json-schema`. This **replaces** the hand-written JSON schema previously declared in [src/tools/semantic-tools.ts:50-74](../../../src/tools/semantic-tools.ts#L50-L74), bringing the tool into compliance with Constitution Principle III.

| Field | Type | Required | Description |
|---|---|---|---|
| `filepath` | string (min length 1) | yes | Path to the source note, relative to the vault root. **Separator-tolerant**: forward-slash, backslash, and mixed forms all resolve to the same upstream call. The wrapper normalises to forward-slash (Obsidian's canonical form) before dispatching. |
| `limit` | integer (positive) | no | Maximum similar notes to return. Default: 10. |
| `threshold` | number in [0, 1] | no | Similarity threshold. Default: 0.5. |
| `vaultId` | string | no | Optional vault ID; defaults to `config.defaultVaultId`. |

**Behaviour change from the fix**:

- The dispatcher case is added — the tool no longer returns `Unknown tool: find_similar_notes`.
- `filepath` is normalised to forward-slash via `toForwardSlashPath` before being included in the POST body to `/search/similar`. (The graph-tool fix uses OS-native because the index is OS-native; this tool is an HTTP passthrough so it uses Obsidian's canonical surface form instead.)
- `limit` and `threshold` are validated via zod (the pre-fix hand-written JSON schema did not constrain `threshold` to `[0, 1]`).

---

## Output

### Success

The shape is the existing `SemanticResult[]` returned by `SmartConnectionsService.findSimilar`:

```json
{
  "content": [
    {
      "type": "text",
      "text": "[\n  {\"path\": \"000-Meta/Other Note.md\", \"score\": 0.87, ...},\n  ...\n]"
    }
  ]
}
```

Path strings inside the response are returned as Smart Connections produces them (forward-slash; matches Obsidian's internal form). Unchanged by this feature.

### Error: input fails zod validation

```text
Error: filepath: filepath must be a non-empty string
Error: threshold: Number must be less than or equal to 1
Error: limit: Number must be greater than 0
```

Field paths identify the offending field.

### Error: vault not configured for Smart Connections

```text
Error: Smart Connections not configured for vault "<id>". Set smartConnectionsPort.
```

Existing error from `SmartConnectionsService.findSimilar` ([smart-connections.ts:127](../../../src/services/smart-connections.ts#L127)). Surfaced verbatim.

### Error: upstream 404 (similar endpoint not available)

```text
Error: Similar notes endpoint not available. Use semantic_search with note content instead.
```

Existing fallback message from [smart-connections.ts:142](../../../src/services/smart-connections.ts#L142). Unchanged.

### Error: other upstream failure

```text
Error: Smart Connections error: <axios error message>
```

Existing pass-through ([smart-connections.ts:144](../../../src/services/smart-connections.ts#L144)). Unchanged.

### Error: previously: `Unknown tool: find_similar_notes`

**No longer reachable after this feature.** This was the pre-fix error from the dispatcher's `default:` branch and is what made the bug irreproducible — the tool returned `Unknown tool` before any path-separator handling could matter.

---

## Acceptance criteria coverage

| Spec FR / Story | Where verified |
|---|---|
| FR-003 (forward-slash accepted) | Story 3 acceptance scenario 1 + `tests/tools/semantic-tools/find-similar-handler.test.ts` (uses `nock` to assert the POST body's `path` is forward-slash regardless of input form) |
| FR-004 (backslash regression-safe) | Story 3 acceptance scenario 2 + same test |
| FR-005 (mixed separators) | Test case |
| FR-007 (input contract forward-slash-friendly) | Documented in this contract; reflected in `inputSchema` description |
| Dispatcher gap | New `tests/tools/semantic-tools/find-similar-handler.test.ts` exercises the dispatch path end-to-end (the tool no longer returns `Unknown tool`) |

---

## Out of scope / not changed by this contract

- `semantic_search` — the sibling tool with the same dispatcher gap. Different bug, different scope; not covered here.
- The Smart Connections HTTP endpoint payload format — this feature only changes what the wrapper sends, not what Smart Connections returns.
- The `note not found` semantics — `find_similar_notes` does not produce a `note not found:` error today (it surfaces upstream 404s as a different message). FR-006 applies to the two index-backed tools; for this tool, the equivalent contract is "the wrapper does not gate the call on a wrapper-side existence check" — confirmed by the implementation, which simply forwards the (normalised) path to Smart Connections.
