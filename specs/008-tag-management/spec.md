# Feature Specification: Tag Management

**Feature Branch**: `008-tag-management`
**Created**: 2026-04-28
**Status**: Draft
**Input**: User description: "Add Tag Management — three new MCP tools wrapping the upstream Local REST API plugin's `/tags/...` surface so an LLM caller can read Obsidian's authoritative tag index, list files by tag, and atomically rename/add/remove tags."

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
even if the other two tools were never built, an agent could still use this
read to decide what to do next via the existing search/file tools. It is
also the lowest-risk tool to ship (read-only, no mutation surface), making
it a natural P1.

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

---

### User Story 2 - List files using a specific tag (Priority: P1)

An LLM caller has identified a tag of interest (often from `list_tags`, but
not necessarily) and needs the authoritative list of files in the vault that
use that tag. The caller invokes `get_files_with_tag` with the tagname and
receives the file list. As with `list_tags`, the result is what Obsidian
itself considers tagged: it includes files where the tag appears inline or
in frontmatter, and excludes files where the tag appears only inside a
fenced code block.

**Why this priority**: This is the natural follow-up to Story 1 and the
correct way to answer "which files have tag X?" — the existing
text/frontmatter search tools systematically over-count (they hit code-block
mentions) and under-count (they miss inline tags when only frontmatter is
searched, or vice versa). Shipping this alongside Story 1 lets a caller
fully cover the read half of tag management on day one.

**Independent Test**: In a vault, place tag `#alpha` in three files: one
inline, one in frontmatter, and one only inside a fenced code block. Call
`get_files_with_tag` with `tagname: "alpha"`. Verify the response contains
exactly the first two files. Then call it with a tag known not to exist and
verify the upstream 404 is propagated unchanged.

**Acceptance Scenarios**:

1. **Given** a vault where three notes use the tag `alpha` (one inline, one
   in frontmatter, one inside a fenced code block), **When** the caller
   invokes `get_files_with_tag` with `tagname: "alpha"`, **Then** the
   response lists the first two files and omits the third.
2. **Given** a tagname that is not present anywhere in the vault, **When**
   the caller invokes `get_files_with_tag`, **Then** the wrapper returns the
   upstream's 404 status and message verbatim, without rewriting it as a
   wrapper-level error.
3. **Given** the caller omits the required `tagname` argument, **When** the
   call is made, **Then** the wrapper rejects the call with a validation
   error before any HTTP request is sent.

---

### User Story 3 - Rename, add, or remove a tag atomically (Priority: P1)

An LLM caller needs to change tags in the vault: rename a tag everywhere it
appears, add a tag to a specific file, or remove a tag from a specific file.
The caller invokes `tag_mutation` with the tag being modified, the operation
(`rename`, `add`, or `remove`), and any operation-specific arguments
(`target_tagname` for rename; `filepath` for add/remove). The wrapper
forwards the request to the upstream plugin's single PATCH endpoint and
relies on the upstream to perform the change. Crucially, `rename` is a
*single atomic vault-wide call* — the wrapper never iterates files itself,
because doing so would be slower, non-atomic, and would re-implement logic
the upstream already provides correctly.

**Why this priority**: Renaming a tag across a large vault is the highest-
value tag operation and the one most prone to corruption when implemented
client-side. Exposing the upstream's atomic rename — and the matching
single-file add/remove — completes the tool surface so callers do not have
to choose between "do it slowly via search-and-edit" and "skip it." The
read tools (Stories 1 and 2) are necessary to verify mutations succeeded,
but this story is what changes the vault and is the primary motivator for
the feature.

**Independent Test**: In a vault, place `#old` in five files (mixing inline
and frontmatter occurrences). Call `list_tags` and `get_files_with_tag` with
`tagname: "old"` to capture the before-state. Call `tag_mutation` with
`operation: "rename"`, `tagname: "old"`, `target_tagname: "new"`. Re-run
`list_tags` and `get_files_with_tag` — `old` is gone, `new` is present in
exactly the same five files, and the operation completed in one upstream
call. Repeat with `add` and `remove` against a single file to confirm
single-file behavior.

**Acceptance Scenarios**:

