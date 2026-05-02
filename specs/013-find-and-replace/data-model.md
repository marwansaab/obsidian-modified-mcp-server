# Phase 1 Data Model: `find_and_replace`

**Branch**: `013-find-and-replace` | **Date**: 2026-05-03 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

The tool is stateless — no persisted entities, no database schema, no cache. The "data model" here is the in-memory record shapes that flow through the pipeline (request validation → vault walk → per-file processing → response assembly) plus the `rest.findAndReplace` helper's input/output contract that 012's `rename_file` consumes. All shapes are TypeScript types; the request shape doubles as the zod schema.

## Entities

### 1. `FindAndReplaceRequest` (boundary input)

The validated input to the tool, derived from a single `zod` schema. Drives both the runtime parse and the published MCP `inputSchema` via `zod-to-json-schema` (Principle III).

**Fields:**

| Field | Type | Required | Default | Validation / Notes |
|-------|------|----------|---------|---------------------|
| `search` | `string` | yes | — | Non-empty (FR-022). When `regex: true`, must compile under FR-013's flag set; compile error → structured FR-021 boundary error. |
| `replacement` | `string` | yes | — | May be empty. May contain `$1`/`$&`/`$$` references when `regex: true` (FR-013). In literal mode (`regex: false`), `$` is a literal character. |
| `regex` | `boolean` | no | `false` | When `true`, `search` parses as ECMAScript regex with the FR-013 flag set. |
| `caseSensitive` | `boolean` | no | `true` | When `false`, regex `i` flag is set in addition to FR-013's always-on flags; ECMAScript Unicode case-folding (FR-012). |
| `wholeWord` | `boolean` | no | `false` | When `true`, the effective pattern is wrapped in `\b…\b` in both literal and regex modes (FR-010). |
| `flexibleWhitespace` | `boolean` | no | `false` | When `true`, every whitespace run in `search` becomes `\s+` (FR-011). In literal mode, the rest of `search` is regex-escaped first. |
| `skipCodeBlocks` | `boolean` | no | `false` | When `true`, fenced code blocks (CommonMark line-anchored, FR-007) are skip regions. |
| `skipHtmlComments` | `boolean` | no | `false` | When `true`, HTML comments (non-greedy `<!--…-->`, FR-008) are skip regions. |
| `dryRun` | `boolean` | no | `false` | When `true`, no writes; structured previews returned (FR-015). |
| `pathPrefix` | `string \| undefined` | no | `undefined` | Vault-relative directory-segment prefix (FR-004). Trailing slash normalized away. Case-sensitive on all platforms. No glob expansion. |
| `vaultId` | `string \| undefined` | no | `undefined` | Per-vault dispatch (FR-017). Resolved by `getRestService(vaultId)` before the request reaches the helper. |
| `verbose` | `boolean` | no | `false` | When `true`, the response includes `perFile` (FR-020). |

**Invariants:**
- `search.length > 0` (FR-022).
- When `regex: true`, `new RegExp(search, flags)` MUST succeed at validation time; the `flags` string is computed from `caseSensitive`, `wholeWord`, `flexibleWhitespace` per FR-013.
- `vaultId`, when provided, MUST resolve to a configured vault (FR-019).

**Zod schema sketch** (final form lives in `src/tools/find-and-replace/schema.ts`):

```typescript
export const FindAndReplaceRequestSchema = z.object({
  search: z.string().min(1, 'search must be non-empty'),
  replacement: z.string(),
  regex: z.boolean().optional().default(false),
  caseSensitive: z.boolean().optional().default(true),
  wholeWord: z.boolean().optional().default(false),
  flexibleWhitespace: z.boolean().optional().default(false),
  skipCodeBlocks: z.boolean().optional().default(false),
  skipHtmlComments: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
  pathPrefix: z.string().optional(),
  vaultId: z.string().optional(),
  verbose: z.boolean().optional().default(false),
});
export type FindAndReplaceRequest = z.infer<typeof FindAndReplaceRequestSchema>;
```

The regex compile check runs as a refinement (`.superRefine`) so the error message identifies which input was invalid.

---

### 2. `SkipRegion` (internal record)

A contiguous range of code-unit positions in a single note's content that is excluded from search. Produced by the region detectors per FR-007 / FR-008 / FR-009.

**Fields:**

