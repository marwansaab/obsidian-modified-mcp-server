# Phase 1 Data Model: Surgical Reads

**Branch**: `003-surgical-reads` | **Date**: 2026-04-26

This feature is stateless; there is no persisted data. The "data
model" captured here is the in-process shape of values flowing through
each wrapper, the rules that govern them, and the response shapes
returned to the caller. Every entity below maps to a zod schema in
`src/tools/surgical-reads/schema.ts` (see [contracts/get_heading_contents.md](./contracts/get_heading_contents.md)
and [contracts/get_frontmatter_field.md](./contracts/get_frontmatter_field.md)).

The structural heading-path predicate is the same `isValidHeadingPath`
defined in feature 001 (see
[../001-reenable-patch-content/data-model.md](../001-reenable-patch-content/data-model.md)).
This document does not redefine it; it references it.

---

## Entity: `GetHeadingContentsRequest`

The validated input to the `get_heading_contents` tool.

| Field | Type | Required | Validation |
|---|---|---|---|
| `filepath` | string | yes | non-empty after parse |
| `heading` | string | yes | non-empty after parse, AND must satisfy the `HeadingPath` rule (see below) |
| `vaultId` | string | no | inherits convention: omitted → default vault per existing tool pattern |

**Single source of truth**: the zod object schema in
`src/tools/surgical-reads/schema.ts` is the only definition. The MCP
`inputSchema` is generated from it via `zod-to-json-schema` at
module-load time and exported as part of the `Tool` object.

**Validator import**: the `HeadingPath` rule is enforced by the
imported `isValidHeadingPath` function from
`'../patch-content/schema.js'`. There is no second copy of the rule —
this is what FR-003 requires and what spec Assumptions records.

---

## Value Object: `HeadingPath` (validation rule)

A `HeadingPath` is a `string` of the form
`Segment1::Segment2[::Segment3...]` where each segment is the literal
text of a heading at that nesting level. Definition is identical to
feature 001's:

```text
isValidHeadingPath(target: string): boolean =
  let segments = target.split('::')
  in segments.length >= 2 AND ∀ s ∈ segments: s.length >= 1
```