1. **Given** the tag `old` appears in five files (mix of inline and
   frontmatter), **When** the caller invokes `tag_mutation` with
   `operation: "rename"`, `tagname: "old"`, `target_tagname: "new"`,
   **Then** after the call `list_tags` no longer reports `old`,
   `get_files_with_tag` for `new` lists those same five files, and the
   wrapper made exactly one PATCH request to the upstream.
2. **Given** a file `notes/inbox.md` that does not have the tag `triage`,
   **When** the caller invokes `tag_mutation` with `operation: "add"`,
   `tagname: "triage"`, `filepath: "notes/inbox.md"`, **Then** the file is
   subsequently reported by `get_files_with_tag` for `triage`.
3. **Given** a file that already has tag `triage`, **When** the caller
   invokes `tag_mutation` with `operation: "remove"`, `tagname: "triage"`,
   `filepath: "<that file>"`, **Then** the file is no longer reported by
   `get_files_with_tag` for `triage`.
4. **Given** a `rename` operation with a tagname that does not exist in the
   vault, **When** the call is made, **Then** the wrapper propagates the
   upstream 404 verbatim and makes no other changes to the vault.
5. **Given** an `add` operation against a filepath that does not exist,
   **When** the call is made, **Then** the wrapper propagates the upstream
   error verbatim.
6. **Given** `operation: "rename"` is requested without `target_tagname`,
   or `operation: "add"`/`"remove"` is requested without `filepath`,
   **When** the call is made, **Then** the wrapper rejects the call with a
   validation error before any HTTP request is sent.

---

### Edge Cases

- **Tagname containing the leading `#`**: Callers may pass `#foo` or `foo`.
  The wrapper accepts either form and normalizes to whatever shape the
  upstream expects, so behavior is identical regardless of input style.
- **Tagname with characters requiring URL encoding** (e.g., `area/work`,
  Unicode): the wrapper URL-encodes the tagname when constructing the path
  so the upstream receives a valid URL.
- **Idempotent add**: adding a tag a file already has is the upstream's
  responsibility; whatever the upstream returns (typically a success no-op)
  is propagated unchanged.
- **Idempotent remove**: removing a tag a file does not have follows the
  same pass-through behavior.
- **Empty vault / no tags**: `list_tags` returns an empty index without
  erroring.
- **Upstream timeout or connection failure**: the wrapper surfaces the
  transport error in the same shape as the existing tool family does, so
  callers get a consistent failure surface across tools.
- **Concurrent mutations**: the wrapper does not coordinate concurrency
  itself; it delegates to the upstream's single-call atomicity for rename
  and accepts that interleaved add/remove calls behave however the upstream
  serializes them.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST expose a tool named `list_tags` that returns
  every tag present in the focused vault together with a per-tag usage
  count, sourced from the upstream plugin's authoritative tag index.
- **FR-002**: `list_tags` MUST accept zero required arguments and MUST
  accept an optional vault selector for multi-vault setups.
- **FR-003**: The system MUST expose a tool named `get_files_with_tag` that
  accepts a required `tagname` and an optional vault selector and returns
  the upstream's authoritative list of files that use that tag.
- **FR-004**: The system MUST expose a tool named `tag_mutation` that
  accepts a required `tagname`, a required `operation` field whose value is
  one of `rename`, `add`, or `remove`, and operation-specific fields:
  `target_tagname` (required when `operation = rename`) and `filepath`
  (required when `operation` is `add` or `remove`).
- **FR-005**: `tag_mutation` MUST validate that the operation-specific
  fields required by the chosen `operation` are present before issuing any
  upstream request, and MUST reject calls with a clear validation error
  when they are missing.
- **FR-006**: For `operation: rename`, the wrapper MUST perform the rename
  via a single upstream call and MUST NOT iterate files client-side. The
  vault-wide atomicity of the rename is the upstream's responsibility and
  the entire purpose of exposing this tool.
- **FR-007**: When an upstream call returns a non-2xx response (including
  but not limited to 404 for an unknown tagname or unknown file, and 4xx
  for malformed requests), the wrapper MUST propagate the upstream status
  code and response body to the caller without substituting wrapper-level
  error text.
- **FR-008**: Each of the three tools MUST identify itself in its tool
  description as part of the tag-management capability and MUST point
  callers away from less accurate alternatives: `list_tags` and
  `get_files_with_tag` descriptions MUST state that they include both
  inline and frontmatter tags and exclude tag-shaped strings inside fenced
  code blocks (the distinction that makes them more accurate than text
  search). `tag_mutation`'s description MUST state that `rename` is
  vault-wide and atomic.