| Field | Type | Notes |
|-------|------|-------|
| `start` | `number` | Inclusive start index in JS code units. |
| `end` | `number` | Exclusive end index in JS code units. |
| `kind` | `'code-block' \| 'html-comment'` | Detector that produced the region. Used for diagnostics and `totalMatchesInSkippedRegions` accounting. |

**Invariants:**
- `0 <= start < end <= content.length`.
- Within a single detector's output, regions are non-overlapping and sorted by `start`.
- After union (FR-009), regions across kinds may be merged into broader ranges; merged ranges keep one `kind` for accounting (the kind of the *earlier* region wins on ties).

---

### 3. `MatchPreview` (dry-run output element, FR-015)

Structured per-match record returned in `perFile[i].previews` for dry-run mode (and optionally for `verbose: true` committed runs).

**Fields:**

| Field | Type | Notes |
|-------|------|-------|
| `matchIndex` | `number` | 1-based, in scan order from the start of the file. |
| `lineNumber` | `number` | 1-based line number of the match start. CRLF and LF both count as one line break (FR-016a). |
| `columnStart` | `number` | 1-based code-unit column of the match start within its line. |
| `before` | `string` | Up to 40 Unicode code points of left context, truncated by code points (R9). |
| `match` | `string` | The matched text, verbatim. |
| `replacement` | `string` | The replacement text, post-`$`-expansion in regex mode. |
| `after` | `string` | Up to 40 Unicode code points of right context, truncated by code points (R9). |

**Invariants:**
- `before` / `after` slices preserve newlines literally (FR-015).
- `match` is whatever the regex matched (or the literal `search` string).
- `previews` arrays in the response cap at 1–3 entries per file (FR-015); the cap is configurable in the implementation but the spec says 1–3.

---

### 4. `PerFileResult` (per-file accounting record)

Internal record produced by the file processor for each enumerated file. Drives both the `perFile` array (when `verbose: true`) and the aggregate counters (`filesScanned`, `filesModified`, etc.).

**Fields:**

| Field | Type | Notes |
|-------|------|-------|
| `filename` | `string` | Vault-relative, forward-slash, no leading slash (R11). |
| `replacements` | `number` | Per-file actual replacements (matches in searchable spans that were replaced). |
| `matchesInSkippedRegions` | `number` | Per-file matches inside skipped regions (carved out, not replaced). |
| `previews` | `MatchPreview[] \| undefined` | First 1–3 matches; present in dry-run, and in `verbose` committed runs if matches existed. |
| `outcome` | `'modified' \| 'no-op' \| 'skipped' \| 'failed'` | Disposition: `modified` (write succeeded or would succeed in dry-run); `no-op` (replacement output byte-identical to input — FR-014, no write issued); `skipped` (size cap or dot-prefix exclusion — FR-024a, FR-024b); `failed` (PUT errored mid-sweep — FR-021a). |
| `skipReason` | `'size_exceeded' \| 'output_size_exceeded' \| undefined` | Set iff `outcome === 'skipped'`. Populates the response's `skipped[]` array. |
| `error` | `string \| undefined` | Set iff `outcome === 'failed'`. Populates the response's `failures[]` array. |
| `inputSizeBytes` | `number` | UTF-8 byte length of the original content. |
| `outputSizeBytes` | `number` | UTF-8 byte length of the post-replacement content (only computed when content actually changed). |

**State transitions:**

```
enumerated → fetched
fetched   → input-size-checked
            ├─ size_exceeded         → outcome = 'skipped' (skipReason: 'size_exceeded')
            └─ ok                    → replaced
replaced  → output-size-checked
            ├─ output_size_exceeded  → outcome = 'skipped' (skipReason: 'output_size_exceeded')
            └─ ok                    → byte-equal-check
byte-equal-check
            ├─ output == input       → outcome = 'no-op' (FR-014)
            └─ output != input       → write-or-dry-run
write-or-dry-run
            ├─ dryRun: true          → outcome = 'modified' (no PUT)
            └─ dryRun: false         → put_content
                                       ├─ success    → outcome = 'modified'
                                       └─ rejection  → outcome = 'failed' (FR-021a)
```

**Excluded-by-walker files** (dot-prefix per FR-024b, non-`.md` per FR-024) never become `PerFileResult` records — they are filtered out at enumeration time before the per-file processor runs.

---

### 5. `FindAndReplaceResult` (response shape)

