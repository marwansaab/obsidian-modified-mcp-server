# Data Model: Fix Graph Tools

This document captures the response payload shapes for the seven graph tools after the fix. Existing internal types (`VaultStats`, `NoteConnections`, `ClusterInfo`) are preserved; the public envelope adds `skipped` and `skippedPaths` per FR-011 for aggregation tools.

---

## Shared envelope (FR-011) — aggregation tools only

Every aggregation tool's response wraps its primary result in an envelope of this shape (passed through MCP as a JSON-stringified string in `content[0].text`):

```ts
type AggregationEnvelope<T> = T & {
  skipped: number;        // always present, may be 0
  skippedPaths: string[]; // up to 50 entries; truncated when skipped > 50
};
```

This applies to: `get_vault_stats`, `get_vault_structure`, `find_orphan_notes`, `get_most_connected_notes`, `detect_note_clusters`. The two per-note tools (`get_note_connections`, `find_path_between_notes`) **do not** use this envelope (FR-011 carve-out).

---

## Per-tool payload shapes

### `get_vault_stats`

**Input** (zod):

```ts
z.object({
  vaultId: z.string().optional(),
})
```

**Output** (`AggregationEnvelope<VaultStats>`):

```ts
{
  totalNotes: number,
  totalLinks: number,
  orphanCount: number,
  tagCount: number,
  clusterCount: number,
  skipped: number,
  skippedPaths: string[],
}
```

Empty-vault case: `{ totalNotes: 0, totalLinks: 0, orphanCount: 0, tagCount: 0, clusterCount: 0, skipped: 0, skippedPaths: [] }`.

---

### `get_vault_structure`

**Input** (zod):

```ts
z.object({
  maxDepth: z.number().int().nonnegative().optional(),
  includeFiles: z.boolean().optional(),
  vaultId: z.string().optional(),
})
```

**Output** (`AggregationEnvelope<{ tree: Record<string, unknown> }>`):

```ts
{
  tree: { /* nested object: keys ending in "/" are folders; null values are files */ },
  skipped: number,
  skippedPaths: string[],
}
```

The existing `GraphService.getVaultStructure` returns the bare nested object; the handler wraps it as `{ tree: <returned-object>, skipped, skippedPaths }`.

---

### `find_orphan_notes`

**Input** (zod):

```ts
z.object({
  includeBacklinks: z.boolean().optional(),
  vaultId: z.string().optional(),
})
```

**Output** (`AggregationEnvelope<{ orphans: string[] }>`):

```ts
{
  orphans: string[],   // file paths relative to vault root
  skipped: number,
  skippedPaths: string[],
}
```

---

### `get_note_connections`

**Input** (zod):

```ts
z.object({
  filepath: z.string().min(1),
  depth: z.number().int().positive().optional(),  // currently unused by service; reserved
  vaultId: z.string().optional(),
})
```

**Output** (`NoteConnections` — no envelope per FR-011 carve-out):

```ts
{
  filepath: string,        // normalized path (with .md extension if missing)
  outgoingLinks: string[],
  backlinks: string[],
  tags: string[],
}
```

**Error** (FR-012): when `filepath` is not present in the vault, the handler throws `Error("note not found: <path>")` (or `"note not found: <path> (vault: <id>)"` if `vaultId` was explicitly supplied). The dispatcher's existing `try/catch` converts this to `{ content: [{ type: 'text', text: 'Error: note not found: ...' }], isError: true }`.

---

### `find_path_between_notes`

**Input** (zod):

```ts
z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  maxDepth: z.number().int().positive().optional(),
  vaultId: z.string().optional(),
})
```

**Output** (no envelope per FR-011 carve-out):

```ts
{
  path: string[] | null,  // null when both endpoints exist but no walk connects them within maxDepth
}
```

**Error** (FR-012): when `source`, `target`, or both are not present in the vault, the handler throws:

- One missing: `Error("note not found: <missing-path>")`
- Both missing: `Error("notes not found: <source>, <target>")`
- With explicit `vaultId`: ` (vault: <id>)` suffix

---

### `get_most_connected_notes`

**Input** (zod):

```ts
z.object({
  limit: z.number().int().positive().optional(),
  metric: z.enum(['links', 'backlinks', 'pagerank']).optional(),
  vaultId: z.string().optional(),
})
```

**Output** (`AggregationEnvelope<{ notes: Array<{ path: string; score: number }> }>`):

```ts
{
  notes: [{ path: string, score: number }, ...],  // sorted desc by score, capped at limit (default 10)
  skipped: number,
  skippedPaths: string[],
}
```

---

### `detect_note_clusters`

**Input** (zod):

```ts
z.object({
  minClusterSize: z.number().int().positive().optional(),
  vaultId: z.string().optional(),
})
```

**Output** (`AggregationEnvelope<{ clusters: ClusterInfo[] }>`):

```ts
{
  clusters: [{ id: number, notes: string[], size: number }, ...],  // sorted desc by size; only clusters with size >= minClusterSize
  skipped: number,
  skippedPaths: string[],
}
```

---

## Internal types (changes to `src/types.ts`)

### Existing — unchanged

```ts
export interface VaultStats { totalNotes; totalLinks; orphanCount; tagCount; clusterCount; }
export interface NoteConnections { filepath; outgoingLinks; backlinks; tags; }
```

### New — `SkipReport` (private to GraphService)

```ts
// Internal; not exported. Tracked as instance fields on GraphService.
type SkipReport = {
  skipped: number;
  skippedPaths: string[]; // full list during build; truncated to 50 only at the handler boundary
};
```

### New — `AggregationEnvelope<T>` (used in handlers, not in types.ts)

Defined inline in `src/tools/graph/handlers.ts` since it's a generic wrapper local to that module.

---

## State transitions

### `GraphService` build lifecycle

1. **Construction**: `new GraphService(vault, cacheTtlSeconds)` — `initialized = false`, empty graph, empty `skippedPaths`.
2. **Lazy build** (`ensureGraph` → `buildGraph`): On first public method call after construction or after TTL expiry:
   - Reset `graph`, `noteTags`, `lastSkipped = 0`, `lastSkippedPaths = []`.
   - Walk vault, attempt to read + parse each `.md` file.
   - On `fs.readFile` rejection or parse exception: `lastSkipped++`, `lastSkippedPaths.push(relativePath)`.
   - On success: add node, extract wikilinks/markdown links/tags, build edges.
   - Set `initialized = true`, `lastBuildTime = Date.now()`.
3. **Subsequent reads** (within `cacheTTL`): All public methods read from the cached graph + cached `lastSkipped` / `lastSkippedPaths`.
4. **Rebuild on staleness**: When `Date.now() - lastBuildTime > cacheTTL`, `ensureGraph` triggers another `buildGraph`.

### Per-request lifecycle (in dispatcher)

1. `handleToolCall(name, args)` switches on `name`; new `case 'get_vault_stats': return handleGetVaultStats(args, this);` etc.
2. Handler calls `assertValid<Tool>Request(args)` → returns typed args or throws `ZodError`.
3. Handler calls `getGraphService(typedArgs.vaultId)` → throws if `vault.vaultPath` not configured (FR-009).
4. Handler calls the relevant `service.methodName(...)` → triggers lazy build on first call, returns primary result.
5. Handler reads `service.lastSkipped` and `service.lastSkippedPaths` (truncated to 50) and wraps the primary result in the envelope.
6. Handler returns `{ content: [{ type: 'text', text: JSON.stringify(envelope) }] }`.
7. Dispatcher's outer `try/catch` (src/index.ts:250-260) converts any thrown error into `{ content: [...], isError: true }`.
