# Contract: `find_and_replace` MCP tool + `rest.findAndReplace` helper

**Branch**: `013-find-and-replace` | **Date**: 2026-05-03 | **Spec**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md) | **Data Model**: [../data-model.md](../data-model.md)

This document is the binding interface contract for the new tool. It is the document that 012's `rename_file` handler imports against (FR-013 of the [012 plan](../../012-safe-rename/plan.md)) and that downstream MCP clients consume via the published JSON Schema. Every name, type, and behavior here is normative; the implementation MUST conform.

## Surface 1 — Public MCP tool: `find_and_replace`

### Tool registration

Lives in `src/tools/find-and-replace/tool.ts`. Exported as `FIND_AND_REPLACE_TOOLS: Tool[]` and aggregated into `ALL_TOOLS` in [src/tools/index.ts](../../../src/tools/index.ts) on first ship.

```typescript
export const FIND_AND_REPLACE_TOOLS: Tool[] = [
  {
    name: 'find_and_replace',
    description: '<documented below>',
    inputSchema: zodToJsonSchema(FindAndReplaceRequestSchema, {
      $refStrategy: 'none',
    }) as Tool['inputSchema'],
  },
];
```

### Description (FR-003 + R13)

The description string MUST contain the four pinned substrings (asserted by `tests/tools/find-and-replace/registration.test.ts`):

1. `"clean git working tree"` — the precondition (FR-003a, plus implicit reinforcement of the dry-run safety net).
2. `"dry-run is the safety net"` — the canonical safety mitigation (FR-003b).
3. `"last-write-wins"` — the concurrency posture (FR-003c, Q4 / session 1).
4. `"case-sensitive"` — explicit warning about `pathPrefix` casing (R13, FR-004; protects Windows users).

Recommended full description (final wording is a write-time call but MUST contain all four substrings):

> Find and replace text vault-wide across every `.md` file in the targeted vault. **DESTRUCTIVE**: this tool rewrites notes in-place. Run with `dryRun: true` first to preview matches; commit with `dryRun: false`. The vault SHOULD be in a clean git working tree (or otherwise backed up) before mutations — `dry-run is the safety net`. Concurrency posture is `last-write-wins`: if Obsidian (or a sync plugin) writes a note in the gap between the tool's read and write, the tool overwrites that external edit without warning. Close Obsidian or pause sync plugins before running mutations on important content. `pathPrefix` matching is `case-sensitive` on all platforms (including Windows). Files in dot-prefixed directories (e.g., `.obsidian/`, `.trash/`) are excluded; the per-file size cap is 5 MB on both input and output.

### Input shape (zod-validated boundary, Principle III)

