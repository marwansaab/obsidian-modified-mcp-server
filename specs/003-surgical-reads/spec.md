# Feature Specification: Surgical Reads — Heading-Body and Frontmatter-Field MCP Tools

**Feature Branch**: `003-surgical-reads`
**Created**: 2026-04-26
**Status**: Draft
**Input**: User description: "Add Surgical Reads — Two new MCP tools that fetch part of a vault note instead of the whole file. The first tool, `get_heading_contents`, takes a filepath and a heading target and returns the body content under that heading. It MUST apply the same structural-only path validator established for `patch_content` in ADR-001 (vault-side note: `200-Decisions/ADR-001 - Wrapper Path-Validator Structural-Only.md`): heading targets must be path-shaped with at least two non-empty `::`-separated segments. Headings whose literal text contains `::` and top-level-only headings remain unreachable through this tool, with the same documented fallback to read-modify-write via `get_file_contents`. The validator and its constraints are stated in the MCP tool description so the limitation is visible in the tool schema. The second tool, `get_frontmatter_field`, takes a filepath and a single field name and returns just that frontmatter field's value. Both tools forward the validated request verbatim to the upstream Local REST API plugin's `GET /vault/{path}/heading/{path-segments}` and `GET /vault/{path}/frontmatter/{field}` endpoints. No client-side parsing of the target file is performed."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read just the body under one heading (Priority: P1)

An LLM agent maintaining a knowledge note needs the current contents of the
"## Action Items" subsection that lives under the "# Weekly Review" top-level
heading. There are several "Action Items" subsections in the same note (one
per weekly review), so an unqualified heading name would be ambiguous. The
agent specifies the full heading path and receives back only the body lines
under that exact subsection, without the rest of the note.

**Why this priority**: This is the core value of the read-side surgical tools.
Without it, agents must fetch the entire note via `get_file_contents`, parse
the markdown locally to find the right heading, and slice it themselves —
which is slower (full-note transfer), more expensive in context tokens, and
shifts markdown-parsing responsibility onto the wrapper layer that ADR-001
explicitly avoids.

**Independent Test**: Send a `get_heading_contents` request whose target is
the full path of a heading that exists exactly once in the note. The response
contains exactly the body content under that specific heading; no other
section's text appears.

**Acceptance Scenarios**:

1. **Given** a note containing two "Action Items" subsections under different
   parent headings, **When** the agent requests `get_heading_contents` with a
   heading target identifying the full path of one of them, **Then** the
   response is exactly the body under that subsection and the other
   subsection's body is not included.
2. **Given** a note with the target heading at the requested path, **When**
   the agent requests `get_heading_contents`, **Then** the response is the
   raw body text the upstream plugin returns for that heading, with no
   wrapper-side reformatting, trimming, or transformation.

---

### User Story 2 - Reject bare-heading targets up-front (Priority: P1)

An agent (or a poorly-prompted developer) requests `get_heading_contents`
with a heading target that is a single heading name (no path separators),
unaware of the ambiguity risk. The request is rejected immediately, before
any HTTP call to the upstream plugin, with an error message that explains
the `H1::H2::H3` path rule and shows the caller how to fix the target.

**Why this priority**: This is the safety property that justifies pairing a
read tool with the same validator chosen for `patch_content` in ADR-001.
Without up-front rejection, ambiguous targets reach the upstream plugin and
may silently return the body of a different section than the caller intended
— the read-side analogue of the failure mode that caused `patch_content` to
be disabled previously. Read-side ambiguity is just as harmful: an agent
that reads the wrong section and acts on it is indistinguishable, from the
user's perspective, from one that wrote to the wrong section.

**Independent Test**: Send a `get_heading_contents` request whose target
contains no `::` separator. The wrapper returns a structured error naming
the path rule, and no network call to the upstream plugin occurs.

**Acceptance Scenarios**:

