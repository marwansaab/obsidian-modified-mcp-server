# Phase 0 Research: Surgical Reads — get_heading_contents + get_frontmatter_field

**Branch**: `003-surgical-reads` | **Date**: 2026-04-26

This document records the research and decisions feeding into the
implementation plan. Each section follows the format:

- **Decision**: what was chosen
- **Rationale**: why
- **Alternatives considered**: what else was evaluated and rejected

Most foundational decisions for this repo (test runner, HTTP mock,
zod↔JSON-Schema bridge) were resolved in feature 001 — see
[specs/001-reenable-patch-content/research.md](../001-reenable-patch-content/research.md).
This document only covers what is genuinely new for surgical-reads.

---

## R1 — Module placement (one folder vs. two)

**Decision**: Create one folder, `src/tools/surgical-reads/`, that holds
both tools. Each tool gets its own handler file inside that folder
(`handler-heading.ts`, `handler-frontmatter.ts`); the schemas live
together in `schema.ts` and the `Tool[]` registration entries together
in `tool.ts`.

**Rationale**:

- The two tools share an import (the `isValidHeadingPath` predicate
  reused from feature 001 — see R2). A shared folder makes the shared
  import natural without dragging in a second cross-folder dependency.
- The two tools ship together, are tested together, and are described
  together in this spec. Splitting them into `get-heading-contents/`
  and `get-frontmatter-field/` would create two release units where
  there is one.
- Constitution Principle I requires "small, single-purpose modules with
  explicit boundaries." Each file inside this folder still has a single
  purpose — the schemas file declares two zod schemas plus their
  asserters; each handler file wraps exactly one tool. The folder
  itself is the "module" boundary, the same way `src/tools/patch-content/`
  is for feature 001.

**Alternatives considered**:

- **Two separate folders** (`get-heading-contents/`,
  `get-frontmatter-field/`): Would mirror the
  one-folder-per-tool precedent of `patch-content/`. Rejected because
  the two tools are co-released and share the validator import; two
  folders would mean a four-file scaffold per tool (8 files total) for
  what is genuinely one feature surface.
- **A single flat file** (`surgical-reads.ts` like the legacy
  `file-tools.ts`): Rejected because each tool needs its own zod
  schema, asserter, and handler — a single file would be ~200 lines
  with no separation of concerns.

**Confidence**: high.

---

## R2 — Validator reuse (sibling import vs. shared module)

**Decision**: Import `isValidHeadingPath` (and the `HEADING_RULE`
string) directly from `'../patch-content/schema.js'` in
`src/tools/surgical-reads/schema.ts`. Do NOT hoist the predicate to a
new shared module.

**Rationale**:

- Spec FR-003 requires the validator to be the same structural rule
  used by `patch_content`, with "no second source of truth." A direct
  import achieves that with one line of code.
- Hoisting `isValidHeadingPath` to (e.g.) `src/tools/_shared/heading-path.ts`
  would touch `patch-content/schema.ts` and its tests
  (which import `isValidHeadingPath` directly from the patch-content
  schema module). That refactor is a strict superset of what this
  feature needs — it widens the change set, increases review burden,
  and risks a backward-incompatible shift if any external consumer
  (none today, but the file is exported from a published npm package)
  imports the predicate from the patch-content path.
- A sibling tool→tool import is not a Constitution Principle I
  violation. The principle prohibits *upward or cyclic* dependencies
  (tool → service → client → SDK is the canonical direction); a
  sibling import that goes through neither the service nor SDK is
  horizontal, not upward, and there is no cycle (patch-content does
  not import surgical-reads).
- If a third heading-targeted tool is added later, that is the right
  moment to hoist the predicate — at three call sites the shared
  module pays for itself. At two it does not.

**Alternatives considered**:

- **Hoist to `src/tools/_shared/heading-path.ts` now** and have both
  feature 001 and feature 003 import from it: cleaner long-term, but
  retroactively refactors feature 001 within feature 003's PR.
  Deferred until a third caller justifies it.
- **Re-implement the predicate inside `surgical-reads/schema.ts`**:
  directly violates FR-003. Rejected.

**Confidence**: high. Trivial to revisit when the third call site appears.

---

## R3 — Heading endpoint Content-Type and response handling

**Decision**: Send `Accept: text/markdown` to the upstream
`GET /vault/{path}/heading/{path-segments}` endpoint. Treat the response
body as a raw markdown string and surface it on the MCP output's
standard `content[0].text` slot, unmodified.

**Rationale**:

- Spec Clarifications session 2026-04-26 Q1 explicitly chose
  Option A: request `text/markdown` and return the raw heading-body
  markdown as a single string. The reasoning is recorded there:
  the "surgical reads" framing requires minimum-payload responses;
  the JSON envelope (`application/vnd.olrapi.note+json`) reintroduces
  metadata that defeats the framing.