The input is a JSON object matching `FindAndReplaceRequestSchema` from [../data-model.md §1](../data-model.md#1-findandreplacerequest-boundary-input). Every field is documented there with type, required/optional status, default, and validation rule.

The MCP `inputSchema` is published verbatim as the `zod-to-json-schema` output of `FindAndReplaceRequestSchema`. Consumers (LLM clients) read this schema to decide what arguments are valid.

### Output shape (`CallToolResult`)

```typescript
{
  content: [{
    type: 'text',
    text: JSON.stringify(findAndReplaceResult, null, 2)
  }]
}
```

where `findAndReplaceResult` is the `FindAndReplaceResult` shape documented in [../data-model.md §5](../data-model.md#5-findandreplaceresult-response-shape). Using `text` content (not `tool_result`-typed structured content) matches every other tool in this server.

### Error behavior

- **Pre-sweep failures (FR-021)**: A `z.ZodError` from boundary validation, an invalid `vaultId` (FR-019), an empty `search` (FR-022), or a regex compile error (FR-023) raises a thrown `Error` from the handler. The dispatcher catches it and surfaces a structured MCP error with the field path and message.
- **Mid-sweep per-file failures (FR-021a)**: The sweep continues. The result has `ok: false`, `failures: [{filename, error}, ...]`. NO error is thrown from the handler; the partial result is returned via the normal success path.
- **Total enumerate failure**: If the initial `rest.listFilesInVault()` call fails (network down, vault offline), the upstream error propagates verbatim per Principle IV.

### Routing (FR-017 / FR-018 / FR-019)

The dispatcher branch in [src/index.ts](../../../src/index.ts):

```typescript
case 'find_and_replace':
  return handleFindAndReplace(args, this.getRestService(this.resolveVaultId(args)));
```

`resolveVaultId(args)` reads the optional `args.vaultId` and either returns it (validated against configured vaults) or returns the default. `getRestService(vaultId)` returns the per-vault `ObsidianRestService` instance — same plumbing as every other vault-aware tool. **None** of the LAYER 1 / LAYER 2 sources support this; it is the LAYER 3 original contribution per FR-027.

---

## Surface 2 — Internal helper: `ObsidianRestService.findAndReplace(opts)`

This is the contract that 012's `rename_file` handler imports as a static module dependency. **The shape here is binding for 012's consumption.**

### Signature

```typescript
class ObsidianRestService {
  // ... existing methods ...

  async findAndReplace(opts: RestFindAndReplaceOptions): Promise<FindAndReplaceResult>;
}
```

### Input

`RestFindAndReplaceOptions` from [../data-model.md §6](../data-model.md#6-restfindandreplaceoptions-helper-input--the-contract-012-imports). The fields are identical to `FindAndReplaceRequest` minus `vaultId` (since the per-vault REST service is the routing axis at this surface).

### Output

`FindAndReplaceResult` (plain object, NOT wrapped in a `CallToolResult`).

### Behavior

The helper is the actual workhorse — region detection, replacement, dry-run vs commit, response assembly. It encapsulates LAYER 1 + LAYER 2 of the brief. The public tool's `handler.ts` is a thin wrapper that adds zod validation, vault resolution, and `CallToolResult` wrapping (LAYER 3).

### Error behavior

The helper throws on:
- Empty `search` (sanity check; mirrors FR-022).
- Regex compile failure when `regex: true` (mirrors FR-023).
- Initial enumerate failure (`rest.listFilesInVault()` rejects).

The helper does NOT throw on:
- Per-file fetch / write failures during the sweep — these are caught and recorded in the returned `FindAndReplaceResult.failures` array (FR-021a).
- Per-file size-cap exclusions — recorded in `skipped`.
- Per-file no-op outcomes — counted in `filesScanned` minus `filesModified`.

### Why a helper, not just a free function

Because `findAndReplace` is logically a *method* on the per-vault REST service: it operates over the vault that the service is bound to. Making it a free function `findAndReplace(rest, opts)` would be syntactically equivalent but inconsistent with the other vault-scoped operations on `ObsidianRestService` (`putContent`, `getFileContents`, `listFilesInVault`, etc.). Consistency wins. R8 documents the alternatives.

---

## Compatibility with 012's `rename_file`

012's [`regex-passes.ts`](../../../src/tools/rename-file/regex-passes.ts) builds patterns of the shape `(?<!!)\\[\\[(${old})(\\|[^\\]]*)?\\]\\]` etc., and the 012 plan documents that the handler will call `rest.findAndReplace(...)` four times with these patterns plus `flags: 'g'`, `skipCodeBlocks: true`, `skipHtmlComments: true`.

**Translation table** — 012's expected call shape mapped to this contract's parameters:

| 012's expected call | This contract's parameter |
|---------------------|---------------------------|
| `pattern: string` (regex source) | `search` |
| `replacement: string` | `replacement` |
| `flags: 'g'` | `regex: true` (the `g` flag is implied by FR-013's always-on `g`) |
| `skipCodeBlocks: true` | `skipCodeBlocks: true` |
| `skipHtmlComments: true` | `skipHtmlComments: true` |
| (implicit) `caseSensitive: true` | `caseSensitive: true` (default) |

**Verified compatibility** (per [../research.md §R12](../research.md#r12--compatibility-with-012s-rename_file-regex-passes)):
- Lookbehind `(?<!!)` — works with the `u` flag this contract sets always-on.
- Negated character class `[^\\]|]*` — works with all flags this contract sets.
- 012's patterns don't use `^`/`$` anchors, so the always-on `m` flag doesn't affect them.
- 012's patterns don't rely on `s` (dotall), so the always-off `s` flag doesn't affect them.

**No changes to 012 are required by this feature.** When 012's handler ships (per 012's tasks file), it imports `rest.findAndReplace` and calls it as documented above.

---

## Test contract (Principle II — NON-NEGOTIABLE)

Tests live under `tests/tools/find-and-replace/` and `tests/services/find-and-replace/`. Per [../plan.md §Project Structure](../plan.md#project-structure), the test files are:

| File | Asserts |
|------|---------|
| `tests/tools/find-and-replace/registration.test.ts` | Tool name `find_and_replace`; the four FR-003 substrings (R13); `inputSchema` derives from zod schema. |
| `tests/tools/find-and-replace/schema.test.ts` | Zod boundary cases: empty `search` rejected (FR-022); regex compile error rejected (FR-023); defaults applied; `pathPrefix` accepts strings; `vaultId` accepts strings. |
| `tests/tools/find-and-replace/region-detection.test.ts` | CommonMark fence detection per FR-007 (well-formed, mismatched-count, unclosed); HTML comment detection per FR-008 (single-line, multi-line, empty, unclosed); union semantics per FR-009 (overlap, boundary-crossing). |
| `tests/tools/find-and-replace/pattern-building.test.ts` | Literal escape; wholeWord `\b…\b`; flexibleWhitespace `\s+`; regex flag set per FR-013 (`g`, `i` when caseSensitive false, `m` always-on, `u` always-on, `s` off); empty-match regex allowed (FR-013, Q3). |
| `tests/tools/find-and-replace/replacer.test.ts` | Single-pass global per FR-006 (replacement containing search not re-scanned); capture-group `$1`/`$&` honored; `\b` at skip-region edges per FR-009a; byte-identical no-op per FR-014. |
| `tests/tools/find-and-replace/walker.test.ts` | Dot-prefix exclusion per FR-024b; `.md` case-insensitive per FR-024; `pathPrefix` segment match per FR-004; trailing slash normalized away. |
| `tests/tools/find-and-replace/preview-formatter.test.ts` | `MatchPreview` shape per FR-015; ≤40 code-point context truncation (R9); newlines preserved literally; multi-byte / non-BMP characters handled. |
| `tests/tools/find-and-replace/handler.test.ts` | **(Principle II minimum)** ≥1 happy path; ≥1 mid-sweep failure (FR-021a `failures` array); dry-run zero-write; multi-vault routing (`vaultId: 'research'` modifies research vault, NOT default); CRLF preservation on a CRLF fixture (FR-016a). |
| `tests/services/find-and-replace/rest-find-and-replace.test.ts` | The `rest.findAndReplace` helper signature 012 imports; `RestFindAndReplaceOptions` defaults; result shape; vault-agnostic boundary (no `vaultId` field on the helper). |

**Constitutional minimum**: `handler.test.ts` is the file that satisfies Principle II's "≥1 happy + ≥1 failure path" requirement. The other test files are structural-correctness gates beyond the constitutional minimum, similar to the 012 spec's pattern.

---

## Versioning and breaking-change discipline

This is the first version of this contract (v1). Any future change that:
- Removes a field from `FindAndReplaceRequest`, or
- Renames a field in `FindAndReplaceResult`, or
- Changes the meaning of a count (`totalReplacements`, `filesModified`, etc.), or
- Removes the `rest.findAndReplace` helper or changes its signature,

is a **breaking change** and requires a coordinated update to 012's handler (and any other future consumer). Additive changes (new optional fields on the request, new fields on the response) are non-breaking and don't require coordination.

The contract is versioned implicitly via git history; no formal version-string metadata is stored on the response.