1. **Given** a `get_heading_contents` request with a bare heading name like
   `"Action Items"`, **When** the wrapper validates the input, **Then** the
   request is rejected with an error that (a) names the rule ("heading
   targets must use the full `H1::H2::H3` path"), (b) cites the offending
   value, and (c) shows a suggested corrected form.
2. **Given** a `get_heading_contents` request whose target uses a wrong
   separator (e.g., a single colon `H1:H2`, or `>` instead of `::`),
   **When** the wrapper validates the input, **Then** the request is
   rejected with the same path-rule message.
3. **Given** a `get_heading_contents` request whose target contains a `::`
   but produces an empty segment (e.g., `"Weekly Review::::Action Items"`,
   `"::Action Items"`, or `"Action Items::"`), **When** the wrapper
   validates the input, **Then** the request is rejected as malformed
   with the same path-rule message.

---

### User Story 3 - Read one frontmatter field (Priority: P1)

An agent needs the value of a single frontmatter field — for instance, the
`status` field of a project note — to decide what to do next. Fetching the
entire note just to parse YAML out of it would burn context tokens and
duplicate parsing logic the upstream plugin already exposes. The agent
requests `get_frontmatter_field` with the note path and the field name, and
receives back just that field's value as the upstream plugin returns it.

**Why this priority**: This is the second core value of the surgical-reads
feature. It is independently shippable from the heading tool: the
frontmatter-field path has no heading-path validator dependency and uses a
different upstream endpoint. Either tool delivers value alone.

**Independent Test**: Send a `get_frontmatter_field` request for a note that
has the requested field. The response contains exactly that field's value
as the upstream plugin returns it; no other frontmatter keys appear.

**Acceptance Scenarios**:

1. **Given** a note whose frontmatter contains a `status` field with value
   `"in-progress"`, **When** the agent requests `get_frontmatter_field` with
   `field=status`, **Then** the response is the upstream plugin's
   representation of that field's value, and other frontmatter keys are
   not included.
2. **Given** a request whose `field` argument is empty or whitespace-only,
   **When** the wrapper validates the input, **Then** the request is
   rejected at the wrapper boundary with a structured error and no
   network call is made.

---

### User Story 4 - Surface upstream errors verbatim (Priority: P2)

An agent submits a well-formed surgical-read request, but the upstream Local
REST API plugin returns an error: target heading not found at the requested
path, frontmatter field absent from the note, vault path missing, plugin
unreachable, or authentication failure. The error reaches the caller with
the upstream status code and message preserved, so the agent can decide
whether to retry, escalate, or fall back to `get_file_contents` and parse
the note itself.

**Why this priority**: Per the project constitution (Principle IV), errors
from upstream systems must propagate explicitly, not be swallowed or
replaced with empty/default results. For read tools this is especially
load-bearing: an empty string returned for a missing field is
indistinguishable from a present-but-empty field, and would invite the
agent to act on a wrong assumption.

**Independent Test**: Stub the upstream plugin to return a non-2xx
response. The MCP error returned to the caller includes the upstream
status code and message.

**Acceptance Scenarios**:

1. **Given** a `get_heading_contents` request whose target heading path
   does not exist in the note, **When** the upstream plugin returns 404,
   **Then** the MCP response is a structured error containing the upstream
   404 status and message (not an empty-body success).
2. **Given** a `get_frontmatter_field` request for a field name that does
   not exist in the note's frontmatter, **When** the upstream plugin
   returns its documented "field not found" response, **Then** the MCP
   response is a structured error preserving the upstream status code and
   message (not `null`, not an empty string).
3. **Given** the Local REST API plugin is unreachable, **When** the wrapper
   attempts the request, **Then** the MCP response is a structured error
   identifying that the upstream is unreachable, with the underlying error
   class.

---

### Edge Cases

- **Bare heading rejected even if it would happen to be unique**: The
  validator is purely structural; it does not consult the note. A bare
  heading is rejected even if the note in fact has only one heading by
  that name. Rationale (inherited from ADR-001): the caller's intent
  must be unambiguous from the request alone; the rule cannot be relaxed
  conditionally without re-introducing the failure mode.
- **Top-level headings are unreachable through `get_heading_contents`**:
  any heading at the document's top level (no parent) cannot be targeted,
  because the validator requires ≥ 2 non-empty `::`-separated segments
  and the wrapper introduces no escape or sentinel syntax. Single-segment
  values like `"Action Items"` are rejected as bare; values like
  `"::Action Items"` or `"Action Items::"` produce an empty segment and
  are rejected as malformed. Callers needing the body under a top-level
  heading must fall back to `get_file_contents` and slice the note
  themselves. This limitation is stated in the tool's MCP description so
  callers see it at tool-discovery time.
- **Heading whose literal text contains `::`** (e.g., a heading actually
  named `C++::primer`): such headings are **unreachable** through
  `get_heading_contents`. The validator treats every `::` as a path
  separator; there is no escape syntax. Callers needing the body under
  such a heading must fall back to `get_file_contents` (or rename the
  heading). This limitation is surfaced in the tool's MCP description.
- **Heading exists at the requested path but its body is empty**: the
  upstream plugin's empty-body response is passed to the caller verbatim;
  the wrapper does not synthesize a "not found" error from an empty body.
- **Frontmatter field is present but holds a structured value** (list,
  object, boolean, number): the wrapper returns whatever representation
  the upstream plugin emits. The wrapper does not coerce, stringify, or
  re-encode the value.
- **Frontmatter field is present but holds `null`**: the upstream plugin's
  representation of `null` is passed through unchanged. The wrapper does
  not collapse `null` into "missing".
- **Note path contains characters that need URL-encoding** (spaces,
  `#`, `?`, non-ASCII): the wrapper encodes the path component for the
  outgoing URL but does not otherwise transform the caller's value.
  This applies to both tools.
- **Heading path contains characters that need URL-encoding** (spaces,
  `/`, `#`, `?`): the wrapper percent-encodes each `::`-separated
  segment as required by the upstream URL convention, after structural
  validation has already passed. The wrapper does not reinterpret `::`
  as anything other than the segment separator.
- **Frontmatter field name contains characters that need URL-encoding**:
  the wrapper percent-encodes the field name for the outgoing URL.
- **Note path does not exist** or is not a markdown file: upstream
  returns its documented error; surfaced to the caller per Story 4.
- **Concurrent edits to the note while reading**: out of scope; the tools
  are thin pass-throughs and inherit whatever read-isolation behavior the
  upstream plugin exhibits. No client-side caching is added.
- **Write tools are not affected**: `patch_content`, `append_content`,
  `put_content`, and `get_file_contents` continue to work as before.
  These two read tools are additive.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The MCP server MUST register a tool named
  `get_heading_contents` and return it in `tools/list` responses. Its MCP
  description MUST state explicitly that (a) heading targets require at
  least two non-empty segments separated by `::` (i.e., the full
  `H1::H2[::H3...]` path form), (b) top-level headings (no parent) are
  therefore unreachable through this tool, (c) headings whose literal text
  contains `::` are also unreachable, and (d) the documented fallback for
  both unreachable-heading cases is `get_file_contents` followed by
  client-side slicing. This makes all four points visible to the caller at
  tool-discovery time.
- **FR-002**: `get_heading_contents` MUST accept these inputs: note
  filepath (required, non-empty string), heading target (required,
  non-empty string), and an optional vault identifier following the
  same convention as the existing tools.
- **FR-003**: `get_heading_contents` MUST validate the heading target
  against the heading-path rule (at least two non-empty `::`-separated
  segments) **before** issuing any network call to the upstream plugin.
  The validator MUST be the same structural rule used by `patch_content`
  per ADR-001 — no second source of truth.
- **FR-004**: A heading target that fails the rule MUST produce a
  structured error whose message (a) names the rule, (b) cites the
  offending input, and (c) shows a suggested corrected form using the
  submitted value. The error semantics MUST match `patch_content`'s
  bare-heading-rejection error so callers see one consistent rule across
  read and write tools.
- **FR-005**: A heading target that satisfies the rule MUST be forwarded
  to the upstream plugin's `GET /vault/{path}/heading/{path-segments}`
  endpoint, with the note path URL-encoded as the `{path}` component and
  each `::`-separated segment URL-encoded as part of the
  `{path-segments}` component. The wrapper MUST NOT parse the target
  note's content client-side.
- **FR-006**: The MCP server MUST register a tool named
  `get_frontmatter_field` and return it in `tools/list` responses. Its
  MCP description MUST state that it returns a single field's value as
  the upstream plugin emits it (no client-side coercion), and that
  missing fields surface as structured errors rather than empty values.
- **FR-007**: `get_frontmatter_field` MUST accept these inputs: note
  filepath (required, non-empty string), field name (required, non-empty
  string after trimming whitespace), and an optional vault identifier
  following the same convention as the existing tools.
- **FR-008**: `get_frontmatter_field` MUST forward valid requests to the
  upstream plugin's `GET /vault/{path}/frontmatter/{field}` endpoint,
  with the note path URL-encoded as the `{path}` component and the field
  name URL-encoded as the `{field}` component. The wrapper MUST NOT
  parse the target note's frontmatter client-side.
- **FR-009**: Both tools MUST surface upstream errors as structured MCP
  errors that preserve the upstream status code (when present) and the
  upstream error message. Neither tool may replace upstream failures with
  empty success responses, default values, `null`, or empty strings.
- **FR-010**: All input parsing and validation for both tools MUST be
  performed once at the wrapper boundary; downstream code receives
  already-validated values.
- **FR-011**: Both tools MUST have automated tests covering at minimum:
  (a) for `get_heading_contents` — a happy-path heading read, a
  bare-heading rejection, an empty-segment rejection, an upstream-404
  propagation, and a URL-encoding case for special characters in the
  note path or a heading segment; (b) for `get_frontmatter_field` — a
  happy-path field read, an empty/whitespace field-name rejection, an
  upstream-error propagation for a missing field, and a URL-encoding
  case for special characters in the note path or field name. Tests MUST
  NOT call a real Obsidian instance; the upstream plugin MUST be mocked
  at the HTTP layer using the same approach established for
  `patch_content`.
- **FR-012**: Each tool's published input schema and runtime validator
  MUST originate from a single source — they cannot drift apart.
- **FR-013**: Authentication, base URL resolution, and multi-vault
  routing for both tools MUST follow the same conventions as the
  existing tools. No new configuration surface is added.

### Key Entities

- **Heading-read request**: A unit of work composed of {note filepath,
  heading target, vault identifier?}.
- **Heading path target**: A target value of the form
  `Segment1::Segment2[::Segment3...]` where each segment is the literal
  text of a heading at that nesting level. The separator `::` is fixed
  and matches the upstream plugin's documented convention. Defined
  identically in ADR-001 and reused here.
- **Frontmatter-field request**: A unit of work composed of {note
  filepath, field name, vault identifier?}.
- **Upstream read response**: Either a 2xx body (the raw heading body
  for `get_heading_contents`, or the field value for
  `get_frontmatter_field`) or an error carrying a status code and
  message. The wrapper does not interpret the body shape; it forwards
  the upstream payload to the caller.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of `get_heading_contents` requests with a heading
  target lacking the `::` path separator are rejected at the wrapper
  boundary, with zero requests reaching the upstream plugin in that case.
- **SC-002**: 100% of `get_heading_contents` requests with a structurally
  valid heading path are forwarded to the upstream plugin and (when the
  target exists) return the body content under that heading.
- **SC-003**: 100% of `get_frontmatter_field` requests with a non-empty,
  non-whitespace field name are forwarded to the upstream plugin and
  (when the field exists) return that field's value.
- **SC-004**: 100% of upstream non-2xx responses from either tool are
  surfaced to the caller with the upstream status code and message
  preserved (zero silent fallbacks to empty success, `null`, or empty
  string).
- **SC-005**: A caller who submits a bare-heading target to
  `get_heading_contents` can read the returned error and produce a
  correctly-formed retry on the first attempt without needing to
  consult external documentation. Verified by inspecting the error
  message: it must (a) name the rule, (b) cite the offending value,
  and (c) show a corrected example. The error wording is consistent
  with the equivalent error from `patch_content`.
- **SC-006**: Both tools appear in the registered MCP tool list and
  on the public surface; agents listing tools see them.
- **SC-007**: For a representative note where an agent needs only a
  single heading's body or a single frontmatter field, the surgical
  read returns strictly less data than the equivalent
  `get_file_contents` call would (measured by response payload size
  on at least one fixture per tool). This confirms the tools deliver
  the surgical-read value proposition rather than being equivalent to
  the existing whole-file read.

## Assumptions

- The same disambiguation hazard that motivated ADR-001 for
  `patch_content` (heading-path ambiguity in the upstream Local REST API
  plugin) applies symmetrically to reads: an unqualified heading name
  may match multiple sections, and the upstream plugin's resolution of
  that ambiguity is not guaranteed to align with caller intent. The
  structural validator is reused unchanged for that reason. ADR-001
  itself is the authoritative reference; no parallel decision record is
  introduced for the read side.
- The upstream Local REST API plugin exposes
  `GET /vault/{path}/heading/{path-segments}` and
  `GET /vault/{path}/frontmatter/{field}` with the semantics implied by
  their URL shapes. The exact request/response details (header
  conventions, content-type negotiation, body shape for structured
  frontmatter values) are taken as fixed by the upstream documentation
  and are a plan-phase concern, not a spec-phase concern.
- The wrapper introduces **no escape syntax** for the `::` separator in
  heading targets, and no client-side markdown or YAML parsing for
  either tool. Both choices follow ADR-001's thin-pass-through stance:
  any client-side parsing would create a second source of truth for
  what content the caller sees and reintroduce the divergence risk
  ADR-001 was written to avoid.
- The validator requires **at least two non-empty `::`-separated
  segments**, uniformly. Top-level headings (no parent) and headings
  whose literal text contains `::` are out of scope for
  `get_heading_contents`; the documented fallback is `get_file_contents`
  followed by client-side slicing. This is the same disposition
  ADR-001 records for `patch_content`.
- Tests reuse the HTTP-mock infrastructure introduced for
  `patch_content` (feature 001); no new mock library is selected here.
- Authentication, base URL resolution, and multi-vault routing follow
  the same conventions as the existing tools — no new configuration
  surface is added.
- Existing tools (`get_file_contents`, `patch_content`,
  `append_content`, `put_content`) are unaffected. The two new tools
  are additive: they exist for surgical reads relative to a heading
  path or a single frontmatter field, which the existing read tool
  cannot express without transferring and parsing the whole note.
