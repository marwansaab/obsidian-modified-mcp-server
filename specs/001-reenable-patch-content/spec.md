# Feature Specification: Re-enable patch_content with Heading-Path Validation

**Feature Branch**: `001-reenable-patch-content`
**Created**: 2026-04-26
**Status**: Draft
**Input**: User description: "Re-enable the patch_content MCP tool with a precondition validator that requires heading targets to use the full H1::H2::H3 path separator format. Reject bare-heading targets at the wrapper boundary with a clear error message that points the caller to the path rule."

## Clarifications

### Session 2026-04-26

- Q: How should the wrapper handle `::` characters that appear inside the
  literal text of a heading (e.g., a heading actually named `C++::primer`)?
  → A: Option D — thin pass-through. The validator only counts
  `::`-separated segments (≥ 2 non-empty); the target string is forwarded
  verbatim to the upstream plugin. Headings whose literal text contains
  `::` are unreachable through this tool, and that limitation is stated
  explicitly in the tool's MCP description so callers see it at
  tool-discovery time rather than learning about it from an upstream
  "not found" error.
- Q: How should callers target a top-level heading (one with no parent)?
  → A: Option A — top-level headings are unreachable through this tool,
  exactly the same disposition as literal-`::` headings. The validator
  stays purely structural: it requires ≥ 2 non-empty `::`-separated
  segments uniformly. The wrapper introduces no escape or sentinel
  syntax. Callers needing to mutate top-level headings use alternative
  tools (e.g., `get_file_contents` + `put_content`). The MCP tool
  description states this limitation alongside the literal-`::` one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Patch under a uniquely-pathed heading (Priority: P1)

An LLM agent maintaining a knowledge note needs to append a new bullet to the
"## Action Items" subsection that lives under the "# Weekly Review" top-level
heading. There are several "Action Items" subsections in the same note (one per
weekly review), so an unqualified heading target would be ambiguous. The agent
specifies the full heading path and the new bullet lands in the intended
section.

**Why this priority**: This is the core value of the tool. Without it, agents
must read the entire file, mutate the markdown locally, and rewrite the whole
file (the current `get_file_contents` + `put_content` workaround), which is
slower, racier, and more destructive.

**Independent Test**: Send a patch request whose target is the full path of a
heading that exists exactly once in the note. The note's content under that
specific heading is updated; no other section is touched.

**Acceptance Scenarios**:

1. **Given** a note containing two "Action Items" subsections under different
   parent headings, **When** the agent submits a patch with a heading target
   identifying the full path of one of them, **Then** content is inserted
   under that exact subsection and the other subsection is untouched.
2. **Given** a note with the target heading at the requested path, **When**
   the agent submits a patch with operation "append", "prepend", or "replace",
   **Then** the patch is applied with the requested semantics and the response
   confirms success.

---

### User Story 2 - Reject bare-heading targets up-front (Priority: P1)

An agent (or a poorly-prompted developer) submits a patch whose heading target
is a single heading name (no path separators), unaware of the ambiguity risk.
The request is rejected immediately, before any HTTP call to the upstream
plugin, with an error message that explains the H1::H2::H3 path rule and
shows the caller how to fix the target.

**Why this priority**: This is the safety property that justifies re-enabling
a tool whose upstream had known disambiguation bugs. Without up-front
rejection, ambiguous targets reach the upstream plugin and may silently patch
the wrong section — exactly the failure mode that caused the tool to be
disabled previously.

**Independent Test**: Send a patch whose target type is "heading" and whose
target value contains no path separator. The wrapper returns a structured
error naming the path rule, and no network call to the upstream plugin
occurs.

**Acceptance Scenarios**:

1. **Given** a patch request with `targetType=heading` and a bare heading
   name like `"Action Items"`, **When** the wrapper validates the input,
   **Then** the request is rejected with an error that (a) names the rule
   ("heading targets must use the full H1::H2::H3 path") and (b) shows a
   correctly-formed example based on the submitted value.
2. **Given** a patch request with `targetType=heading` and a target that uses
   a wrong separator (e.g., a single colon `H1:H2`, or `>` instead of `::`),
   **When** the wrapper validates the input, **Then** the request is
   rejected with the same path-rule message.

---

### User Story 3 - Surface upstream errors verbatim (Priority: P2)

