# Feature Specification: Vault-Wide Find and Replace (`find_and_replace`)

**Feature Branch**: `013-find-and-replace`
**Created**: 2026-05-02
**Status**: Draft
**Input**: User description: "Add Find Replace — A new MCP tool find_and_replace that performs vault-wide string-replacement across all .md files in a single tool call, with optional code-block-skip / HTML-comment-skip / dry-run modes and full multi-vault routing."

## Clarifications

### Session 2026-05-03

- Q: When `replacement` contains the `search` term (e.g., `search: "old"`, `replacement: "old-new"`), are matches re-scanned after replacement? → A: Single-pass global replace — each match in the *original* content is replaced exactly once; replacements are NOT re-scanned. Equivalent to JavaScript `String.prototype.replaceAll` / `replace(/.../g, ...)`.
- Q: When a per-file write fails mid-sweep (after validation passed and earlier files have already been written), how does the tool respond? → A: Best-effort continue — keep processing remaining files; return `ok: false` with `filesModified` reflecting actually-written files plus a `failures: [{filename, error}, ...]` array. Dry-run remains the documented safety net for avoiding partial writes.
- Q: When `regex: true`, which flags does the tool apply to the underlying regex? → A: `g` always; `i` when `caseSensitive: false`; `m` (multiline — `^`/`$` match line boundaries) always-on; `s` (dotall — `.` matches `\n`) OFF. Sed/grep-aligned semantics; line anchors work per-line; `.` does not cross newlines.
- Q: How does the tool handle a read-modify-write race when an external writer (Obsidian editor, sync plugin) modifies a note between the tool's fetch and write? → A: Best-effort last-write-wins — no pre-write revalidation. If an external write lands in the gap, the tool's write overwrites it. The tool description names this risk; the clean-git-state precondition is the mitigation. Matches every other mutating tool's contract in this fork.
- Q: Should the tool enforce a per-file size cap, and what happens when a file exceeds it? → A: Soft cap at 5 MB per file. Files above the cap are skipped (not processed); they appear in the response under a `skipped: [{ filename, reason: "size_exceeded", sizeBytes }, ...]` array. The sweep continues with remaining files; the response distinguishes skipped from failed.
- Q: How does the tool handle line endings (CRLF vs LF) when reading, replacing, and writing a file? → A: Preserve original line endings byte-for-byte. The tool reads raw bytes, applies replacements without normalization, and writes back. A `\n` in `replacement` stays `\n` literal (no platform auto-conversion). Mixed CRLF/LF files retain their exact byte composition except where replacements substitute new bytes. This is necessary to keep SC-002, SC-005, and SC-007 honest on cross-platform vaults.
- Q: When `caseSensitive: false`, what case-folding rules apply (especially for non-ASCII content)? → A: JavaScript regex `i` flag combined with the `u` (Unicode) flag. ECMAScript Unicode case-folding — Latin / Cyrillic / Greek / accented characters fold correctly; locale-quirky pairs (Turkish dotless-`ı` / dotted-`İ`, German `ß` / `SS`) follow ECMAScript defaults, NOT locale-aware folding. Locale-aware fold is out of scope this round.
- Q: When skipped regions of different types could overlap or one could span a boundary of another (e.g., HTML comment opens inside a fenced code block but closes outside, or vice versa), what's the precedence/composition rule? → A: Independent detection + union. Detect code-block regions and HTML-comment regions separately over the original content, then take the union of byte ranges. A byte covered by *either* region by independent detection is excluded from the search. Strongest audit-trail-preservation guarantee; predictable and easy to test.
- Q: How does the tool detect fenced code block boundaries? → A: CommonMark-style line-anchored fences. Opener: a line matching `^ {0,3}\`{3,}.*$` (optional 0–3 leading spaces, 3 or more backticks, optional info string). Closer: the next line at line-start with at least the same number of backticks. Matches Obsidian's renderer, so the user's mental model from the editor maps directly to the tool's skip behavior.
- Q: How does `pathPrefix` filter the file enumeration (trailing slash, case sensitivity, glob support)? → A: Directory-segment match, case-sensitive, no glob. A file's vault-relative path matches if it equals `pathPrefix` exactly OR starts with `pathPrefix` followed by `/`. Trailing slash on input is normalized away (`"Projects"` ≡ `"Projects/"`). Case-sensitive on all platforms including Windows. No glob expansion — `pathPrefix` is a literal path-segment prefix, not a glob pattern. Documented in tool description.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sweep a literal string across the vault, with dry-run safety net (Priority: P1)

