# Data Model: Fix Directory Delete

This feature introduces no persistent data — Obsidian vault state is the system of record and is mutated only via the existing `/vault/...` REST endpoints. The "data model" here is therefore the set of in-process types that flow between the dispatcher, the new handler, the recursive-walk helper, the verify-then-report utility, and the MCP response. Each entity below has a name, a shape, the validation rules that apply at its boundary, and the spec requirement(s) it satisfies.

---

## DeleteFileRequest *(zod schema, validated at the wrapper boundary)*

The validated input shape for the `delete_file` tool. Lives in [src/tools/delete-file/schema.ts](../../src/tools/delete-file/schema.ts).

```ts
export const DeleteFileRequestSchema = z.object({
  filepath: z.string().trim().min(1, 'filepath is required'),
  vaultId: z.string().trim().optional(),
});
export type DeleteFileRequest = z.infer<typeof DeleteFileRequestSchema>;
```

**Rules**:

- `filepath` MUST be a non-empty string after trimming. Trimming protects against accidental leading/trailing whitespace from JSON deserialization. Validation failures throw a structured zod error reported with the field path (`filepath`) — Constitution Principle III.
- `vaultId` is optional; the dispatcher resolves it via the existing `resolveVaultId` helper.
- The schema does NOT validate path syntax beyond non-emptiness. Vault path normalisation (e.g., trailing-slash equivalence per FR-010) is the handler's job, not the validator's — the validator's role is "shape," not "semantics."

**Spec coverage**: FR-010 (trailing-slash normalisation is implemented in the handler, not here, but the schema lays the groundwork by trimming).

---

## DeleteFileSuccess *(handler return value, serialized to MCP text content)*

The success response payload. Lives in [src/tools/delete-file/handler.ts](../../src/tools/delete-file/handler.ts).

```ts
export interface DeleteFileSuccess {
  ok: true;
  deletedPath: string;        // The vault-relative path that was deleted (the input, after trailing-slash normalisation)
  filesRemoved: number;       // Count of file deletions performed during the recursive walk
  subdirectoriesRemoved: number; // Count of subdirectory deletions performed during the recursive walk (every subdir, including intermediate ones)
}
```

**Rules**:

