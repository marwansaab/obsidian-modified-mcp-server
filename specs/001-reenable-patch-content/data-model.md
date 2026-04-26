# Phase 1 Data Model: patch_content

**Branch**: `001-reenable-patch-content` | **Date**: 2026-04-26

This feature is stateless; there is no persisted data. The "data model"
captured here is the in-process shape of values flowing through the
wrapper, the rules that govern them, and the response shape returned to
the caller. Every entity below maps to a zod schema in
`src/tools/patch-content/schema.ts` (see [contracts/patch_content.md](./contracts/patch_content.md)).

---

## Entity: `PatchRequest`

The validated input to the `patch_content` tool.

| Field | Type | Required | Validation |
|---|---|---|---|
| `filepath` | string | yes | non-empty after parse |
| `operation` | enum: `"append" \| "prepend" \| "replace"` | yes | exact match against the enum |
| `targetType` | enum: `"heading" \| "block" \| "frontmatter"` | yes | exact match against the enum |
| `target` | string | yes | non-empty; if `targetType === "heading"`, must satisfy the `HeadingPath` rule (see below) |
| `content` | string | yes | (no length constraint; `""` is valid) |
| `vaultId` | string | no | inherits convention: omitted → default vault per existing tool pattern |

**Cross-field rule**: the heading-path validator runs **only** when
`targetType === "heading"`. For other target types, `target` is required
and non-empty but otherwise unvalidated by the wrapper (per
spec FR-006).

**Single source of truth**: the zod object schema in
`src/tools/patch-content/schema.ts` is the only definition. The MCP
`inputSchema` is generated from it via `zod-to-json-schema` at
module-load time and exported as part of the `Tool` object.

---

## Value Object: `HeadingPath` (validation rule)

A `HeadingPath` is a `string` of the form
`Segment1::Segment2[::Segment3...]` where each segment is the literal
text of a heading at that nesting level.

**Validation predicate**:

```text
isValidHeadingPath(target: string): boolean =
  let segments = target.split('::')
  in segments.length >= 2 AND ∀ s ∈ segments: s.length >= 1
```

**Fails the predicate** (each produces a wrapper-side rejection):

| Input | Reason |
|---|---|
| `"Action Items"` | only 1 segment after split — bare |
| `"Weekly Review:Action Items"` | only 1 segment after split (single colon is not the separator) |
| `"Weekly Review::"` | last segment is empty |
| `"::Action Items"` | first segment is empty |
| `"Weekly Review::::Action Items"` | middle segment is empty |
| `""` | only 1 segment, and that segment is empty |
| `"   "` | only 1 segment (whitespace-only is also bare) |

**Passes the predicate** (forwarded to upstream verbatim):

| Input | Notes |
|---|---|
| `"Weekly Review::Action Items"` | minimal valid path (2 segments) |
| `"Project::Plan::Q4::Risks"` | deep path (4 segments) |
| `"H1::H2 with spaces::H3-with-dashes"` | whitespace and punctuation inside segments are preserved verbatim |
| `"  Padded::  Both Sides  "` | leading/trailing whitespace **inside** a segment is preserved (no trim); upstream is the authority on whether the actual heading matches |

**Out-of-reach inputs** (passes the structural predicate but cannot be
satisfied by the upstream — the limitation is documented in the tool's
MCP description per FR-001):

- A heading whose literal text contains `::` (e.g., a heading named
  `C++::primer`). The wrapper has no escape syntax; such a heading is
  unreachable through this tool.
- A top-level heading (one with no parent). It can never produce a
  ≥ 2-segment path; therefore unreachable through this tool.

---

## Entity: `UpstreamPatchOutcome`

The result of the upstream HTTP call to `PATCH /vault/{filepath}`.

| Variant | Shape | How it appears to the caller |
|---|---|---|
| Success (2xx) | (no body) | MCP `content: [{ type: 'text', text: 'Content patched successfully' }]`, no `isError` |
| Failure (non-2xx with body) | `{ errorCode?: number, message?: string }` | thrown as `Error("Obsidian API Error <code>: <message>")` by `safeCall`; surfaced as MCP `content: [{ type: 'text', text: 'Error: Obsidian API Error <code>: <message>' }], isError: true` |
| Failure (transport: ECONNREFUSED, timeout, DNS) | axios error with no `response` | thrown as `Error("Obsidian API Error -1: <message>")`; surfaced as MCP error |

The wrapper does not distinguish between these variants — it lets
`safeCall` and the existing top-level handler do their work. This is
the explicit upstream-error-propagation contract from Constitution
Principle IV.

---

## Entity: `WrapperValidationError`

Used only when the wrapper rejects an input before any HTTP call.

| Field | Value |
|---|---|
| Thrown as | `Error` (via zod's `parse` throwing a `ZodError` that the wrapper converts) |
| `message` format | `<rule statement> — received: "<offending value>" — e.g., "<corrected example>"` |
| Surfacing | propagates to top-level handler at `src/index.ts:250-257`, returned as `content: [{ type: 'text', text: 'Error: <message>' }], isError: true` |

**Required components of `message`** (testable):

1. The rule name, verbatim: `heading targets must use the full H1::H2[::H3...] path`
2. The phrase `received: ` followed by the offending value in double quotes
3. The phrase `e.g., ` followed by a concrete corrected example

These three components together satisfy SC-004.

---

## State transitions

None. This is a request/response tool; no state is held between calls.

---

## Identity & uniqueness

None. Each invocation is independent.