An agent submits a well-formed patch, but the upstream Local REST API plugin
returns an error (target heading not found, vault path missing, plugin
unreachable, authentication failure). The error reaches the caller with the
upstream status code and message preserved, so the agent can decide whether
to retry, escalate, or rethink its plan.

**Why this priority**: Per the project constitution (Principle IV), errors
from upstream systems must propagate explicitly, not be swallowed or replaced
with empty/default results. The wrapper layer is the chain of custody for the
caller.

**Independent Test**: Stub the upstream plugin to return a non-2xx response.
The MCP error returned to the caller includes the upstream status code and
the upstream error message.

**Acceptance Scenarios**:

1. **Given** a patch request whose target heading does not exist in the note,
   **When** the upstream plugin returns 404, **Then** the MCP response is a
   structured error containing the upstream 404 status and the upstream
   message.
2. **Given** the Local REST API plugin is unreachable, **When** the wrapper
   attempts the request, **Then** the MCP response is a structured error
   identifying that the upstream is unreachable, with the underlying error
   class.

---

### Edge Cases

- **Bare heading rejected even if it would happen to be unique**: The
  validator is purely structural; it does not consult the note. A bare
  heading is rejected even if the note in fact has only one heading by that
  name. Rationale: the caller's intent must be unambiguous from the request
  alone; the rule cannot be relaxed conditionally without re-introducing the
  failure mode.
- **Top-level headings are unreachable through this tool**: any heading at
  the document's top level (no parent) cannot be targeted, because the
  validator requires ≥ 2 non-empty `::`-separated segments and the wrapper
  introduces no escape or sentinel syntax. Single-segment values like
  `"Action Items"` are rejected as bare; values like `"::Action Items"` or
  `"Action Items::"` produce an empty segment and are rejected as
  malformed. Callers needing to mutate a top-level heading must use
  alternative tools (e.g., `get_file_contents` + `put_content`). This
  limitation is stated in the tool's MCP description so callers see it
  at tool-discovery time.
- **Empty path segments**: `"Weekly Review::::Action Items"` (consecutive
  separators producing an empty segment) is rejected as malformed.
- **Whitespace-only target**: rejected.
- **Heading whose literal text contains `::`** (e.g., a heading actually
  named `C++::primer`): such headings are **unreachable** through this
  tool. The validator treats every `::` as a path separator; there is no
  escape syntax. Callers needing to mutate such headings must use
  alternative tools (e.g., `get_file_contents` + `put_content`) or
  rename the heading. This limitation is surfaced in the tool's MCP
  description so that callers see it at tool-discovery time.
- **Non-heading target types** (`block`, `frontmatter`): the heading-path
  validator does not apply; those target types pass through to the upstream
  plugin unchanged. They retain whatever validation the upstream provides.
- **Target heading exists at requested path but content is empty**: passed
  to upstream; upstream behavior is preserved.
- **Note path does not exist**: upstream returns 404; surfaced to caller per
  Story 3.
- **Concurrent edits**: out of scope; the tool is a thin pass-through and
  inherits whatever last-writer-wins behavior the upstream plugin exhibits.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The MCP server MUST register a tool named `patch_content` and
  return it in `tools/list` responses. The tool's MCP description MUST
  state explicitly that (a) heading targets require at least two
  non-empty segments separated by `::` (i.e., the full
  `H1::H2[::H3...]` path form), (b) top-level headings (no parent) are
  therefore unreachable through this tool, and (c) headings whose
  literal text contains `::` are also unreachable. This makes all three
  constraints visible to the caller at tool-discovery time, not only at
  request time.
- **FR-002**: The `patch_content` tool MUST accept the following inputs:
  note path, operation (one of: append, prepend, replace), target type (one
  of: heading, block, frontmatter), target value, content payload, and
  optional vault identifier.
- **FR-003**: When `targetType=heading`, the tool MUST validate the target
  value against the heading-path rule (multiple non-empty segments separated
  by `::`) **before** issuing any network call to the upstream plugin.
- **FR-004**: A heading target that fails the rule MUST produce a structured
  error whose message (a) names the rule, (b) cites the offending input,
  and (c) shows a suggested corrected form using the submitted value.