- The existing `getFileContents` method on `ObsidianRestService` (see
  [src/services/obsidian-rest.ts:74-82](../../src/services/obsidian-rest.ts#L74-L82))
  already establishes the pattern: `Accept: text/markdown`,
  `responseType: 'text'`, return `response.data` as `string`. The new
  `getHeadingContents` method follows the same pattern.
- An empty-body 200 response from the upstream is passed to the caller
  verbatim (per spec Edge Cases: "the upstream plugin's empty-body
  response is passed to the caller verbatim; the wrapper does not
  synthesize a 'not found' error from an empty body"). axios with
  `responseType: 'text'` returns `''` for an empty body, which becomes
  `{ content: [{ type: 'text', text: '' }] }` — well-formed and
  unambiguous.

**Alternatives considered**:

- **`Accept: application/vnd.olrapi.note+json`**: explicitly rejected
  in spec clarification — would forward metadata the spec says must
  not be included.
- **Make the Accept type a tool argument**: also rejected in spec
  clarification (Option C in Q1). Adds an axis the use case does not
  justify.
- **Use `responseType: 'arraybuffer'` and base64-encode**: would let
  the wrapper handle non-UTF-8 vault content. Out of scope; the
  upstream is markdown-only, and no existing tool deals with binary
  payloads.

**Confidence**: high.

---

## R4 — Frontmatter endpoint response shape and decoding

**Decision**: `GET /vault/{path}/frontmatter/{field}` returns the
field's value as a JSON document. The wrapper requests the upstream's
default response (no explicit `Accept` header beyond what axios sends),
calls `JSON.parse` on the response body, and surfaces the decoded value
on the MCP tool's output as `{ value: <decoded> }`, JSON-stringified
into `content[0].text`.

**Rationale**:

- Spec Clarifications session 2026-04-26 Q2 explicitly chose
  Option B: parse the upstream JSON body and expose it as a typed
  value on the MCP output (`{ value: <any JSON> }`). The clarification
  records the wording for the tool description and the no-coercion
  rule.
- The decoded value preserves the original frontmatter type (string,
  number, boolean, array, object, `null`). A frontmatter `count: 5`
  reaches the caller as the JSON number `5`, not the string `"5"`.
  This avoids the "JSON-encoded string of a number" ambiguity that
  Option A would have introduced.
- The wrapper's `JSON.parse` is the only "decoding" anywhere in this
  feature. It does not constitute "client-side parsing of the target
  file" (which spec Assumptions explicitly forbids) — the upstream
  did the YAML→JSON work; the wrapper is just deserializing the JSON
  envelope the upstream emits over the wire. No YAML, no markdown
  parsing.
- The `JSON.stringify({ value: <decoded> })` envelope keeps the output
  consistent with the existing project convention for object-valued
  tool outputs (`searchJson`, `getRecentChanges`, etc., which all
  `JSON.stringify(results, null, 2)` into `content[0].text`). The
  caller parses `content[0].text` once to recover the typed value.

**Alternatives considered**:

- **Return the upstream body as opaque text** (Option A in spec Q2):
  rejected in clarification — strips type info, forces agents to
  re-parse JSON, contradicts the "verbatim pass-through" framing
  given that the upstream is already JSON.
- **Use the MCP `structuredContent` field on `CallToolResult`**: the
  MCP spec supports this for typed outputs without wrapping them in
  text. Rejected for this feature because no other tool in this
  project uses `structuredContent`; introducing it for one tool would
  create an inconsistency. Revisitable if/when the project moves to
  `structuredContent` across the board.
- **Return only the raw JSON string** (no `{ value: ... }`
  envelope): would make `null` indistinguishable from "tool returned
  nothing." The envelope is one extra key but disambiguates.

**Confidence**: high.

---

## R5 — Timeout and retry policy

**Decision**: Inherit the existing `axios.create({ timeout: 10000 })`
in `ObsidianRestService` (see
[src/services/obsidian-rest.ts:27](../../src/services/obsidian-rest.ts#L27)).
Add **no** retry logic.

**Rationale**:

- Matches the established project convention. `getFileContents`,
  `search`, `patchContent`, etc. — none retry.
- GET is idempotent so transport-error retries would be safe in
  principle, but adding retries here while the rest of the codebase
  has none would be an inconsistency. If a project-wide retry policy
  is wanted, that is a separate change.
- Spec Story 4 ("Surface upstream errors verbatim") and FR-009
  explicitly require errors to propagate to the caller; a retry layer
  would muddy that contract.

**Alternatives considered**:

- **Single retry on `ECONNRESET` / network errors**: deferred. Would
  help genuinely transient cases but adds complexity for two new
  tools that follow the wider convention.

**Confidence**: high.

---

## R6 — Error format for wrapper-side validation rejections

**Decision**: For `get_heading_contents`, reuse the `patch_content`
heading-rule error format verbatim — same rule statement, same
`received: "<offending>"` clause, same `e.g., "<corrected>"` example.
This satisfies spec FR-004's explicit "must match `patch_content`'s
bare-heading-rejection error" requirement.

For `get_frontmatter_field`, the only wrapper-side rejection is
empty/whitespace `field`. Use zod's own `min(1)` plus a custom
`.refine()` that rejects whitespace-only strings; the zod error message
already names the offending field path, satisfying Constitution
Principle III's "field paths reported by zod" requirement. No path-rule
analogue exists for that tool.

**Rationale**:

- FR-004 says the heading-rule error semantics MUST match `patch_content`
  so callers see one consistent rule across read and write tools.
  Importing the same predicate plus replicating the same throw
  statement gives literal parity, which the test suite asserts via
  the same three-substring check (`heading targets must use the full
  H1::H2[::H3...] path`, `received: "..."`, `e.g., "..."`).
- The frontmatter tool has nothing analogous to the heading-path rule;
  generic zod errors are the right tool for "field name is empty or
  whitespace."

**Alternatives considered**:

- **Hoist the heading-rule error message into the shared module**
  along with the predicate: same trade-off as R2; deferred until a
  third call site.
- **Use a custom error class** (e.g., `HeadingPathRejectError`):
  diverges from the existing project pattern (everything throws
  `Error`, top-level handler renders `Error: <message>`). No benefit
  here.

**Confidence**: high.

---

## R7 — Logging / observability

**Decision**: Inherit existing convention. The top-level handler in
[src/index.ts:253](../../src/index.ts#L253) already does
`console.error('Tool ${name} failed:', message)` for any thrown error.
No additional logging at the wrapper layer.

**Rationale**:

- Same disposition as feature 001's R7 — the project does not yet
  expose structured logging, metrics, or tracing; introducing them
  here would be inconsistent and out of scope.
- The clarification phase explicitly deferred observability to plan
  time, and at plan time the decision is "match what already exists"
  rather than "introduce something new."

**Alternatives considered**: same as feature 001's R7. Same conclusions.

**Confidence**: high.

---

## R8 — URL-encoding of path components

**Decision**: For both endpoints, use `encodeURIComponent` on each path
component independently. Specifically:

- `getHeadingContents(filepath, headingPath)`:
  - Path component: `encodeURIComponent(filepath)` for `{path}`.
  - Path-segments component: split `headingPath` on `::`, then
    `encodeURIComponent` each segment, then re-join with `/` — because
    the upstream URL is `GET /vault/{path}/heading/{seg1}/{seg2}/...`
    where each segment is its own URL path segment. (This is the
    documented format of the upstream Local REST API plugin's heading
    endpoint.)
- `getFrontmatterField(filepath, field)`:
  - Path component: `encodeURIComponent(filepath)` for `{path}`.
  - Field component: `encodeURIComponent(field)` for `{field}`.

**Rationale**:

- `encodeURIComponent` is the standard browser/Node primitive for
  encoding URL path components. It encodes `/`, `?`, `#`, spaces, and
  non-ASCII characters — exactly the set that would otherwise corrupt
  the URL.
- For heading targets, splitting on `::` BEFORE encoding (rather than
  encoding the whole `Header1::Header2` string and forwarding as one
  blob) is required because the upstream URL grammar uses `/` between
  segments, not `::`. The structural validator runs before the split,
  so by the time we encode, we know there are ≥ 2 non-empty segments.
- The existing `patchContent` method uses `encodeURIComponent(target)`
  on the whole target as a header value (see
  [src/services/obsidian-rest.ts:163](../../src/services/obsidian-rest.ts#L163)),
  but that endpoint puts the target in an HTTP header, not the URL
  path. The two endpoints have different conventions; we follow each
  endpoint's convention.

**Alternatives considered**:

- **Pass `headingPath` to the upstream as `headerN` with `::`
  preserved**: would not match the upstream's URL grammar. Would 404.
- **Use `encodeURI` instead of `encodeURIComponent`**: too permissive
  — does not encode `?`, `#`, `/`, which would break the URL when a
  segment contains them.

**Confidence**: high. Tested via the URL-encoding cases in the
contract test matrix (heading segment containing `/`, filepath
containing space, field name containing `:`).

---

## Summary

| Topic | Decision |
|---|---|
| Module placement | One folder (`src/tools/surgical-reads/`) for both tools |
| Validator reuse | Sibling import from `patch-content/schema.ts`; no shared module yet |
| Heading endpoint Accept | `text/markdown`; return raw body as MCP text content |
| Frontmatter endpoint decoding | `JSON.parse(response.data)`; surface as `{ value: <decoded> }` JSON-stringified into MCP text content |
| Timeout / retry | Existing 10 s axios default; no retry (project-wide convention) |
| Wrapper-side error format (heading) | Identical to `patch_content`: rule statement + `received: "..."` + `e.g., "..."` |
| Wrapper-side error format (frontmatter) | zod's own field-path message |
| Logging | Existing top-level `console.error`; no new instrumentation |
| URL-encoding | `encodeURIComponent` per path component, split heading on `::` then encode each segment |

No `NEEDS CLARIFICATION` items remain.