- **FR-009**: The wrapper MUST URL-encode tagnames when interpolating them
  into upstream paths and MUST accept tagnames provided with or without a
  leading `#`, normalizing as needed for the upstream call.
- **FR-010**: Regression tests MUST cover at least one tool from each
  operation category — read (`list_tags`), list-by-tag
  (`get_files_with_tag`), and mutation (`tag_mutation` with `rename`) —
  against a mocked upstream, asserting that the HTTP method, URL path, and
  any operation-discriminating header are exactly what the upstream API
  expects.
- **FR-011**: The three tools MUST share a coherent description block such
  that a tool-listing caller perceives them as a single capability and is
  unlikely to mix them with the existing text-search or
  frontmatter-search tools when tag accuracy matters.

### Key Entities *(include if data involved)*

- **Tag**: A label string used by Obsidian for note classification. May
  appear as an inline `#tagname` in note body text or as an entry in a
  note's YAML frontmatter `tags` field. Has a name and, in aggregate
  contexts, a usage count.
- **Tag Index**: The vault-wide mapping from tag name to usage count, as
  produced and maintained by Obsidian itself. Authoritative; the wrapper
  reads it but does not compute it.
- **File-by-Tag Listing**: The vault-wide mapping from a specific tag name
  to the set of file paths that use that tag, again produced by Obsidian.
- **Tag Mutation**: A single requested change to the vault's tag state,
  parameterized by an operation (`rename` / `add` / `remove`), the target
  tag, and either a replacement tag name (rename) or a file path (add,
  remove).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A caller can enumerate every tag in a tagged vault with a
  single tool call that returns within the same response-time budget as
  the existing read tools in this server (no perceptible regression).
- **SC-002**: For a vault containing tag-shaped strings inside fenced code
  blocks, the result of `list_tags` and `get_files_with_tag` matches what
  Obsidian's own tag pane shows for that tag — i.e., zero false positives
  from code-block strings — measured against a fixture vault.
- **SC-003**: A vault-wide tag rename across an arbitrarily large vault
  (constrained only by what the upstream plugin supports) completes in a
  single tool call, with no client-side iteration over files visible in
  the wrapper's logs or network activity.
- **SC-004**: After every successful `tag_mutation` rename, the
  before/after combination of `list_tags` and `get_files_with_tag` proves
  the change occurred (old tag removed, new tag present in the same set
  of files), with no orphaned references to the old tag.
- **SC-005**: Errors from the upstream are surfaced unchanged: the caller
  sees the same status code and message body the upstream produced, so
  diagnostics match upstream documentation rather than wrapper-specific
  paraphrases.
- **SC-006**: Regression tests for the three operation categories pass on
  a mocked upstream, and a tool-description audit confirms callers see
  the three tools as a single tag-management capability rather than
  reaching for `complex_search` or text-search alternatives.

## Assumptions

- The deployed upstream Obsidian Local REST API plugin exposes the
  `/tags/`, `/tags/{tagname}/`, and `PATCH /tags/{tagname}/` endpoints,
  and its behavior matches the OpenAPI spec at
  `https://coddingtonbear.github.io/obsidian-local-rest-api/`. The exact
  request shape (Operation header values, body payload, response shape)
  for `PATCH /tags/{tagname}/` will be confirmed against that OpenAPI spec
  during `/speckit-plan` and is treated as authoritative there.
- The wrapper does not implement any client-side fallback for vault-wide
  rename. If the upstream version in use does not support the rename
  endpoint, the wrapper surfaces the upstream's response unchanged rather
  than emulating rename via per-file edits.
- Vault selection (`vaultId` or equivalent) follows the same conventions
  already used by the existing tools in this server. No new multi-vault
  concept is introduced.
- Authentication and transport (host, port, API key) are handled by the
  same configuration the existing tools use; the new tools inherit it
  without change.
- Obsidian's own tag-detection rules (inline tags, frontmatter tags,
  exclusion of code-block strings) are the source of truth. The wrapper
  does not duplicate or second-guess them.
- Idempotency of `add` and `remove` is whatever the upstream chooses; the
  wrapper does not normalize this and does not attempt to detect "no-op"
  mutations.
