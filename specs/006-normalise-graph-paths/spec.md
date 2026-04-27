# Feature Specification: Normalise Path Separators for Graph Tools

**Feature Branch**: `006-normalise-graph-paths`
**Created**: 2026-04-27
**Status**: Draft
**Input**: User description: "Normalise Path Separators — three graph tools (get_note_connections, find_path_between_notes, find_similar_notes) reject forward-slash paths for nested files, returning a misleading 'note not found' error. Other wrapper tools accept forward slashes uniformly because they round-trip through the upstream Local REST API; graph tools bypass that round-trip and read an in-process graph index keyed in OS-native form. Fix: normalise filepath inputs at the start of each graph-tool handler before lookup."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Forward-slash path works for note connections (Priority: P1)

A caller using the `get_note_connections` tool against a Windows vault passes a nested forward-slash path (`000-Meta/Vault Identity.md`) — the same separator style every other tool on the wrapper accepts — and expects to receive the note's outgoing links, backlinks, and tags. Today the call fails with a misleading "note not found" error even though the file exists, forcing the caller to discover and use a Windows-only backslash form. This story restores parity with the rest of the wrapper for the single most-used graph tool.

**Why this priority**: `get_note_connections` is the primary entry point for graph navigation on this wrapper, and forward-slash is the canonical separator across the surface. Fixing this one tool resolves the most visible breakage and on its own delivers a usable MVP — even if the other two graph tools were not yet patched, the caller could navigate the graph with the most-used tool using their preferred separator style.

**Independent Test**: Against a vault that has `000-Meta/Vault Identity.md`, call `get_note_connections` with `filepath: "000-Meta/Vault Identity.md"` and confirm it returns a connections payload (outgoingLinks, backlinks, tags) instead of a "note not found" error. Repeat with the backslash form and confirm both return equivalent results.

**Acceptance Scenarios**:

1. **Given** a Windows vault with `000-Meta/Vault Identity.md` present, **When** a caller invokes `get_note_connections` with `filepath: "000-Meta/Vault Identity.md"`, **Then** the tool returns the expected connections payload (no "note not found" error).
2. **Given** the same vault and file, **When** a caller invokes `get_note_connections` with `filepath: "000-Meta\Vault Identity.md"`, **Then** the tool returns an equivalent connections payload (existing backslash behaviour is preserved).
3. **Given** a vault that does not contain `does-not-exist.md`, **When** a caller invokes `get_note_connections` with `filepath: "does-not-exist.md"`, **Then** the tool still returns a clear "note not found" error — normalisation does not mask genuinely missing files.

---

### User Story 2 - Forward-slash paths work for path-between queries (Priority: P2)

A caller using `find_path_between_notes` to discover a route between two nested notes passes both `source` and `target` with forward-slash separators. Today the lookup fails with "note not found" on either argument, blocking the use case for any nested file on Windows.

**Why this priority**: `find_path_between_notes` is the second graph-traversal tool a caller is likely to reach for after connections. It takes two filepath arguments, so the separator bug bites twice. Independently testable from Story 1 because the affected handler is a separate code path even if the underlying fix is shared.

**Independent Test**: Against a vault with two nested notes, invoke `find_path_between_notes` with both `source` and `target` using forward-slash separators and confirm the response is either a valid path payload or an explicit "no path between endpoints" result — never a "note not found" error when both files exist.

**Acceptance Scenarios**:

1. **Given** a vault containing two nested notes that share at least one link path, **When** a caller invokes `find_path_between_notes` with both arguments using forward-slash separators, **Then** the tool returns the path between them.
2. **Given** a vault containing two nested notes that have no link path between them, **When** a caller invokes `find_path_between_notes` with both arguments using forward-slash separators, **Then** the tool returns "no path between endpoints" (or equivalent), not "note not found".
3. **Given** a vault with one nested note that exists and one that does not, **When** a caller invokes `find_path_between_notes` with forward-slash separators, **Then** the tool returns "note not found" identifying the genuinely missing file (not the existing one).

---

### User Story 3 - Forward-slash paths work for similarity queries (Priority: P3)

