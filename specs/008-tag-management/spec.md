# Feature Specification: Tag Management

**Feature Branch**: `008-tag-management`
**Created**: 2026-04-28
**Status**: Draft
**Input**: User description: "Add Tag Management — three new MCP tools wrapping the upstream Local REST API plugin's `/tags/...` surface so an LLM caller can read Obsidian's authoritative tag index, list files by tag, and atomically rename/add/remove tags."

> **Scope reduction (2026-05-01)**: Phase 0 verification of the upstream
> Local REST API plugin (OpenAPI spec, release notes, plugin source on
> `main`) confirmed that only `GET /tags/` exists. Neither
> `GET /tags/{tagname}/` nor `PATCH /tags/{tagname}/` is implemented.
> Stories 2 (`get_files_with_tag`) and 3 (`tag_mutation`) — and the
> requirements, acceptance scenarios, success criteria, and clarifications
> that depended on them — are dropped from this feature and may be
> re-spec'd as a separate feature if/when upstream adds the endpoints.
> See [research.md](research.md) §R1 for the full evidence trail.

## Clarifications

### Session 2026-05-01

- Q: For successful upstream responses on `list_tags`, should the wrapper canonicalize the body into a stable wrapper-defined shape, or pass through verbatim? → A: Pass through the upstream success body verbatim (no reshaping); the observed shape is documented in plan/contracts against the upstream OpenAPI rather than re-imposed by the wrapper.
- Q: After Phase 0 verification revealed that `GET /tags/{tagname}/` and `PATCH /tags/{tagname}/` are not implemented upstream, what is the correct scope for this feature? → A: Reduce scope to User Story 1 (`list_tags`) only. Drop Stories 2 and 3, the dependent FRs (FR-003..FR-006, FR-009), success criteria (SC-003, SC-004), and edge cases that referenced the missing endpoints. Re-spec Stories 2 and 3 as a separate future feature contingent on upstream support.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read the authoritative tag index (Priority: P1)

An LLM caller is exploring an Obsidian vault and needs to know which tags
exist and how heavily each is used. The caller invokes `list_tags` and
receives the vault's complete tag index together with per-tag usage counts.
The result reflects Obsidian's own understanding of tags — both inline
(`#foo`) and YAML frontmatter tags are included, and tag-shaped strings that
appear inside fenced code blocks are excluded the same way Obsidian itself
excludes them.

**Why this priority**: Without a trustworthy way to enumerate tags, every
downstream tag operation is a guess. This story is the entry point for any
agent doing tag-driven navigation, audit, or cleanup, and it stands alone:
even without the originally-planned list-by-tag and mutation tools, an
agent can still use this read to decide what to do next via the existing
search/file tools. It is also the lowest-risk tool to ship (read-only, no
mutation surface).

**Independent Test**: Point the wrapper at a vault that contains a known
mix of inline tags, frontmatter tags, and tag-shaped strings inside fenced
code. Call `list_tags`. Verify (a) every real tag appears with a usage count
greater than zero, (b) every tag-shaped string that lives only inside a
fenced code block is absent, and (c) the result is non-empty. The story
delivers value the moment a caller can replace ad-hoc text search with a
single authoritative call.

**Acceptance Scenarios**:

1. **Given** a vault containing at least one tag, **When** the caller invokes
   `list_tags` with no arguments, **Then** the response lists every tag in
   the vault, each with a usage count, and the list is non-empty.
2. **Given** a note that contains `#draft` once as an inline tag and once
   inside a fenced code block, **When** the caller invokes `list_tags`,
   **Then** `#draft` appears with a usage count of 1 (the code-block
   occurrence is not counted).
3. **Given** a note whose YAML frontmatter declares `tags: [project, urgent]`
   and no inline tag occurrences, **When** the caller invokes `list_tags`,
   **Then** `project` and `urgent` both appear in the response.
4. **Given** the upstream plugin returns an error or is unreachable, **When**
   the caller invokes `list_tags`, **Then** the wrapper surfaces the upstream
   status code and message verbatim rather than substituting its own.
5. **Given** a vault containing hierarchical tags such as `work/tasks`,
   **When** the caller invokes `list_tags`, **Then** the response includes
   counts for both the leaf (`work/tasks`) and every parent prefix (`work`)
   exactly as the upstream returns them, with no wrapper-side aggregation
   or de-duplication.

---

### Edge Cases

- **Empty vault / no tags**: `list_tags` returns whatever the upstream
  returns for an empty index (typically `{ "tags": [] }`) without
  erroring.
- **Upstream timeout or connection failure**: the wrapper surfaces the
  transport error in the same shape as the existing tool family does, so
  callers get a consistent failure surface across tools.
- **Hierarchical tag roll-ups**: the upstream rolls a tag like
  `work/tasks` into both `work/tasks` and `work` counts. The wrapper
  passes this through unchanged; callers needing only leaf counts must
  filter client-side.
