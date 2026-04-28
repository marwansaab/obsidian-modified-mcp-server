# Data Model: Direct-Path Delete Verification

This is a **delta** document. Spec 005's full data model lives in [specs/005-fix-directory-delete/data-model.md](../005-fix-directory-delete/data-model.md). This file enumerates only what spec 007 changes.

---

## Unchanged from spec 005

The following entities are inherited unchanged:

- **`DeleteFileRequest`** (zod input schema): `{ filepath: string; vaultId?: string }`.
- **`DeleteFileSuccess`** (success payload): `{ ok: true; deletedPath: string; filesRemoved: number; subdirectoriesRemoved: number }`. Preserved byte-for-byte per spec 007 FR-006 / SC-004.
- **`PartialDeleteError`** (mid-walk failure): unchanged. Still carries `failedPath` + flat `deletedPaths` list. Still produced when a per-item delete inside the recursive walk fails (either an immediate non-timeout error from `safeCall`, or a verified-still-present outcome at the per-item level).
- **`OutcomeUndeterminedError`** (verification call itself failed): unchanged in shape. The trigger condition narrows under spec 007 (see below).
- **`WalkState`** (internal threading struct): unchanged.
- **`ObsidianTimeoutError` / `ObsidianNotFoundError` / `ObsidianApiError`**: unchanged.

## Removed by spec 007

- **`listingHasName(rest, parentDir, name)`** in `src/tools/delete-file/recursive-delete.ts`: deleted. Its only consumers were the three verify callbacks now switched over to `pathExists` (spec 007 FR-001). Leaving the helper in place would invite accidental future re-introduction of the parent-listing approach this fix exists to replace.

## Added by spec 007

### `pathExists(rest, path, kind): Promise<'absent' | 'present'>`

A direct-path probe helper located in `src/tools/delete-file/verify-then-report.ts`. Given a path and its kind, queries the upstream's path-specific endpoint and returns:

- `'absent'` if the upstream throws `ObsidianNotFoundError` (404 — positive evidence of successful deletion)
- `'present'` if the upstream returns successfully (positive evidence the delete did not take effect)

For any other thrown error (timeout, connection reset, 5xx), the helper rethrows. Callers wrap the call in a `try/catch` and convert any rethrown error to `OutcomeUndeterminedError` per spec 005 FR-009.

The probe endpoint is determined by `kind`:

- `kind === 'directory'` → `rest.listFilesInDir(path)` (`GET /vault/{path}/`)
- `kind === 'file'` → `rest.getFileContents(path)` (`GET /vault/{path}` with `Accept: text/markdown`)

The kind is always known to the caller (the handler determines it during type-detection at the top of the request; the recursive walk knows it from the trailing-slash check on each listing entry), so the helper requires it as an explicit parameter rather than probing.

### `DeleteDidNotTakeEffectError`

A new error class in `src/tools/delete-file/verify-then-report.ts`:

```typescript
export class DeleteDidNotTakeEffectError extends Error {
  constructor(
    public readonly targetPath: string,
    public readonly filesRemoved: number,
    public readonly subdirectoriesRemoved: number
  ) {
    super(
      `delete did not take effect: ${targetPath} ` +
        `(filesRemoved=${filesRemoved}, subdirectoriesRemoved=${subdirectoriesRemoved})`
    );
    this.name = 'DeleteDidNotTakeEffectError';
  }
}
```

**Fields**:

| Field | Type | Meaning |
|-------|------|---------|
| `targetPath` | `string` | The path the caller asked to delete (after trailing-slash normalisation). |
| `filesRemoved` | `number` | Number of files successfully deleted during the recursive walk before the outer delete was attempted. `0` for the single-file case. |
| `subdirectoriesRemoved` | `number` | Number of subdirectories successfully deleted during the recursive walk. `0` for the single-file case and for empty-directory deletes. |

**Trigger conditions**:

- Outer-directory delete: the recursive walk completed successfully, the upstream's outer DELETE call timed out at the transport layer, and the direct-path verification returned `'present'`.
- Single-file delete: the upstream's DELETE call timed out at the transport layer, and the direct-path verification returned `'present'`.

**Why mirror the success-response shape**: per spec 007 Clarification 1, callers need to reason about partial vault state — which children were already removed before the outer delete failed — without having to re-list the directory. Mirroring the success counts gives callers actionable info inline.

## Changed semantics (no class change)

### `OutcomeUndeterminedError` trigger condition

The error class itself is unchanged, but its trigger condition narrows under spec 007:

- **Spec 005**: any failure of the parent-listing verification query (timeout, 5xx, 404, connection reset) → `outcome undetermined`. Notably, a 404 on the parent listing was treated as undetermined because it was indistinguishable from "parent gone, target gone" vs. "verification call failed".
- **Spec 007**: only failures of the direct-path verification query that do not yield a deterministic 404-vs-success signal (timeout, 5xx, connection reset) → `outcome undetermined`. A 404 on the direct-path verification is now positive evidence of `'absent'` and produces a success response, NOT undetermined. A non-404 success is positive evidence of `'present'` and produces `DeleteDidNotTakeEffectError`, NOT undetermined.

### Handler error translation table (catch block in `handler.ts`)

| Caught error class | Outgoing `Error` message (from handler) | Spec 007 contract category |
|---|---|---|
| `z.ZodError` | `Invalid input — <field>: <message>` | 1 |
| `ObsidianNotFoundError` (in type-detection) | `not found: <target>` | 2 |
| `PartialDeleteError` (mid-walk) | `child failed: <path> — already deleted: [...]` | 3 |
| `DeleteDidNotTakeEffectError` (NEW) | `delete did not take effect: <path> (filesRemoved=<n>, subdirectoriesRemoved=<m>)` | 4 (NEW) |
| `OutcomeUndeterminedError` | `outcome undetermined for <target>` | 5 |
| anything else | rethrown unchanged | 6 (passthrough) |

The numbering shifts versus spec 005's contract: spec 005 had "Outcome undetermined" as category 4 and "Other upstream error (passthrough)" as category 5. Spec 007 inserts a new category 4 ("Delete did not take effect") and shifts the latter two down by one. See [contracts/delete_file.md](contracts/delete_file.md) for the full updated category list.