A caller using `find_similar_notes` (which depends on the optional Smart Connections plugin) passes a nested filepath with forward-slash separators and expects the tool to return ranked similar notes. The bug was originally hypothesised to follow the same shape as the other two tools by symmetry. Planning-phase analysis (recorded in [research.md § R5](research.md#r5--dispatcher-gap-for-find_similar_notes)) revealed a deeper finding: `find_similar_notes` is registered in `tools/list` but has no dispatcher case in the wrapper, so every call returns `Unknown tool: find_similar_notes` before any path-handling code runs. Smart Connections being absent on the test vault was a contributing factor to non-reproducibility, not the root cause. The fix therefore wires the dispatcher case AND applies forward-slash separator normalisation at the wrapper boundary — both are required for the tool to accept any filepath at all, let alone forward-slash ones.

**Why this priority**: This is the lowest priority of the three because (a) it depends on an optional plugin that is not always present, (b) the original separator-bug hypothesis turned out to require a deeper fix (dispatcher wiring + zod-schema modernisation) rather than a single shared-helper line, and (c) callers who care about similarity will typically also reach for the higher-priority tools first. Listed separately so the dispatcher gap is explicitly addressed rather than assumed away.

**Independent Test**: On a vault with Smart Connections configured and at least one nested note, invoke `find_similar_notes` with the nested note's forward-slash filepath and confirm the tool returns a similarity payload, not "note not found".

**Acceptance Scenarios**:

1. **Given** a vault with Smart Connections configured and a nested note present, **When** a caller invokes `find_similar_notes` with a forward-slash filepath, **Then** the tool returns the similarity result.
2. **Given** the same vault, **When** a caller invokes `find_similar_notes` with the equivalent backslash filepath, **Then** the tool returns an equivalent result.

---

### Edge Cases

- **Mixed separators in a single path** (`000-Meta\subdir/file.md`): the tool must accept the path and locate the file, since callers pasting paths from different sources may produce mixed forms.
- **Leading or trailing separator** (`/000-Meta/file.md`, `000-Meta/file.md/`): normalisation should not turn an otherwise-valid lookup into a miss; the wrapper's existing tools tolerate these forms via the upstream API and graph tools should match that tolerance.
- **Top-level file with no separator** (`README.md`): must continue to work unchanged — the fix is additive and must not regress the non-nested case.
- **Genuinely missing file**: the tool must still return a clear "note not found" error — normalisation must not mask real misses by accidentally matching a different existing file.
- **Case sensitivity**: this spec does not change case-sensitivity behaviour. If the index is case-sensitive today, it remains so; the fix addresses separators only.
- **POSIX hosts**: on POSIX, where forward-slash is already the OS-native separator, the change must be a no-op for the canonical input form and must not break callers that happen to pass backslashes (since the wrapper's contract is forward-slash-friendly, backslash on POSIX is a low-traffic case but should at minimum not crash).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `get_note_connections` tool MUST accept a `filepath` argument that uses forward-slash separators for nested paths and return the same connections payload it would return for the equivalent backslash path.
- **FR-002**: The `find_path_between_notes` tool MUST accept `source` and `target` arguments that use forward-slash separators and return either a path result or an explicit "no path" result — never "note not found" when both files exist.
- **FR-003**: The `find_similar_notes` tool MUST accept a `filepath` argument that uses forward-slash separators and return the same similarity result it would return for the equivalent backslash path (when the optional similarity backend is available).
- **FR-004**: All three graph tools MUST continue to accept backslash-separated paths with no behaviour change. On Windows this means backslash is treated as a path separator (the existing canonical form for the in-process index). On POSIX, where backslash is a valid filename character rather than a separator, "no behaviour change" means backslash is preserved as a literal character — separator semantics are not retroactively applied to backslash on POSIX, and a path containing literal backslashes simply fails to match any indexed entry (returning the existing `note not found:` error rather than crashing). The fix is additive normalisation, not a forward-slash-only requirement.
- **FR-005**: All three graph tools MUST accept paths with mixed separators (a single path containing both forward-slash and backslash) and resolve them to the same indexed entry as the canonical form.
- **FR-006**: When a caller passes a path that does not correspond to any indexed note (after normalisation), the tools MUST return a clear "note not found" error identifying the offending path — normalisation MUST NOT mask genuinely missing files.
- **FR-007**: The wrapper's externally-visible input contract for graph tools MUST remain forward-slash-friendly so it matches the rest of the wrapper's surface (`get_file_contents`, `list_files_in_dir`, `patch_content`, `append_content`, `put_content`, `delete_file`, etc.). The graph index's internal storage format MUST NOT leak into that contract.
- **FR-008**: A regression test MUST exercise both separator forms (forward-slash and backslash) against at least one of the three graph tools and assert that both calls return equivalent results.

### Key Entities

- **Filepath input**: the string a caller passes to a graph tool to identify a note. Externally always forward-slash-friendly; may contain backslashes or mixed separators and must still resolve.
- **Graph index entry key**: the internal identifier the wrapper's in-process graph index uses to look up a note. OS-native separator form on each platform. Implementation detail — must not be exposed in the input contract.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of graph-tool calls that pass a forward-slash nested path matching an existing note return the expected payload instead of "note not found" — measured on a Windows vault by exercising each affected tool with a forward-slash path against a known-present nested file.
- **SC-002**: For every affected tool, a forward-slash filepath and the equivalent backslash filepath produce identical results (same payload, or the same explicit "no path" / "note not found" outcome) — verified by a regression test that calls the tool twice with both separator forms and asserts equivalence.
- **SC-003**: Zero regressions for the backslash input form — every existing call site that passes a Windows-style path continues to receive its current result.
- **SC-004**: Zero regressions on POSIX hosts — forward-slash paths (the canonical and historically-working form) continue to work, and backslash paths do not crash the handler.
- **SC-005**: The fix is invisible to non-graph tools — `get_file_contents`, `list_files_in_dir`, `patch_content`, `append_content`, `put_content`, and `delete_file` show no change in behaviour for the same set of inputs.

## Assumptions

- The wrapper's in-process graph index is keyed on OS-native separators (backslash on Windows, forward-slash on POSIX) at the time the index is built, so normalising the caller's input to OS-native form before lookup is sufficient — no rebuild of the index is required.
- The other tools on the wrapper (`get_file_contents`, `list_files_in_dir`, `patch_content`, `append_content`, `put_content`, `delete_file`) accept forward-slash paths because they round-trip through the upstream Local REST API, which canonicalises separators. This behaviour is treated as the wrapper's de-facto input contract and the graph tools must conform to it.
- `find_similar_notes` was originally presumed affected by symmetry. Planning-phase analysis (research.md R5) found a deeper issue: the tool is registered in `tools/list` but absent from the dispatcher's `switch` block, so every call returns `Unknown tool: find_similar_notes`. The fix wires the dispatcher case, applies forward-slash normalisation (since Smart Connections is an HTTP passthrough whose canonical form is forward-slash, not OS-native), and brings the tool into Constitution Principle III compliance by replacing its hand-written JSON schema with a zod-derived one. Verification on a vault with Smart Connections configured is left to manual acceptance testing in addition to the automated regression test.
- Case sensitivity, Unicode normalisation, and other path-canonicalisation concerns are out of scope. This feature addresses separators only.
- The existing "note not found" error message format is preserved — only the conditions under which it fires change (it must no longer fire when the only difference is separator style).
