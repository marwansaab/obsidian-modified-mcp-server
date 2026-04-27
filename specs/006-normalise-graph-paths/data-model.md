# Data Model: Normalise Path Separators for Graph Tools

**Feature**: [spec.md](spec.md)
**Plan**: [plan.md](plan.md)
**Date**: 2026-04-27

This feature is a wrapper-boundary input normalisation fix. The "data model" is small: one new utility module (pure string functions, no state) and one new zod schema for the newly-wired `find_similar_notes` tool. No existing entities change.

---

## New entities

### `PathNormaliser` module — `src/utils/path-normalisation.ts`

Not a class. Three exported pure functions. No state, no I/O, no platform branching beyond reading `path.sep`.

```ts
import { sep } from 'node:path';

/**
 * Replace every `/` and `\` in `p` with `path.sep`.
 *
 * Used by graph-tool handlers whose downstream service ([GraphService]) keys its
 * internal `graphology` index by `path.relative()`-output, which is OS-native.
 * Idempotent: `toOsNativePath(toOsNativePath(p)) === toOsNativePath(p)`.
 *
 * Pure string transform. Empty input returns empty output. Leading and trailing
 * separators are preserved (callers' problem, not ours — see research.md R3).
 */
export function toOsNativePath(p: string): string {
  return p.replace(/[\\/]/g, sep);
}

/**
 * Replace every `/` and `\` in `p` with `/`.
 *
 * Used by the `find_similar_notes` dispatcher case whose downstream
 * (Smart Connections via the Research MCP Bridge plugin) treats vault-relative
 * paths as forward-slash-canonical (matches Obsidian's own internal convention).
 * Idempotent.
 */
export function toForwardSlashPath(p: string): string {
  return p.replace(/[\\/]/g, '/');
}

/**
 * Predicate used by tests to assert that normalisation never converts a
 * relative path to an absolute one. A separator transform cannot affect
 * absoluteness, but stating the invariant explicitly catches future
 * accidental changes.
 */
export function isAbsolutePath(p: string): boolean {
  // Implementation: import isAbsolute from 'node:path' and delegate.
  // Lifted into our module so tests can assert on it without re-importing.
  // See implementation file for details.
  // Signature only — tests live in tests/utils/path-normalisation.test.ts.
  // (Actual body is `return isAbsolute(p)` plus the import.)
  // Documented here because the predicate is part of the module's public API.
  // ...
  return false; // placeholder for the type signature
}
```

**Invariants**:

- `toOsNativePath` and `toForwardSlashPath` are total functions — every `string` input produces a `string` output. They never throw.
- Both are idempotent.
- Length is preserved: `output.length === input.length` for both.
- Non-separator characters are preserved verbatim. (No case folding, no Unicode normalisation, no whitespace trimming.)
- `isAbsolutePath(input) === isAbsolutePath(toOsNativePath(input)) === isAbsolutePath(toForwardSlashPath(input))` — separator transforms cannot change absoluteness.

**Test coverage** (in `tests/utils/path-normalisation.test.ts`):

- Forward-slash input → matches `path.sep`-joined form on each OS (use `expect(toOsNativePath('a/b')).toBe(`a${sep}b`)`).
- Backslash input → same target form.
- Mixed-separator input → consistent target form.
- Empty string → empty string (both helpers).
- Top-level filename with no separator → unchanged (both helpers).
- Leading separator preserved (both helpers).
- Trailing separator preserved (both helpers).
- Idempotence: `f(f(x)) === f(x)` for both helpers and a representative input set.
- Length-preserving: `output.length === input.length` for the same input set.
- `isAbsolutePath` invariant: relative input stays relative through both transforms.

---

### `FindSimilarNotesRequest` (zod) — `src/tools/semantic-tools.ts`

Replaces the hand-written JSON schema in the existing `find_similar_notes` registration entry. Brings the newly-wired tool into compliance with Constitution Principle III.

```ts
import { z } from 'zod';

export const FindSimilarNotesRequestSchema = z.object({
  filepath: z
    .string()
    .min(1, 'filepath must be a non-empty string')
    .describe('Path to the source note (relative to vault root). Forward-slash or backslash separators both accepted.'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum similar notes to return (default: 10).'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Similarity threshold 0-1 (default: 0.5).'),
  vaultId: z
    .string()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export type FindSimilarNotesRequest = z.infer<typeof FindSimilarNotesRequestSchema>;

export function assertValidFindSimilarNotesRequest(args: unknown): FindSimilarNotesRequest {
  return FindSimilarNotesRequestSchema.parse(args);
}
```

**Validation rules**:

- `filepath` — non-empty string. (Trim is *not* applied automatically; callers passing a whitespace-only string get a zod failure with the field-path. Matches the existing graph-tool schemas.)
- `limit` — positive integer. Optional. Defaults to 10 inside the service if absent.
- `threshold` — number in `[0, 1]`. Optional. Defaults to 0.5 inside the service if absent.
- `vaultId` — string. Optional. Resolves to `config.defaultVaultId` if absent.