- **Multi-vault**: when the optional vault selector is supplied, the
  wrapper resolves it through the same configuration path the existing
  tools use; an unknown selector surfaces the same "Vault not configured"
  error those tools already raise.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST expose a tool named `list_tags` that returns
  every tag present in the focused vault together with a per-tag usage
  count, sourced from the upstream plugin's authoritative tag index at
  `GET /tags/`.
- **FR-002**: `list_tags` MUST accept zero required arguments and MUST
  accept an optional vault selector (`vaultId`) for multi-vault setups,
  matching the convention used by the existing tools in this server.
- **FR-007**: When the upstream `GET /tags/` call returns a non-2xx
  response (e.g., 401 unauthorized, 5xx upstream failure, transport
  timeout), the wrapper MUST propagate the upstream status code and
  response body to the caller without substituting wrapper-level error
  text. Error shape MUST match the existing tool family's
  `ObsidianApiError` / `ObsidianTimeoutError` / `ObsidianNotFoundError`
  surface so callers see a consistent failure contract across tools.
- **FR-008**: `list_tags`'s tool description MUST state that the
  returned index includes both inline (`#tag`) and frontmatter tags and
  excludes tag-shaped strings inside fenced code blocks — the
  distinction that makes this tool more accurate than text or
  frontmatter search for tag enumeration. The description MUST also
  state that hierarchical tags contribute counts to every parent
  prefix, so callers are not surprised by parent-prefix counts they
  did not author directly.
- **FR-010**: A regression test MUST exercise `list_tags` against a
  mocked upstream, asserting that the HTTP method (`GET`), URL path
  (`/tags/`), and required `Authorization` header are exactly what the
  upstream API expects, and that the success response body is
  forwarded verbatim. A second regression test MUST exercise an
  upstream-error path (e.g., 401 or 5xx) and assert the wrapper
  propagates the upstream status and body unchanged. (Constitution
  Principle II: every public tool ships with a happy-path test and an
  input-validation OR upstream-error test; here the latter is the
  upstream-error path because `list_tags` has no required input
  fields.)
- **FR-012**: For successful (2xx) upstream responses, the wrapper MUST
  pass the response body through to the caller verbatim, without
  reshaping, unwrapping, or omitting fields. The observed response
  shape (`{ "tags": [{ "name": string, "count": number }, …] }`) is
  documented in `/speckit-plan` contracts against the upstream OpenAPI
  spec but is not re-imposed by the wrapper, so additive upstream
  changes (new fields per tag, additional top-level fields) reach
  callers without a wrapper update.

### Key Entities *(include if data involved)*

- **Tag**: A label string used by Obsidian for note classification. May
  appear as an inline `#tagname` in note body text or as an entry in a
  note's YAML frontmatter `tags` field. Has a name and, in aggregate
  contexts, a usage count.
- **Tag Index**: The vault-wide mapping from tag name to usage count, as
  produced and maintained by Obsidian itself and exposed by the upstream
  plugin at `GET /tags/`. Authoritative; the wrapper reads it but does
  not compute or post-process it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A caller can enumerate every tag in a tagged vault with a
  single tool call that returns within the same response-time budget as
  the existing read tools in this server (no perceptible regression).
- **SC-002**: For a vault containing tag-shaped strings inside fenced code
  blocks, the result of `list_tags` matches what Obsidian's own tag pane
  shows — i.e., zero false positives from code-block strings — measured
  against a fixture vault. (This is the upstream's behavior; the
  measurement confirms the wrapper does not introduce any post-processing
  that diverges from it.)
- **SC-005**: Errors from the upstream are surfaced unchanged: the caller
  sees the same status code and message body the upstream produced, so
  diagnostics match upstream documentation rather than wrapper-specific
  paraphrases.
- **SC-006**: Regression tests for `list_tags` (happy path + upstream
  error) pass on a mocked upstream, and a tool-description audit
  confirms the description text states the inline+frontmatter inclusion
  rule, the code-block exclusion rule, and the hierarchical-tag
  parent-prefix roll-up behavior.

## Assumptions

- The deployed upstream Obsidian Local REST API plugin (>= v3.5.0)
  exposes `GET /tags/`, and its behavior matches the OpenAPI spec at
  `https://coddingtonbear.github.io/obsidian-local-rest-api/`. Phase 0
  research confirmed this against the OpenAPI doc, the v3.5.0 release
  notes, and the plugin source on `main`.
- Vault selection (`vaultId`) follows the same conventions already used
  by the existing tools in this server. No new multi-vault concept is
  introduced.
- Authentication and transport (host, port, API key) are handled by the
  same configuration the existing tools use; the new tool inherits it
  without change.
- Obsidian's own tag-detection rules (inline tags, frontmatter tags,
  exclusion of code-block strings, hierarchical-tag parent-prefix
  roll-ups) are the source of truth. The wrapper does not duplicate or
  second-guess them.
- Two operations originally specified in the user description —
  list-files-with-a-given-tag and atomic tag mutation (rename/add/
  remove) — are explicitly out of scope for this feature because the
  upstream endpoints they depend on are not implemented as of v3.5.0.
  See `research.md` §R1.