- **FR-005**: A heading target that satisfies the rule MUST be forwarded to
  the upstream plugin's content-patch endpoint with the operation, target
  type, target value, and content payload conveyed via the upstream's
  documented headers and body conventions.
- **FR-006**: When `targetType` is `block` or `frontmatter`, the tool MUST
  forward the request to the upstream plugin without applying the
  heading-path validator. Other input validation (presence of required
  fields, type checks) still applies.
- **FR-007**: The tool MUST surface upstream errors as structured MCP
  errors that preserve the upstream status code (when present) and the
  upstream error message. The tool MUST NOT replace upstream failures with
  empty success responses, default values, or `null`.
- **FR-008**: All input parsing and validation MUST be performed once at
  the tool wrapper boundary; downstream code receives already-validated
  values.
- **FR-009**: The tool MUST have automated tests covering at minimum: a
  happy-path heading patch, a bare-heading rejection, an empty-segment
  rejection, a non-heading target pass-through, and an upstream-error
  propagation. Tests do not call a real Obsidian instance; the upstream
  plugin is mocked at the HTTP layer.
- **FR-010**: The tool's published input schema and the runtime validator
  MUST originate from a single source — they cannot drift apart.

### Key Entities

- **Patch request**: A unit of work composed of {note path, operation,
  target type, target value, content payload, vault identifier?}.
- **Heading path target**: A target value of the form
  `Segment1::Segment2[::Segment3...]` where each segment is the literal
  text of a heading at that nesting level. The separator `::` is fixed
  and matches the upstream plugin's documented convention.
- **Upstream patch response**: Either a 2xx confirmation or an error
  carrying a status code and a message.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of patch requests with `targetType=heading` and a
  target lacking the `::` path separator are rejected at the wrapper
  boundary, with zero requests reaching the upstream plugin in that case.
- **SC-002**: 100% of patch requests with a structurally valid heading
  path are forwarded to the upstream plugin and (when the target exists)
  succeed.
- **SC-003**: 100% of upstream non-2xx responses are surfaced to the
  caller with the upstream status code and message preserved (zero
  silent fallbacks to empty success).
- **SC-004**: A caller who submits a bare-heading target can read the
  returned error and produce a correctly-formed retry on the first
  attempt without needing to consult external documentation. Verified by
  inspecting the error message: it must (a) name the rule, (b) cite the
  offending value, and (c) show a corrected example.
- **SC-005**: The tool is added to the registered MCP tool list and
  appears in the public surface; agents listing tools see it.

## Assumptions

- The previously-disabled `patch_content` tool was disabled because of
  ambiguity in heading targeting (see upstream issue
  `coddingtonbear/obsidian-local-rest-api#146`). Requiring full heading
  paths at the wrapper boundary is the chosen mitigation; we are not
  attempting to fix the upstream plugin or implement client-side
  disambiguation by reading the note first.
- The upstream Local REST API plugin's heading-path syntax uses `::` as
  the segment separator. This is treated as fixed; the wrapper does not
  attempt to translate alternative separator conventions.
- The wrapper introduces **no escape syntax** for the `::` separator.
  Headings whose literal text contains `::` are out of scope for this
  tool. Rationale: an escape mechanism would diverge from the upstream
  API surface, require its own validator and test matrix, and create a
  second source of truth for what targets are addressable.
- The validator requires **at least two non-empty `::`-separated
  segments**, uniformly. This means top-level headings (no parent)
  cannot be targeted through this tool — same disposition as headings
  whose literal text contains `::`. Rationale: the rule must remain
  purely structural; any single-segment exception would either
  re-introduce the upstream disambiguation failure mode (when the same
  heading text appears at multiple nesting levels) or require
  wrapper-side disambiguation logic that contradicts the
  thin-pass-through decision.
- `block` and `frontmatter` target types are out of scope for new
  validation; they continue to work exactly as the upstream plugin
  supports.
- `append_content` and `put_content` remain as their own tools and are
  unaffected. `patch_content` is additive — it exists for surgical
  in-place edits relative to a target, which the other two tools cannot
  express.
- Tests use a mock HTTP server (the existing repo currently has no test
  infrastructure; one will be added as part of this work). The exact
  mock library is a plan-phase decision.
- Authentication, base URL resolution, and multi-vault routing follow
  the same conventions as the existing tools — no new configuration
  surface is added.
