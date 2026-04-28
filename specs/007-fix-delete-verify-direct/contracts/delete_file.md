# Contract: `delete_file` MCP Tool (post-spec-007)

This is the **superseding** public-facing contract for the `delete_file` tool after spec 007 ships. It replaces [specs/005-fix-directory-delete/contracts/delete_file.md](../../005-fix-directory-delete/contracts/delete_file.md) as the live source of truth. The successful response shape is byte-equivalent to spec 005 (preserved per spec 007 FR-006); the error category list grows by one (the new "delete did not take effect" category) and the verification-query mechanism wording is updated to reflect the direct-path approach.

---

## Tool name

`delete_file`

## Tool description (advertised in MCP `tools/list`)

> Delete a file or directory from the vault. **When the path refers to a directory, the deletion is recursive: every contained file and subdirectory is removed before the directory itself is deleted, in a single tool call.** The caller does not need to empty the directory beforehand. On a transport-layer timeout the wrapper performs a single direct-path verification query before reporting outcome, so the response always reflects the actual post-condition on the vault.

The recursive-contract sentence is fixed by spec 005 FR-011 + SC-006. The verification sentence is updated from spec 005's "verification listing query against the parent" to "single direct-path verification query" — the only contract-text change in spec 007. The mechanism is exposed at this granularity so an LLM consumer can reason about why a `delete did not take effect` response is meaningful (the wrapper actually checked) without having to know the underlying HTTP method.

## Input schema (derived from `DeleteFileRequestSchema` via `zod-to-json-schema`)

Unchanged from spec 005:

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

## Successful response

Unchanged from spec 005 (preserved byte-for-byte per spec 007 FR-006):

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

Counts behave identically to spec 005. **New under spec 007**: the success response is also returned when the upstream delete timed out at the transport layer AND the direct-path verification returned 404 (positive evidence of `'absent'`) — including the headline parent-auto-prune scenario the bug report identified.

## Error responses

The dispatcher's existing `try/catch` translates any `Error` thrown by the handler into:

```json
{
  "content": [{ "type": "text", "text": "Error: <message>" }],
  "isError": true
}
```

The handler emits **six distinct error categories** (one new since spec 005):

### 1. Validation failure (zod)

```text
Error: Invalid input — filepath: filepath is required
```

Triggered when `filepath` is missing, empty after trim, or not a string. No upstream call is made. Unchanged from spec 005.

### 2. Not found

```text
Error: not found: <filepath>
```