The aggregate response returned by both `rest.findAndReplace(...)` (as a plain object) and the public MCP tool (wrapped in a `CallToolResult`).

**Fields:**

| Field | Type | Notes |
|-------|------|-------|
| `ok` | `boolean` | `true` iff zero per-file failures occurred mid-sweep. Pre-sweep failures (FR-021) raise a structured error instead of returning `ok: false`. |
| `dryRun` | `boolean` | Echoes the request's `dryRun` value. Useful for clients that store responses and want to know whether files were actually written. |
| `vaultId` | `string` | The resolved vault (default-resolved if `vaultId` was omitted in the request). |
| `pathPrefix` | `string \| null` | Echoes the normalized `pathPrefix` (with trailing slash stripped); `null` if absent. |
| `filesScanned` | `number` | Files that passed the dot-prefix and `.md`-extension filters AND the input-size cap AND were fetched. Excludes dot-prefix-excluded files (which never become `PerFileResult`s) but INCLUDES files that became `no-op` outcomes. |
| `filesModified` | `number` | Count of `PerFileResult`s with `outcome === 'modified'`. |
| `filesSkipped` | `number` | Count of `PerFileResult`s with `outcome === 'skipped'`. |
| `totalReplacements` | `number` | Sum of `replacements` across all `PerFileResult`s with `outcome === 'modified'` (FR-020a). |
| `totalMatchesInSkippedRegions` | `number` | Sum of `matchesInSkippedRegions` across all scanned files (FR-020b). |
| `perFile` | `PerFileResult[] \| undefined` | Present when `verbose: true`. Sorted by `filename` ascending lexicographic UTF-8 (FR-020c). |
| `failures` | `Array<{ filename: string; error: string }> \| undefined` | Present when at least one file failed mid-sweep. Sorted by `filename` ascending. |
| `skipped` | `Array<{ filename: string; reason: 'size_exceeded' \| 'output_size_exceeded'; sizeBytes: number; outputSizeBytes?: number }> \| undefined` | Present when at least one file was skipped. Sorted by `filename` ascending. |
| `responseTruncated` | `boolean \| undefined` | Set to `true` if the response was truncated under R16's 1 MB cap. Optional; absent when not truncated. |

**Invariants:**
- `filesScanned >= filesModified + filesSkipped + len(failures)`. The remainder are no-op files.
- `ok === (failures === undefined || failures.length === 0)`.
- `totalReplacements >= filesModified` only when every modified file has at least one replacement (which it must, by definition of `outcome === 'modified'`). So `totalReplacements >= filesModified` always holds (every modified file contributes ≥ 1 to the sum).
- Empty arrays are NOT included in the response — `failures: []` becomes `failures: undefined` (omitted from the JSON). Reduces noise for the common happy path.

---

### 6. `RestFindAndReplaceOptions` (helper input — the contract 012 imports)

The parameter object accepted by `ObsidianRestService.findAndReplace(...)`. **Vault-agnostic at this boundary** — multi-vault routing happens upstream by virtue of which `ObsidianRestService` instance the caller invokes the method on (R8).

**Fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `search` | `string` | yes | Non-empty (helper enforces this; mirrors FR-022). |
| `replacement` | `string` | yes | |
| `regex` | `boolean` | no | Default `false`. |
| `caseSensitive` | `boolean` | no | Default `true`. |
| `wholeWord` | `boolean` | no | Default `false`. |
| `flexibleWhitespace` | `boolean` | no | Default `false`. |
| `skipCodeBlocks` | `boolean` | no | Default `false`. |
| `skipHtmlComments` | `boolean` | no | Default `false`. |
| `dryRun` | `boolean` | no | Default `false`. |
| `pathPrefix` | `string` | no | Trailing slash normalized away. |
| `verbose` | `boolean` | no | Default `false`. |

**Notes:**
- NO `vaultId` field. The caller selects which vault by which `ObsidianRestService` instance they call the method on. This matches every other method on the service (`putContent`, `getFileContents`, `listFilesInVault`, etc.).
- The helper performs its own input validation (mirrors the zod schema) — internal helpers can trust their inputs (Principle III) but `findAndReplace` is consumed by 012's handler too, so it does a minimal sanity check (`search` non-empty, `regex` compiles if `regex: true`) and throws a typed `Error` if violated. The public-tool layer's zod validation is the primary gate; the helper's check is a backstop.

