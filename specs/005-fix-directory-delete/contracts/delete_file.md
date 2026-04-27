# Contract: `delete_file` MCP Tool

This is the public-facing contract for the `delete_file` tool after this feature ships. It is the source of truth for the LLM-callable surface; both the tool registration in [src/tools/delete-file/tool.ts](../../../src/tools/delete-file/tool.ts) and the regression tests in [tests/tools/delete-file/](../../../tests/tools/delete-file/) are derived from it.

---

## Tool name

`delete_file`

## Tool description (advertised in MCP `tools/list`)

> Delete a file or directory from the vault. **When the path refers to a directory, the deletion is recursive: every contained file and subdirectory is removed before the directory itself is deleted, in a single tool call.** The caller does not need to empty the directory beforehand. On a transport-layer timeout the wrapper performs a verification listing query against the parent before reporting outcome, so the response always reflects the actual post-condition on the vault.

The exact wording is fixed by FR-011 + SC-006: an LLM consumer reading the catalogue must be able to determine from this description alone that directory deletes are recursive. The wording above also signals timeout-coherence — secondary, but useful context for a calling agent.

## Input schema (derived from `DeleteFileRequestSchema` via `zod-to-json-schema`)

```json
{
  "type": "object",
  "properties": {
    "filepath": {
      "type": "string",
      "description": "Path to the file or directory to delete (relative to vault root). Directories are deleted recursively.",
      "minLength": 1
    },
    "vaultId": {
      "type": "string",
      "description": "Optional vault ID (defaults to configured default vault)."
    }
  },
  "required": ["filepath"]
}
```

The published JSON Schema is the output of `zodToJsonSchema(DeleteFileRequestSchema)` and MUST match the runtime zod parser exactly (Constitution Principle III: single source of truth). Validation runs at the wrapper boundary before any upstream call.

## Successful response

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"ok\":true,\"deletedPath\":\"<input filepath, trimmed and trailing-slash normalised>\",\"filesRemoved\":<n>,\"subdirectoriesRemoved\":<m>}"
    }
  ]
}
```

Counts:

- Single-file delete: `filesRemoved = 0`, `subdirectoriesRemoved = 0`. The deleted file is named in `deletedPath` and is not double-counted.
- Empty-directory delete: `filesRemoved = 0`, `subdirectoriesRemoved = 0`. The deleted directory is named in `deletedPath`.
- Recursive directory delete: `filesRemoved` = count of files removed during the walk; `subdirectoriesRemoved` = count of subdirectories removed during the walk (every subdirectory, including intermediate levels). The outer directory is named in `deletedPath` and is not counted in `subdirectoriesRemoved`.

## Error responses

The dispatcher's existing `try/catch` translates any `Error` thrown by the handler into:

```json
{
  "content": [{ "type": "text", "text": "Error: <message>" }],
  "isError": true
}
```

The handler emits five distinct error categories:

### 1. Validation failure (zod)

```text
Error: Invalid input — filepath: filepath is required
```

Triggered when `filepath` is missing, empty after trim, or not a string. No upstream call is made.

### 2. Not found

```text
Error: not found: <filepath>
```

Triggered when the parent listing does not contain the target (neither as a file nor as a directory) OR the upstream returns 404. **Never** a transport-timeout error in this case (FR-007, SC-003).

### 3. Partial failure during recursive walk

```text
Error: child failed: <failedPath> — already deleted: [<path1>, <path2>, ...]
```

Triggered when a per-item delete inside the recursive walk fails (any non-success outcome). The `<failedPath>` names the offending child; the bracketed list contains every full vault-relative path successfully deleted during the walk before the abort, files and intermediate subdirectories alike, in upstream-listing order. The outer directory is NOT deleted (FR-003); items deleted before the failure remain deleted (no rollback).

### 4. Outcome undetermined

```text
Error: outcome undetermined for <targetPath>
```

Triggered when the upstream call timed out AND the verification listing query also failed (timeout OR non-timeout upstream error such as 5xx OR connection reset). Single-shot — no retry (FR-009, Q3 clarification).

### 5. Other upstream error (passthrough)

```text
Error: Obsidian API Error <code>: <message>
```

Any non-timeout, non-404 upstream failure. Behavioural compatibility with every other tool's error format — exactly the text the existing `safeCall` produces today. The handler does NOT attempt verification on these errors (verification only applies on `ObsidianTimeoutError`, per FR-004).

---

## Behavioural contract (mapped to functional requirements)

| FR | Behaviour visible at the contract surface |
|----|-------------------------------------------|
| FR-001 | Directory paths trigger recursive walk; success response carries counts. |
| FR-002 | No "directory not empty" error for non-empty directories — the wrapper empties them. |
| FR-003 | Partial-failure error message format includes both offender and full deleted-paths list. |
| FR-004 | Every transport timeout produces exactly one verification listing query before status is reported. |
| FR-005 | Transport-timeout from upstream where the vault post-condition matches success → `ok: true` response; never the raw timeout error. |
| FR-006 | Transport-timeout from upstream where the directory is still present → error response; never `ok: true`. |
| FR-007 | Missing path → "not found" error; never the raw timeout error. |
| FR-008 | Per-item deletes inside the walk apply the same timeout-then-verify behaviour as the outer call. |
| FR-009 | Verification query failure (any kind) → "outcome undetermined" error; no retry. |
| FR-010 | `foo/` and `foo` are treated as the same directory target. |
| FR-011 | Tool description text above advertises the recursive contract. |
| FR-012 | Test [tests/tools/delete-file/recursive.test.ts](../../../tests/tools/delete-file/recursive.test.ts) asserts iteration order, per-item deletes, final delete, consolidated counts. |
| FR-013 | Test [tests/tools/delete-file/timeout-verify.test.ts](../../../tests/tools/delete-file/timeout-verify.test.ts) asserts timeout-with-actual-success ⇒ `ok: true`. |
| FR-014 | Recursive walk visits children in the order returned by the upstream listing endpoint. |

---

## Non-contract (deliberately out of scope)

The following are NOT part of this contract and callers MUST NOT depend on them:

- **Wall-clock duration**: a recursive walk of a large directory may exceed 10 seconds in total. Each individual upstream call is bounded by the wrapper's existing transport timeout, but the walk's total wall-clock time is unbounded.
- **Concurrency safety**: if the vault is being modified by other writers during the walk, the contract above describes the expected handling for additions (item appears in parent listing but not in the target's listing — the walk's internal listing is the snapshot in use); concurrent deletions of items the walk is about to delete are NOT explicitly handled and may surface as unexpected per-item 404s — the implementation chooses to treat per-item 404 during the walk as an item-level partial failure (it appeared in the listing the walk was driving from, then disappeared), surfaced via category 3 above. This is acceptable best-effort behaviour for a vault MCP wrapper.
- **Retry of the original DELETE call**: never. The verification re-query is a *listing* query, not a re-attempt of the delete.
- **Order of the deleted-paths list across upstream changes**: the order is whatever the upstream returns at the time of listing. Tests pin the order via the `nock`-mocked listing fixture.