Triggered when the parent listing does not contain the target (neither as a file nor as a directory). Unchanged from spec 005. (The handler's type-detection step still uses parent listing — only the post-timeout *verification* switches to direct-path. Type-detection runs before any delete attempt and is not on the timeout path.)

### 3. Partial failure during recursive walk

```text
Error: child failed: <failedPath> — already deleted: [<path1>, <path2>, ...]
```

Triggered when a per-item delete inside the recursive walk fails — either by an immediate non-timeout upstream error, or by a verified-still-present outcome at the per-item level (the per-item DELETE timed out and the direct-path verification returned 200). The outer directory is NOT deleted; items deleted before the failure remain deleted (no rollback). Unchanged in shape from spec 005.

### 4. Delete did not take effect *(NEW under spec 007)*

```text
Error: delete did not take effect: <targetPath> (filesRemoved=<n>, subdirectoriesRemoved=<m>)
```

Triggered when the *outer* delete (or the single-file delete) times out at the transport layer AND the direct-path verification returns successfully (200 — target still present). Distinct from category 3 because no *child* failed: the recursive walk completed successfully, the children were removed, but the outer delete itself didn't take effect on the vault.

`<n>` and `<m>` are the same `filesRemoved` / `subdirectoriesRemoved` counts that the success response would have carried. For a single-file delete both are `0`. For a recursive directory delete they reflect the children that were successfully removed during the walk before the outer delete failed.

### 5. Outcome undetermined

```text
Error: outcome undetermined for <targetPath>
```

Triggered when the upstream call timed out AND the direct-path verification query also failed for a transport reason that does not yield a deterministic 404-vs-success signal — its own transport timeout, a connection reset, or a non-404 error response (e.g., 5xx). Single-shot — no retry. The 404 case is now positive evidence of success (category 0 / success response) and the non-404 success case is positive evidence of failure (category 4 above), so this category narrows under spec 007 vs. spec 005's parent-listing-based shape.

### 6. Other upstream error (passthrough)

```text
Error: Obsidian API Error <code>: <message>
```

Any non-timeout, non-404 upstream failure during the delete itself. Behavioural compatibility with every other tool's error format. The handler does NOT attempt verification on these errors (verification only fires on `ObsidianTimeoutError`, per spec 005 FR-004). Unchanged from spec 005.

---

## Behavioural contract (mapped to functional requirements)

### Spec 005 requirements (still in force)

| FR | Behaviour visible at the contract surface |
|----|-------------------------------------------|
| 005 FR-001 | Directory paths trigger recursive walk; success response carries counts. |
| 005 FR-002 | No "directory not empty" error for non-empty directories — the wrapper empties them. |
| 005 FR-003 | Partial-failure error message format includes both offender and full deleted-paths list (mid-walk only). |
| 005 FR-004 | Every transport timeout produces exactly one verification query before status is reported. |
| 005 FR-005 | Transport-timeout from upstream where the vault post-condition matches success → `ok: true` response; never the raw timeout error. |
| 005 FR-006 | Transport-timeout from upstream where the target is still present → error response; never `ok: true`. |
| 005 FR-007 | Missing path → "not found" error; never the raw timeout error. |
| 005 FR-008 | Per-item deletes inside the walk apply the same timeout-then-verify behaviour as the outer call. |
| 005 FR-009 | Verification query failure (timeout / 5xx / connection reset) → "outcome undetermined" error; no retry. |
| 005 FR-010 | `foo/` and `foo` are treated as the same directory target. |
| 005 FR-011 | Tool description text above advertises the recursive contract. |
| 005 FR-014 | Recursive walk visits children in the order returned by the upstream listing endpoint. |

### Spec 007 requirements (new behaviour)

| FR | Behaviour visible at the contract surface |
|----|-------------------------------------------|
| 007 FR-001 | The verification query for any timeout-then-verify decision targets the deleted path *directly*, not its parent's listing. |
| 007 FR-002 | A 404 on the direct-path verification produces the success response (category 0 above). |
| 007 FR-003 | A 200 on the direct-path verification produces the new `delete did not take effect: <path> (filesRemoved=<n>, subdirectoriesRemoved=<m>)` error (category 4 above). |
| 007 FR-004 | A non-deterministic verification failure (its own timeout, connection reset, non-404 5xx) produces the unchanged `outcome undetermined` error (category 5 above). |
| 007 FR-005 | The direct-path verification applies symmetrically to outer directory deletes, single-file deletes, and per-item deletes during the recursive walk. |
| 007 FR-006 | The success response shape is byte-equivalent to spec 005's. |
| 007 FR-007 / FR-008 / FR-009 / FR-010 / FR-011 | Each FR pins a regression test; see [tests/tools/delete-file/](../../../tests/tools/delete-file/). |

### Spec 005 requirements **superseded** by spec 007

| Spec 005 FR | Status under spec 007 |
|---|---|
| 005 FR-012 | Test [tests/tools/delete-file/recursive.test.ts](../../../tests/tools/delete-file/recursive.test.ts) still exists and asserts iteration order, per-item deletes, final delete, consolidated counts. Updated to use direct-path verification mocks. |
| 005 FR-013 | Test [tests/tools/delete-file/timeout-verify.test.ts](../../../tests/tools/delete-file/timeout-verify.test.ts) still exists and asserts timeout-with-actual-success ⇒ `ok: true`. Updated to use direct-path verification mocks. |

---

## Non-contract (deliberately out of scope)

Spec 005's "Non-contract" section is inherited unchanged:

- **Wall-clock duration**: a recursive walk of a large directory may exceed 10 seconds in total. Each individual upstream call (including the direct-path verification probes) is bounded by the wrapper's existing transport timeout; the walk's total wall-clock time is unbounded.
- **Concurrency safety**: spec 005's concurrent-delete handling is preserved. **New under spec 007**: if a concurrent writer recreates a deleted path between the upstream's actual deletion and the wrapper's direct-path verification, the verification will return 200 (path now exists again) and the wrapper will report category 4 ("delete did not take effect") even though the original delete actually succeeded. This is acceptable: callers cannot distinguish "we deleted it then someone recreated it" from "we never deleted it" without a write-time tombstone, which is out of scope. The wrapper reports what is currently true on the vault.
- **Retry of the original DELETE call**: never. The verification query is a *direct-path probe*, not a re-attempt of the delete.
- **Order of the deleted-paths list across upstream changes**: the order is whatever the upstream returns at the time of listing. Tests pin the order via the `nock`-mocked listing fixture.