**Fails the predicate** (each produces a wrapper-side rejection — same
inputs as feature 001's data-model):

| Input | Reason |
|---|---|
| `"Action Items"` | only 1 segment after split — bare |
| `"Weekly Review:Action Items"` | only 1 segment after split (single colon is not the separator) |
| `"Weekly Review::"` | last segment is empty |
| `"::Action Items"` | first segment is empty |
| `"Weekly Review::::Action Items"` | middle segment is empty |
| `""` | only 1 segment, and that segment is empty (also caught by zod `min(1)` first) |
| `"   "` | only 1 segment (whitespace-only is also bare) |

**Passes the predicate** (forwarded to upstream):

| Input | Notes |
|---|---|
| `"Weekly Review::Action Items"` | minimal valid path (2 segments) |
| `"Project::Plan::Q4::Risks"` | deep path (4 segments) |
| `"H1::H2 with spaces::H3-with-dashes"` | whitespace and punctuation inside segments are preserved verbatim |
| `"  Padded::  Both Sides  "` | leading/trailing whitespace **inside** a segment is preserved (no trim) |

**Out-of-reach inputs** (passes the structural predicate but cannot be
satisfied by the upstream — the limitation is documented in the tool's
MCP description per FR-001):

- A heading whose literal text contains `::` (e.g., a heading named
  `C++::primer`). The wrapper has no escape syntax; such a heading is
  unreachable through this tool.
- A top-level heading (one with no parent). It can never produce a
  ≥ 2-segment path; therefore unreachable through this tool.

In both unreachable cases, the documented fallback is `get_file_contents`
followed by client-side slicing (see spec Edge Cases and FR-001 (d)).

---

## Entity: `GetFrontmatterFieldRequest`

The validated input to the `get_frontmatter_field` tool.

| Field | Type | Required | Validation |
|---|---|---|---|
| `filepath` | string | yes | non-empty after parse |
| `field` | string | yes | non-empty after parse, AND must not be whitespace-only after `.trim()` |
| `vaultId` | string | no | inherits convention: omitted → default vault per existing tool pattern |

**`field` validation rule**: the zod schema applies `.min(1)` plus a
`.refine((s) => s.trim().length > 0, { message: 'field must not be
whitespace-only' })`. This satisfies spec FR-007's requirement that the
field be non-empty after trimming whitespace, while keeping the runtime
check in zod (Constitution Principle III).

There is no path-rule analogue here. The field name is forwarded to
the upstream verbatim (after `encodeURIComponent`); the upstream is the
authority on whether the field exists.

---

## Entity: `UpstreamHeadingReadOutcome`

The result of the upstream HTTP call to
`GET /vault/{filepath}/heading/{seg1}/{seg2}/...` with
`Accept: text/markdown`.

| Variant | Shape | How it appears to the caller |
|---|---|---|
| Success (2xx, body present) | `string` (raw markdown) | MCP `content: [{ type: 'text', text: <body> }]`, no `isError` |
| Success (2xx, empty body) | `''` | MCP `content: [{ type: 'text', text: '' }]`, no `isError`. Wrapper does NOT synthesize a "not found" error from an empty body. |
| Failure (non-2xx with body) | `{ errorCode?: number, message?: string }` | thrown as `Error("Obsidian API Error <code>: <message>")` by `safeCall`; surfaced as MCP `content: [{ type: 'text', text: 'Error: Obsidian API Error <code>: <message>' }], isError: true` |
| Failure (transport: ECONNREFUSED, timeout, DNS) | axios error with no `response` | thrown as `Error("Obsidian API Error -1: <message>")`; surfaced as MCP error |

The wrapper does not distinguish between these variants beyond what
`safeCall` already does. This is the explicit upstream-error-propagation
contract from Constitution Principle IV.

---

## Entity: `UpstreamFrontmatterReadOutcome`

The result of the upstream HTTP call to
`GET /vault/{filepath}/frontmatter/{field}`.

The upstream returns a JSON document encoding the field's value. The
wrapper decodes it via `JSON.parse(response.data)` (or, if the axios
client has `responseType: 'json'`, it is already decoded into a JS
value). The decoded value type is one of: `string`, `number`,
`boolean`, `null`, JSON `object`, JSON `array`.

| Variant | Decoded value type | How it appears to the caller |
|---|---|---|
| Success (2xx, scalar value) | string \| number \| boolean | MCP `content: [{ type: 'text', text: '{"value":<json-of-decoded>}' }]`, no `isError` |
| Success (2xx, structured value) | array \| object | MCP `content: [{ type: 'text', text: '{"value":<json-of-decoded>}' }]`, no `isError` |
| Success (2xx, value is null) | null | MCP `content: [{ type: 'text', text: '{"value":null}' }]`, no `isError`. Wrapper does NOT collapse `null` into "missing"; missing-field is the next variant. |
| Failure: field missing (upstream 4xx) | n/a | thrown as `Error("Obsidian API Error <code>: <message>")` by `safeCall`; surfaced as MCP `content: [{ type: 'text', text: 'Error: Obsidian API Error <code>: <message>' }], isError: true` |
| Failure: note missing (upstream 4xx) | n/a | same as field-missing |
| Failure: transport (ECONNREFUSED, timeout, DNS) | n/a | thrown as `Error("Obsidian API Error -1: <message>")`; surfaced as MCP error |

The `value: null` row vs. the field-missing row is the
load-bearing distinction recorded in spec FR-009 and clarification Q2:
`null` is a present, typed value; missing is a 4xx. They are
indistinguishable through the wrapper if and only if the upstream has
a bug (returns 200 for a missing field) — which is upstream's
responsibility, not the wrapper's.

---

## Entity: `WrapperValidationError`

Used only when the wrapper rejects an input before any HTTP call.

### For `get_heading_contents`

| Field | Value |
|---|---|
| Thrown as | `Error` (via the same `assertValidHeadingPathTarget` style throw used by `patch_content`) |
| `message` format | `<rule statement> — received: "<offending value>" — e.g., "<corrected example>"` |
| Surfacing | propagates to top-level handler at [src/index.ts:251-258](../../src/index.ts#L251-L258); returned as `content: [{ type: 'text', text: 'Error: <message>' }], isError: true` |

**Required components of `message`** (testable, identical to feature 001):

1. The rule name, verbatim: `heading targets must use the full H1::H2[::H3...] path`
2. The phrase `received: ` followed by the offending value in double quotes
3. The phrase `e.g., ` followed by a concrete corrected example

These three components together satisfy SC-005 and the FR-004
"must match `patch_content`" requirement.

### For `get_frontmatter_field`

| Field | Value |
|---|---|
| Thrown as | `ZodError` (zod's own throw from `.parse()`) |
| `message` format | zod's standard message, naming the offending field path (`field`) and the failing constraint |
| Surfacing | propagates to top-level handler at [src/index.ts:251-258](../../src/index.ts#L251-L258); returned as `content: [{ type: 'text', text: 'Error: <zod message>' }], isError: true` |

The frontmatter tool has no path-rule analogue, so the standard zod
error is sufficient. This satisfies Constitution Principle III's
"field paths reported by zod" requirement.

---

## State transitions

None. Both tools are request/response; no state is held between calls
and no client-side caching is added (per spec Edge Cases:
"No client-side caching is added").

---

## Identity & uniqueness

None. Each invocation is independent.