A user maintaining an Obsidian vault needs to rename a recurring term (e.g., a project codename, a deprecated tool name, a misspelled author tag) across every Markdown note. Today they must either run an external CLI against the vault folder (which bypasses the MCP integration and risks desync with Obsidian's index) or open and edit notes one-by-one. They want a single MCP tool call that previews the change first, then commits it once they have eyeballed the diff.

**Why this priority**: This is the core productivity win and the documented safety net (dry-run) in one workflow. Without dry-run-then-commit, the tool is too dangerous to use; without the literal sweep, it solves nothing.

**Independent Test**: Pick a vault with a known string in N notes. Call `find_and_replace` with `dryRun: true` — verify the response reports `filesModified = N`, `totalReplacements ≥ N`, and the working tree is byte-identical (no git diff). Re-call with `dryRun: false` — verify the same N files are now changed and the response counts match.

**Acceptance Scenarios**:

1. **Given** a vault containing the literal string `"AcmeWidget"` in 7 notes, **When** the user calls `find_and_replace` with `search: "AcmeWidget"`, `replacement: "Globex"`, `dryRun: true`, **Then** the response reports `ok: true`, `filesScanned ≥ 7`, `filesModified = 7`, `totalReplacements ≥ 7`, and `git status` shows no changes.
2. **Given** the same vault, **When** the user re-calls with `dryRun: false`, **Then** all 7 notes are rewritten, the response counts are unchanged, and a subsequent `find_and_replace` for the same `"AcmeWidget"` string returns `filesModified = 0`.
3. **Given** the user passes `pathPrefix: "Projects/"`, **When** matches exist both inside and outside that prefix, **Then** only files under `Projects/` are scanned and modified.
4. **Given** a file's content is byte-identical after applying the replacement (e.g., the search string is absent), **When** the tool processes that file, **Then** no write is issued for it and `filesModified` does not count it.

---

### User Story 2 - Regex-driven rewrite with capture groups (Priority: P2)

A user needs to rewrite version strings (`v1.4` → `v1.4.0`), normalize callout syntax, or split a piece of structured text into a different shape. A literal find-and-replace is too coarse; they need ECMAScript regex with capture-group back-references in the replacement.

**Why this priority**: Regex is a power feature. The literal sweep (US1) covers the common case; regex unlocks bulk structural rewrites that otherwise require a script or a custom plugin.

**Independent Test**: Place a file containing `v1.4` and `v2.7` strings. Call `find_and_replace` with `search: "v(\\d+)\\.(\\d+)"`, `replacement: "v$1.$2.0"`, `regex: true`. Verify the file now contains `v1.4.0` and `v2.7.0`.

**Acceptance Scenarios**:

1. **Given** a note containing `v1.4` and `v2.7`, **When** the user calls `find_and_replace` with `search: "v(\\d+)\\.(\\d+)"`, `replacement: "v$1.$2.0"`, `regex: true`, **Then** the note contains `v1.4.0` and `v2.7.0` and `totalReplacements = 2` for that file.
2. **Given** an invalid regex pattern (e.g., unbalanced parenthesis), **When** the user calls the tool with `regex: true`, **Then** the tool returns a structured error (`ok: false` with a message identifying the bad pattern) and writes zero files.
3. **Given** `regex: true` and `caseSensitive: false`, **When** the search is `"acme"` and the file contains `Acme` and `ACME`, **Then** both matches are replaced.

---

### User Story 3 - Preserve code blocks and HTML comments during sweeps (Priority: P2)

A user is renaming a project codename across the vault. Notes contain code examples that quote the codename literally (e.g., `\`\`\`bash\necho "AcmeWidget"\n\`\`\``) AND audit-trail HTML comments that record the rename history (e.g., `<!-- renamed from AcmeWidget on 2026-04-01 -->`). Both must survive the sweep verbatim — the code examples because they document historical state, and the audit comments because they ARE the audit trail being preserved.

**Why this priority**: This is the audit-trail-preservation guarantee. The user explicitly identified this as critical for project-name renames. Without it, a sweep silently destroys provenance.

**Independent Test**: Create a note containing the search string in: (a) regular prose, (b) inside a fenced code block, (c) inside an HTML comment. Call `find_and_replace` with `skipCodeBlocks: true`, `skipHtmlComments: true`. Verify the prose match is replaced, and the bytes inside the fenced block and the HTML comment are byte-identical to before.

**Acceptance Scenarios**:

1. **Given** a note with the search string in prose, in a fenced code block, and in an HTML comment, **When** the user calls `find_and_replace` with `skipCodeBlocks: true` and `skipHtmlComments: true`, **Then** the prose match is replaced and the code-block and HTML-comment bytes are byte-identical to the input.
2. **Given** the same note, **When** the user calls without those flags (defaults `false`), **Then** all three matches are replaced.
3. **Given** an unclosed fenced code block (opens with ```` ``` ```` but file ends before the close), **When** the tool runs with `skipCodeBlocks: true`, **Then** the tool treats everything from the opening fence to end-of-file as inside the block (i.e., skipped) and does not corrupt the file.

---

### User Story 4 - Per-vault routing across multiple configured vaults (Priority: P3)

A user with multiple Obsidian vaults configured (the wrapper supports 7) needs to run a sweep against a non-default vault without reconfiguring the default. They pass `vaultId: "research"` and the entire find-and-replace operation — walk, fetch, write — happens against that vault's REST service.

**Why this priority**: Multi-vault routing is a foundational capability of this fork (the original-contribution layer per the brief). The other tools already support it; without it, `find_and_replace` would be the only mutating tool that silently targets the default vault, which is a footgun.

**Independent Test**: A parametrised regression test (mirroring TC-052's pattern) calls `find_and_replace` with `vaultId: "<non-default vault>"` and asserts the operation modifies files in that vault, not the default.

**Acceptance Scenarios**:

1. **Given** two configured vaults `default` and `research`, both containing the search string, **When** the user calls `find_and_replace` with `vaultId: "research"`, **Then** only `research` is modified and `default` is byte-identical to before.
2. **Given** an invalid `vaultId` (no such vault configured), **When** the user calls the tool, **Then** the tool returns a structured error and writes zero files.
3. **Given** `vaultId` is omitted, **When** the user calls the tool, **Then** the operation routes to the default vault per the wrapper's standard multi-vault pattern.

---

### Edge Cases

- **Empty `search`**: The tool MUST reject an empty `search` string with a structured error and write zero files (otherwise it would match every position and either explode or no-op uselessly).
- **No matches anywhere in the vault**: The tool returns `ok: true`, `filesModified: 0`, `totalReplacements: 0`, and writes zero files.
- **Trailing newline preservation**: If a file ends with `\n`, the rewritten file MUST also end with `\n`. If it does not, the rewritten file MUST also not. Trailing-newline state is preserved byte-for-byte.
- **Internal line-ending preservation (CRLF vs LF)**: The tool reads raw bytes and writes raw bytes; it never normalizes CRLF↔LF. Mixed-ending files stay mixed exactly as they were except at replacement sites. A `\n` literal in `replacement` is inserted as `\n` regardless of host platform. Critical for cross-platform vaults synced between Windows and macOS/Linux.
- **Byte-identical no-op**: If the post-replacement content equals the pre-replacement content (e.g., the only matches were inside a skipped region), no write is issued and the file is not counted in `filesModified`.
- **Replacement semantics (single-pass global)**: Every match in the original content of a note is replaced exactly once per call; replacements are NOT re-scanned. A `replacement` containing the `search` term (e.g., `search: "old"`, `replacement: "old-new"`) will NOT be re-replaced — the output of `"old"` becomes `"old-new"` and the call terminates predictably.
- **Frontmatter crossings**: Frontmatter is treated as raw text. If a search/replacement crosses the `---` boundary, the tool does not validate the result (out of scope; users should use `patch_content` with `target_type: frontmatter` for typed frontmatter writes).
- **Inline-code spans (single-backtick)**: Out of scope. Only fenced (triple-backtick) code blocks are honored by `skipCodeBlocks`. Documented as a deferred extension.
- **Large vault**: The default response (without `verbose: true`) omits the `perFile` array so the response stays bounded for vaults with thousands of notes.
- **Per-file size cap**: Files larger than 5 MB are skipped (not processed) and appear in the response's `skipped` array. The sweep continues with remaining files. Skipped files differ from `failures` — `skipped` means preventatively-not-attempted, `failures` means attempted-and-errored. Users who need to process larger files SHOULD split the file or wait for a future configurable-cap extension.
- **Unwritten dry-run side effects**: With `dryRun: true`, the tool MUST NOT write any file, MUST NOT touch file mtimes, and MUST NOT issue any PUT request to the REST service. Verifiable via `git status` showing no changes after the call.

## Requirements *(mandatory)*

### Functional Requirements

#### Tool surface

- **FR-001**: The MCP server MUST expose a tool named `find_and_replace`.
- **FR-002**: The tool MUST accept the following input parameters: `search` (string, required), `replacement` (string, required), `regex` (boolean, optional, default `false`), `caseSensitive` (boolean, optional, default `true`), `wholeWord` (boolean, optional, default `false`), `flexibleWhitespace` (boolean, optional, default `false`), `skipCodeBlocks` (boolean, optional, default `false`), `skipHtmlComments` (boolean, optional, default `false`), `dryRun` (boolean, optional, default `false`), `pathPrefix` (string, optional), `vaultId` (string, optional), `verbose` (boolean, optional, default `false`).
- **FR-003**: The tool description MUST state (a) the precondition that the vault SHOULD be in a clean git state (or otherwise backed up) before running mutations, (b) that `dryRun: true` is the documented safety net, and (c) that the tool follows best-effort last-write-wins semantics — if an external writer (Obsidian editor, sync plugin) modifies a note between the tool's fetch and write, the tool's write overwrites that external edit without warning. Users who need to avoid this race SHOULD close Obsidian / pause sync plugins before running mutations.

#### Vault walk and per-file processing

- **FR-004**: The tool MUST enumerate every `.md` file in the targeted vault (filtered by `pathPrefix` when set) using the existing `list_files_in_vault` / `list_files_in_dir` infrastructure. `pathPrefix` matching MUST follow these rules: (a) **directory-segment match** — a file's vault-relative path matches when it equals `pathPrefix` exactly OR starts with `pathPrefix` followed by `/`; (b) **trailing-slash normalization** — input values `"Projects"` and `"Projects/"` are equivalent; (c) **case-sensitive on all platforms** including Windows (matches Obsidian REST API path semantics); (d) **no glob expansion** — `pathPrefix` is a literal path-segment prefix, not a glob pattern. The tool description MUST document this matching rule so Windows users do not assume case-insensitive behavior.
- **FR-005**: For each enumerated file, the tool MUST fetch the current content via the existing `get_file_contents` internal call.
- **FR-006**: The tool MUST apply replacement using **single-pass global replace** semantics: every match in the *original* content of a note is replaced exactly once, and the replacement output is NOT re-scanned for further matches within the same call. This is equivalent to JavaScript `String.prototype.replaceAll(search, replacement)` for literal mode and `String.prototype.replace(/.../g, replacement)` for regex mode. Replacements are applied left-to-right; replacements MUST NOT introduce infinite loops or non-termination, even when `replacement` literally contains `search`.
- **FR-007**: When `skipCodeBlocks: true`, the tool MUST exclude content inside fenced code blocks from the search; the bytes inside skipped regions MUST be preserved byte-for-byte. Fence boundaries MUST be detected using CommonMark-style line-anchored rules: an *opener* is a line matching `^ {0,3}\`{3,}.*$` (optional 0–3 leading spaces, then 3 or more consecutive backticks, then optional info string, then end-of-line); the *closer* is the next line whose contents match `^ {0,3}\`{N,}\s*$` where `N` is the backtick count from the opener. Tilde fences (`~~~`) are NOT honored in this round (only triple-backtick fences). Inline-code spans (single-backtick) are explicitly out of scope per the brief. The skipped region MUST include the opening and closing fence lines themselves (the opener and closer are part of the protected span).
- **FR-008**: When `skipHtmlComments: true`, the tool MUST exclude content inside HTML comments (`<!-- … -->`) from the search; the bytes inside skipped regions MUST be preserved byte-for-byte.
- **FR-009**: When both skip modes are set, the tool MUST compute skipped regions using **independent detection + union**: detect code-block regions and HTML-comment regions separately over the *original* file content (each detector is self-contained and does NOT depend on the other's output), then take the union of byte ranges. Any byte covered by *either* region is excluded from the search. This rule applies to all overlap cases including a comment opener that lies inside a code block but whose closer lies outside, and the symmetric case with code-block fences crossing a comment boundary. A byte protected by either category MUST be preserved byte-for-byte.
- **FR-010**: When `wholeWord: true`, the tool MUST wrap the effective pattern in `\b…\b` in both literal and regex modes.
- **FR-011**: When `flexibleWhitespace: true`, the tool MUST substitute any whitespace run in `search` with `\s+` (effective in both literal and regex modes; in literal mode, the rest of the search string MUST first be regex-escaped so only whitespace becomes a metacharacter).
- **FR-012**: When `caseSensitive: false`, matching MUST be case-insensitive (in both literal and regex modes). The fold semantics MUST be ECMAScript Unicode case-folding (equivalent to a JavaScript regex compiled with both `i` and `u` flags). This means `"A"` matches `"a"`, `"É"` matches `"é"`, `"Ω"` matches `"ω"`. Locale-quirky pairs (Turkish dotless-`ı` ↔ dotted-`İ`, German `ß` ↔ `SS`) follow ECMAScript default behavior and are NOT locale-aware. Locale-aware fold is out of scope this round.
- **FR-013**: When `regex: true`, the tool MUST parse `search` as an ECMAScript regex and MUST honor `$1`, `$2`, ..., `$&`, `$$` capture-group references in `replacement`. The compiled regex MUST use the following flag set: `g` always (global match, per FR-006); `i` when `caseSensitive: false`; `m` always-on (multiline — `^` and `$` match line boundaries within a note's content, not just start/end of file); `u` always-on (Unicode mode — required for the case-folding semantics in FR-012 and for predictable handling of non-ASCII content); `s` OFF (dotall disabled — `.` does NOT match newline characters). The flag set is fixed; the tool MUST NOT expose flag overrides via additional parameters in this round. When `regex: false`, the literal characters of `search` MUST be matched verbatim and the literal characters of `replacement` MUST be inserted verbatim (no `$`-expansion).
- **FR-014**: If the post-replacement content of a file is byte-identical to the input, the tool MUST NOT issue a write for that file and MUST NOT count it in `filesModified`.

#### Dry run vs. commit

- **FR-015**: When `dryRun: true`, the tool MUST perform zero writes (no PUT, no mtime changes) and MUST return per-file diff previews suitable for human review. Each per-file preview MUST include filename, replacement count, and an abridged before/after preview for the first 1–3 matches.
- **FR-016**: When `dryRun: false`, for each file whose content changed, the tool MUST write the modified content back via the existing `put_content` internal call, preserving the file's existing trailing-newline state byte-for-byte.
- **FR-016a**: The tool MUST preserve internal line endings byte-for-byte. The tool MUST NOT normalize line endings (no LF → CRLF or CRLF → LF conversion) on read, during replacement, or on write. If a file mixes CRLF and LF, the rewritten file MUST retain the exact mix except where the replacement substitutes new bytes. A `\n` literal in `replacement` MUST be inserted as `\n` (no platform-specific conversion to `\r\n`). This guarantee makes SC-002 (dry-run byte-identical), SC-005 (re-call returns `filesModified = 0`), and SC-007 (trailing-newline preservation) honest on cross-platform vaults.

#### Multi-vault dispatch

- **FR-017**: When `vaultId` is provided, the tool MUST resolve the per-vault REST service via the wrapper's existing `getRestService(vaultId)` plumbing and MUST route the entire walk + fetch + write surface against that resolved service.
- **FR-018**: When `vaultId` is omitted, the tool MUST route to the default vault per the wrapper's standard multi-vault pattern.
- **FR-019**: When `vaultId` does not match any configured vault, the tool MUST return a structured error and write zero files.

#### Response shape

- **FR-020**: On success, the tool MUST return a structured response containing at minimum: `ok: true`, `filesScanned` (count), `filesModified` (count), `totalReplacements` (count), and `filesSkipped` (count; zero when no files were skipped by the size cap). When `verbose: true`, the response MUST also contain `perFile` (array of `{ filename, replacements, ... }` entries). The `skipped` array MUST be present in the response whenever any file was skipped by the size cap (per FR-024a), regardless of `verbose`. On partial success (per FR-021a), the same response shape applies with `ok: false` plus a non-empty `failures` array.
- **FR-021**: On pre-sweep failure (invalid input, vault routing error, regex compile error, empty `search`, etc. — failures detected before any file is written), the tool MUST return a structured error (`ok: false` with a human-readable message) and MUST write zero files.
- **FR-021a**: On per-file failure DURING the sweep (validation already passed; one or more files have already been successfully written), the tool MUST follow best-effort-continue semantics: it MUST continue processing remaining files, MUST NOT roll back already-committed writes, and MUST return a structured partial result with `ok: false`, `filesScanned`, `filesModified` reflecting actually-written files, `totalReplacements` reflecting writes that succeeded, and a `failures` array of `{ filename, error }` entries identifying each file whose write failed. The response MUST be unambiguous about which files were modified and which were not.

#### Validation and safety

- **FR-022**: The tool MUST reject an empty `search` string with a structured error.
- **FR-023**: With `regex: true`, an invalid regex MUST surface as a structured error before any file is touched.
- **FR-024**: The tool MUST NOT process non-`.md` files even if they appear under `pathPrefix`.
- **FR-024a**: The tool MUST enforce a per-file soft size cap of 5 MB (5,242,880 bytes). Files whose fetched content exceeds the cap MUST NOT be processed (no replacement, no write). Such files MUST appear in the response under a `skipped` array of `{ filename, reason: "size_exceeded", sizeBytes }` entries. The sweep MUST continue with remaining files. Skipped files MUST NOT count toward `filesScanned` for replacement purposes (or MUST be reported as a separate `filesSkipped` count) and MUST NOT count toward `filesModified`. Skipped files are distinct from `failures` (skipped = preventatively-not-attempted; failures = attempted-and-errored).

#### Attribution

- **FR-025**: The per-note replacement module (LAYER 1) MUST carry source-header attribution to `cyanheads/obsidian-mcp-server`'s `obsidian_replace_in_note` tool, with license verified (likely MIT) and credited.
- **FR-026**: The dry-run module (LAYER 2) MUST carry source-header attribution to `blacksmithers/vaultforge`'s `grep-sub` tool when its dry-run logic or vault-walk strategy is directly ported.
- **FR-027**: The multi-vault dispatch wrapper (LAYER 3) MUST carry the project's own copyright plus a note marking it as the original-contribution layer that distinguishes this fork's find-and-replace from the upstream sources.
- **FR-028**: The `README` attributions section MUST name `cyanheads/obsidian-mcp-server`, `blacksmithers/vaultforge`, and the project itself, with the lifted-vs-original split made explicit so users understand the lineage.

### Key Entities

- **Vault**: A configured Obsidian vault, identified by `vaultId` and routed via the wrapper's `getRestService(vaultId)` plumbing. Each vault exposes its own REST surface; the tool operates on exactly one vault per call.
- **Note**: A single `.md` file inside a vault, identified by its vault-relative path. The unit of fetch, replace, and write.
- **Skipped region**: A contiguous span of bytes inside a Note (a fenced code block when `skipCodeBlocks` is set, or an HTML comment when `skipHtmlComments` is set) that is excluded from search and preserved byte-for-byte in the output.
- **Per-file result**: The record of what happened to one Note during a call — filename, replacement count, optional abridged diff preview (always present in dry-run, opt-in via `verbose` for committed runs).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can rename a recurring term across a vault containing N matches in N files in a single tool call, with one prior dry-run preview, in under 30 seconds for vaults of up to 1,000 notes.
- **SC-002**: A dry-run call against a clean working tree leaves the working tree byte-identical (zero `git status` entries) 100% of the time.
- **SC-003**: With `skipCodeBlocks: true` and `skipHtmlComments: true`, the bytes inside fenced code blocks and HTML comments are preserved byte-for-byte in 100% of regression test cases.
- **SC-004**: A multi-vault regression test exercising a non-default `vaultId` modifies files in that vault and zero files in the default vault, in 100% of test runs.
- **SC-005**: After a committed (non-dry-run) call reports `filesModified = N`, an immediate re-call with the same arguments reports `filesModified = 0`.
- **SC-006**: For a vault of 5,000 notes with no matches, the tool's `verbose: false` response is under 500 bytes (proves the response stays bounded for large vaults).
- **SC-007**: Trailing-newline state is preserved on 100% of modified files (verifiable by hashing the trailing byte before and after the call).
- **SC-008**: Users do not need to consult external documentation to know that the vault should be in a clean git state — the tool's own description says so.
- **SC-009**: A vault containing a single 6 MB note alongside normal-sized notes completes a sweep in the same time envelope as a vault without the oversized note (the oversized file is skipped, not processed); the response's `skipped` array names the oversized file with reason `size_exceeded`.

## Assumptions

- The Obsidian Local REST API plugin is installed and running for every targeted vault; the wrapper's `getRestService(vaultId)` returns a working client for the resolved vault.
- The existing `list_files_in_vault`, `list_files_in_dir`, `get_file_contents`, and `put_content` internal calls are stable and continue to honor the per-vault REST service the wrapper resolves for them.
- Vaults are single-user / single-writer at the moment a sweep runs. The tool follows best-effort last-write-wins for the read-modify-write race: if an external writer (Obsidian editor, sync plugin) modifies a note between the tool's fetch and write, the tool's write overwrites that external edit without revalidation. Mitigation is documented in the tool description (close Obsidian / pause sync; vault in clean git state; use dry-run first).
- Frontmatter is treated as raw Markdown text. Users who need typed frontmatter writes use `patch_content` with `target_type: frontmatter`.
- Inline-code spans (single-backtick) are NOT honored by `skipCodeBlocks` in this round. The brief explicitly defers them.
- Cross-file regex state (e.g., a regex that needs to see content across files) is out of scope. Each file is replaced independently.
- `cyanheads/obsidian-mcp-server` is licensed under a permissive license (likely MIT) compatible with this project's license; license verification is part of the implementation work and a prerequisite for shipping.
- The 7-vault hardened plumbing inherited from Connor Britain's upstream is the de facto multi-vault pattern; new mutating tools follow it by default.
- Performance targets in SC-001 assume the REST service serves a typical note in well under a second. The 5 MB per-file soft cap (FR-024a) bounds worst-case per-file fetch/replace/write time; files above the cap are skipped and reported, not processed. Configurable cap is out of scope for this round.