- For a single-file delete: `filesRemoved = 0` and `subdirectoriesRemoved = 0`. The deleted path is the file itself (the file deletion does NOT count toward `filesRemoved` — that count is restricted to *contained* files removed during the walk; the deleted path is named in `deletedPath` so it isn't double-counted).
- For an empty-directory delete: `filesRemoved = 0` and `subdirectoriesRemoved = 0`. The deleted path is the directory itself (similarly not double-counted).
- For a recursive directory delete: `filesRemoved` counts every contained file deleted; `subdirectoriesRemoved` counts every contained subdirectory deleted (including intermediate ones).

**Wire form** (the MCP `CallToolResult.content[0].text`): the JSON-stringified `DeleteFileSuccess` object. The dispatcher in `src/index.ts` already wraps the handler's return value via `{ content: [{ type: 'text', text: JSON.stringify(...) }] }`.

**Spec coverage**: FR-001 (success indicator + counts); SC-001 (success on non-empty); SC-002 (no transport-timeout on empty); SC-006 (LLM-callable contract clarity).

---

## DirectoryListing *(transient data structure, not exposed to the caller)*

The output of `rest.listFilesInDir(dirpath)` (or `rest.listFilesInVault()` for the root case), used both for directory detection and for driving the recursive walk.

```ts
type DirectoryListing = string[];   // entries; directories carry a trailing '/', files do not
```

**Rules**:

- The walk preserves the listing order verbatim — no sorting, no deduplication (FR-014).
- Directory detection inspects the parent's listing for the target's name, then a trailing-slash variant (R2 in research.md).
- The verification re-query reuses the same listing call to determine `'absent'` vs `'present'` for any path.

**Spec coverage**: FR-010 (directory detection mechanism); FR-014 (upstream listing order preserved).

---

## WalkState *(internal to recursive-delete.ts)*

The mutable bookkeeping struct threaded through every recursive call. Carries both the trace of successfully-deleted paths AND the running file/subdirectory counters that feed the success response.

```ts
interface WalkState {
  deletedPaths: string[];           // full vault-relative paths under the target, in deletion order
  filesRemoved: number;             // running count of files deleted during the walk
  subdirectoriesRemoved: number;    // running count of subdirectories deleted during the walk
}
```

**Rules**:

- Push order on `deletedPaths` matches deletion order. Files are pushed when their per-item delete succeeds; subdirectories are pushed AFTER the subdirectory's recursive walk + final per-subdirectory delete both succeed.
- Counters are incremented inline at the same point each path is pushed — file deletions bump `filesRemoved`, subdirectory deletions bump `subdirectoriesRemoved`. Counters are NEVER derived post-hoc from `deletedPaths` because the pushed strings do not carry a trailing-slash marker that distinguishes files from directories.
- The struct is owned by the handler's top-level invocation; recursive calls share the same reference.
- On partial failure the path-array snapshot is captured into `PartialDeleteError.deletedPaths` via `[...walkState.deletedPaths]` to insulate the error object from any further mutation. The counters are not exposed on the error — they are only consumed by the success response shape.

**Spec coverage**: FR-001 (success counts); FR-003 (flat list of every deleted path); the Q1 + Q4 clarifications.

---

## DeleteFileFailure *(structured error response)*

The failure payload. Implemented as a discriminated union of error subclasses; the handler translates each into a structured tool response with `isError: true`.

| Subclass | When it's thrown | Structured response shape |
|----------|------------------|---------------------------|
| `ZodError` (from `DeleteFileRequestSchema.parse`) | Input shape invalid | `Error: Invalid input — <field-path>: <reason>` |
| `ObsidianNotFoundError` | Target path absent in parent listing OR upstream returns 404 | `Error: not found: <filepath>` |
| `PartialDeleteError` | A per-item delete inside the walk failed | `Error: child failed: <failedPath> — already deleted: [<deletedPaths joined by comma>]` |
| `OutcomeUndeterminedError` | Verification query failed (timeout, 5xx, anything) | `Error: outcome undetermined for <targetPath>` |
| `ObsidianApiError` (passthrough) | Any other upstream failure | The existing `Obsidian API Error <code>: <message>` text — unchanged behaviour for non-timeout, non-404 failures |

The on-the-wire format is the MCP standard: `{ content: [{ type: 'text', text: <error message> }], isError: true }`. The dispatcher's existing `try/catch` (lines 256–270 in `src/index.ts`) already converts any thrown `Error` into that shape, so the handler can simply `throw` and rely on the dispatcher's wrapping.

**Spec coverage**:

- `ObsidianNotFoundError` → FR-007, SC-003 (clear "not found" rather than transport-timeout).
- `PartialDeleteError` → FR-003 (offender + deleted-paths list); the Q1 + Q4 clarifications (full inventory, upstream listing order).
- `OutcomeUndeterminedError` → FR-009; the Q3 clarification (single-shot, no retry).
- All four together → FR-005, FR-006, SC-005 (no transport-timeout when post-condition observable; no false success).

---

## ObsidianTimeoutError / ObsidianNotFoundError / ObsidianApiError *(typed-error layer)*

A new file [src/services/obsidian-rest-errors.ts](../../src/services/obsidian-rest-errors.ts) defines three classes plus type guards. `safeCall` in `obsidian-rest.ts` is updated to throw the matching subclass.

```ts
export class ObsidianTimeoutError extends Error {
  readonly kind = 'timeout' as const;
  constructor(public readonly timeoutMs: number, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ObsidianTimeoutError';
  }
}

export class ObsidianNotFoundError extends Error {
  readonly kind = 'not-found' as const;
  readonly status = 404 as const;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ObsidianNotFoundError';
  }
}

export class ObsidianApiError extends Error {
  readonly kind = 'api' as const;
  constructor(public readonly status: number, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ObsidianApiError';
  }
}

export const isObsidianTimeoutError = (e: unknown): e is ObsidianTimeoutError =>
  e instanceof ObsidianTimeoutError;
export const isObsidianNotFoundError = (e: unknown): e is ObsidianNotFoundError =>
  e instanceof ObsidianNotFoundError;
```

**`safeCall` discriminator (in obsidian-rest.ts)**:

```ts
catch (error) {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { errorCode?: number; message?: string } | undefined;
    const code = data?.errorCode ?? error.response?.status ?? -1;
    const message = data?.message ?? error.message ?? 'Unknown error';
    const formatted = `Obsidian API Error ${code}: ${message}`;
    if (error.code === 'ECONNABORTED') throw new ObsidianTimeoutError(this.client.defaults.timeout ?? 0, formatted, error);
    if (error.response?.status === 404) throw new ObsidianNotFoundError(formatted, error);
    throw new ObsidianApiError(typeof code === 'number' ? code : -1, formatted, error);
  }
  throw error;
}
```

**Rules**:

- `.message` text is preserved exactly — every existing caller sees the same `Obsidian API Error <code>: <message>` string. No tool-side messaging changes for unrelated tools.
- The original `AxiosError` is preserved on `.cause` for debugging.
- `isObsidian*Error` type guards are the only intended way to discriminate; the new handler imports them.

**Spec coverage**: indirectly supports FR-004, FR-005, FR-006, FR-007, FR-009 by giving the handler a reliable signal.

---

## TimeoutVerificationOutcome *(internal to verify-then-report.ts)*

The discriminated return type of `attemptWithVerification`.

```ts
type TimeoutVerificationOutcome =
  | { outcome: 'success' }
  | { outcome: 'failure'; cause: ObsidianTimeoutError };
// Note: `outcome: 'undetermined'` is NOT returned — it's thrown as `OutcomeUndeterminedError` so the handler's try/catch picks it up uniformly.
```

**Rules**:

- The function returns `{ outcome: 'success' }` either when the original operation succeeded normally OR when verification confirms the post-condition matches the requested success (the target is absent for a delete).
- The function returns `{ outcome: 'failure', cause }` when the original call timed out AND verification confirms the target is still present.
- The function throws `OutcomeUndeterminedError` when verification itself failed.
- Non-timeout, non-404 errors from the original call are re-thrown unchanged (so `ObsidianApiError` propagates through with no verification attempt — verification only applies on timeout per FR-004).

**Spec coverage**: FR-004, FR-005, FR-006, FR-008, FR-009.

---

## Summary table — entity to spec coverage

| Entity | FR / SC mapping | Clarification |
|--------|-----------------|---------------|
| `DeleteFileRequest` (zod) | FR-010 (trim) | — |
| `DeleteFileSuccess` | FR-001, SC-001, SC-002, SC-006 | Q2 (success shape: counts) |
| `DirectoryListing` | FR-010, FR-014 | Q5 (upstream order) |
| `WalkState` | FR-001, FR-003 | Q1, Q4 (flat full inventory) |
| `PartialDeleteError` | FR-003, Story 1 AS-3 | Q1, Q4 |
| `OutcomeUndeterminedError` | FR-009, SC-004 | Q3 (single-shot, no retry) |
| `ObsidianNotFoundError` | FR-007, SC-003 | — |
| `ObsidianTimeoutError` | FR-004 (gateway signal) | — |
| `ObsidianApiError` | FR-005/006 inverse: passes through | — |
| `TimeoutVerificationOutcome` | FR-004–FR-006, FR-008 | — |