**Note**: `semantic_search` is the sibling tool with its own hand-written JSON schema in `semantic-tools.ts`. It is **not** updated as part of this feature (per [research.md R5](research.md#r5--dispatcher-gap-for-find_similar_notes)) — it is unwired in the dispatcher and does not take a filepath. Its modernisation is a separate latent issue.

---

## Existing entities — unchanged

| Entity | File | Why no change |
|---|---|---|
| `GetNoteConnectionsRequest` (zod) | [src/tools/graph/schemas.ts:47](../../src/tools/graph/schemas.ts#L47) | `filepath: z.string().min(1)` is already the right contract; normalisation runs *after* parse. |
| `FindPathBetweenNotesRequest` (zod) | [src/tools/graph/schemas.ts:64](../../src/tools/graph/schemas.ts#L64) | `source` and `target` already non-empty strings; normalisation runs after parse. |
| `NoteConnections` response shape | [src/types.ts](../../src/types.ts) | `filepath` field continues to be the resolved graph node ID (OS-native form on Windows). Caller-input form is a wrapper-side concern; the response's `filepath` is the canonical index identity. |
| `GraphService.getNoteConnections` | [src/services/graph-service.ts:303](../../src/services/graph-service.ts#L303) | Service stays oblivious to separators (per Constitution Principle I and [research.md R2](research.md#r2--where-normalisation-runs-in-the-call-chain)). |
| `GraphService.findPathBetweenNotes` | [src/services/graph-service.ts:337](../../src/services/graph-service.ts#L337) | Same. |
| `SmartConnectionsService.findSimilar` | [src/services/smart-connections.ts:125](../../src/services/smart-connections.ts#L125) | Service does HTTP passthrough only; the dispatcher case normalises before calling. |
| `note not found: <path>` error format | [graph-service.ts:310](../../src/services/graph-service.ts#L310) | Format preserved verbatim per FR-006 (only the conditions change — see [research.md R4](research.md#r4--error-message-form-when-the-lookup-misses)). |

---

## Per-tool data flow

### `get_note_connections`

```text
caller → MCP request {filepath: "000-Meta/Vault Identity.md"}
   → dispatcher → handleGetNoteConnections(args)
   → assertValidGetNoteConnectionsRequest(args)              # zod validates {filepath: string, depth?, vaultId?}
   → const nodePath = toOsNativePath(req.filepath)            # NEW: "000-Meta\Vault Identity.md" on Windows; unchanged on POSIX
   → service.getNoteConnections(nodePath)                     # unchanged service signature
   → graph.hasNode(`${nodePath}.md`) → true                   # matches the index key produced by path.relative() at build time
   → returns NoteConnections {filepath, outgoingLinks, backlinks, tags}
```

### `find_path_between_notes`

```text
caller → MCP request {source: "000-Meta/A.md", target: "010-Notes/B.md"}
   → dispatcher → handleFindPathBetweenNotes(args)
   → assertValidFindPathBetweenNotesRequest(args)
   → const sourcePath = toOsNativePath(req.source)            # NEW
   → const targetPath = toOsNativePath(req.target)            # NEW
   → service.findPathBetweenNotes(sourcePath, targetPath, req.maxDepth)
   → returns string[] | null
```

### `find_similar_notes`

```text
caller → MCP request {filepath: "000-Meta/Vault Identity.md"}
   → dispatcher → case 'find_similar_notes'                    # NEW dispatcher case
   → assertValidFindSimilarNotesRequest(args)                  # NEW: zod-derived schema
   → const path = toForwardSlashPath(req.filepath)             # NEW: forward-slash form for Obsidian/Smart Connections
   → semanticService.findSimilar(path, {limit, threshold})
   → POST /search/similar {path, limit, threshold}
   → returns SemanticResult[]
```

---

## Summary of new files / modified files for data-model purposes

| Path | Status | Purpose |
|---|---|---|
| `src/utils/path-normalisation.ts` | NEW | The two helpers + `isAbsolutePath` predicate |
| `src/tools/semantic-tools.ts` | MODIFIED | Add `FindSimilarNotesRequestSchema` + `assertValidFindSimilarNotesRequest`; replace hand-written JSON schema in registration with `zodToJsonSchema(...)` form |
| `src/tools/graph/handlers.ts` | MODIFIED | Two handlers gain a single normalisation call each; no new exports |
| `src/index.ts` | MODIFIED | New `case 'find_similar_notes'` in the dispatcher switch |

All other files (`graph-service.ts`, `smart-connections.ts`, `types.ts`, `obsidian-rest.ts`, the other graph schemas) are untouched.