**Return type**: `Promise<FindAndReplaceResult>` — same shape as the public tool's result, minus the `CallToolResult` wrapper. The public tool's handler unwraps and re-wraps for MCP transport.

---

## Data flow (end-to-end)

```
MCP CallToolRequest
  │
  ├─ args (Record<string, unknown>)
  │
  ▼
src/tools/find-and-replace/handler.ts
  ├─ assertValidFindAndReplaceRequest(args)   ← zod boundary (Principle III)
  │   └─ throws if FR-022 / FR-023 / vaultId / etc. violated
  │
  ├─ rest = getRestService(req.vaultId)        ← LAYER 3 dispatch
  │
  ├─ result = await rest.findAndReplace({...req omit vaultId})
  │   │
  │   ▼ src/services/obsidian-rest.ts findAndReplace()
  │     ├─ files = await walker(rest, req.pathPrefix)
  │     │           ← LAYER 3 walker, applies FR-024b dot-prefix +
  │     │             FR-024 .md-case-insensitive + FR-004 pathPrefix
  │     │
  │     ├─ for each file (sorted FR-020c order):
  │     │   ├─ content = await rest.getFileContents(file)
  │     │   ├─ if Buffer.byteLength(content) > 5MB → skipped[size_exceeded]
  │     │   ├─ skipRegions = [...detectFences(content), ...detectComments(content)]
  │     │   │              ← LAYER 2 region detectors (FR-007/8/9)
  │     │   ├─ {output, replacementCount, matchesInSkippedCount, previews}
  │     │   │              = applyReplacement(content, skipRegions, pattern)
  │     │   │              ← LAYER 1 single-pass global (FR-006)
  │     │   ├─ if Buffer.byteLength(output) > 5MB → skipped[output_size_exceeded]
  │     │   ├─ if output === content → no-op (FR-014)
  │     │   ├─ if dryRun: record preview only
  │     │   └─ else: rest.putContent(file, output)
  │     │     ├─ success: outcome=modified
  │     │     └─ failure (after first success): outcome=failed (FR-021a)
  │     │
  │     └─ assembleResult(perFileResults)      ← LAYER 3 response assembly
  │         ├─ sort arrays by filename (FR-020c)
  │         ├─ compute aggregates (filesScanned, filesModified, etc.)
  │         └─ apply 1MB response cap (R16) if needed
  │
  └─ wrap result in CallToolResult: {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]}
```

---

## Validation rules summary

| Rule | Source | Where enforced |
|------|--------|----------------|
| `search` non-empty | FR-022 | Zod schema (`.min(1)`) + helper backstop |
| Regex compiles | FR-023 | Zod superRefine + helper backstop |
| `vaultId` resolves | FR-019 | `getRestService(vaultId)` throws if unknown vault |
| Per-file input ≤ 5 MB | FR-024a | `findAndReplace` helper, before `getFileContents` finishes |
| Per-file output ≤ 5 MB | FR-024a | `findAndReplace` helper, after `applyReplacement` |
| Dot-prefix exclusion | FR-024b | Walker, during enumeration |
| `.md` extension match (case-insensitive) | FR-024 | Walker |
| `pathPrefix` directory-segment match | FR-004 | Walker |
| Single-pass global semantics | FR-006 | Replacer |
| Skip-region byte-for-byte preservation | FR-007 / FR-008 / FR-009 / FR-009a | Region detector + replacer |
| Line-ending byte-for-byte preservation | FR-016a | Replacer (no normalization) + putContent (passes string through) |
| Single-match cannot cross skip boundary | FR-009a | Replacer (operates on per-span basis) |
| Trailing-newline preservation | Edge Case + SC-007 | Replacer (operates on raw string; standard JS replace preserves trailing chars) |

---

## What this data model does NOT include

- Persisted state (no DB, no cache, no on-disk index — every call enumerates fresh).
- Cross-call deduplication or rate limiting (no state to dedupe against).
- Per-file lock acquisition (FR-021a's last-write-wins posture says we don't need it).
- Streaming intermediate results (the MCP `CallToolResult` shape doesn't support streaming; the response is always the full aggregate at end-of-sweep).
- Configuration (no settings file, no environment-variable knobs — all behavior is governed by the request fields).

These are correctly NOT in scope; documenting them here so they don't surface as questions during implementation.
