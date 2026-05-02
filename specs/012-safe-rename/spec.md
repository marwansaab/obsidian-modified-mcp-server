# Feature Specification: Safe Rename Tool

**Feature Branch**: `012-safe-rename`  
**Created**: 2026-05-02  
**Status**: Draft  
**Input**: User description: "Safe Rename Tool — A new MCP tool rename_file that renames a file in the vault while preserving wikilink integrity vault-wide. The tool accepts an old_path and a new_path. It dispatches Obsidian's built-in 'Rename file' command via the existing execute_command infrastructure (POST /commands/{commandId}/) rather than issuing a filesystem-level rename — this triggers Obsidian's 'Automatically update internal links' behaviour so every [[wikilink]] referencing the old name is rewritten in the same operation. The tool requires Obsidian's 'Automatically update internal links' setting to be enabled in the focused vault (Settings → Files & Links). The MCP tool description states this precondition explicitly so it's visible in the tool schema. If the setting is disabled, this tool's wikilink-integrity guarantee does not hold; callers are expected to verify the setting is on before relying on this tool. The tool does not parse files or implement any link-rewriting logic of its own — it composes the existing execute_command tool behind a friendlier interface."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rename a file and keep every wikilink intact (Priority: P1)

An LLM agent or human caller wants to rename a note in the vault — for example, moving `Inbox/draft.md` to `Projects/Project-X/overview.md` — and have every existing `[[draft]]` or `[[Inbox/draft]]` reference across the entire vault automatically updated to point at the new location. The caller invokes `rename_file` with the old and new paths and trusts that no incoming links will break.

**Why this priority**: This is the entire purpose of the feature. Vault-wide link integrity is the single guarantee that distinguishes this tool from a plain filesystem move. Without this story working, the tool has no reason to exist.

**Independent Test**: In a vault with the "Automatically update internal links" setting enabled and at least one note containing `[[old-name]]`, call `rename_file` with `old_path` pointing at `old-name.md` and a new `new_path`. Verify that (a) the file now lives at `new_path`, (b) the original path no longer exists, and (c) every referencing note's wikilink has been rewritten to point at the new name.

**Acceptance Scenarios**:

1. **Given** a vault with `notes/alpha.md` and a separate note `index.md` containing the body `See [[alpha]] for details.`, **When** the caller invokes `rename_file` with `old_path="notes/alpha.md"` and `new_path="notes/beta.md"`, **Then** `notes/beta.md` exists, `notes/alpha.md` does not, and `index.md` reads `See [[beta]] for details.`
2. **Given** a vault where many notes link to `Inbox/draft.md` using a mix of `[[draft]]`, `[[Inbox/draft]]`, and `[[draft|alias]]` forms, **When** the caller renames the file to `Projects/Project-X/overview.md`, **Then** every variant in every referencing note is updated to the equivalent reference for the new path while user-supplied aliases are preserved.
3. **Given** a successful rename, **When** the tool returns, **Then** the response confirms which file was renamed and to where, so the caller can chain follow-up operations without a second lookup.

---

### User Story 2 - Refuse to rename when the target already exists (Priority: P2)

A caller mistakenly issues a rename whose `new_path` collides with an existing file. The tool must not silently overwrite or merge — it must surface the conflict so the caller can choose a different name or explicitly delete the conflicting file first.

**Why this priority**: Silent overwrite would destroy user data. This safety property is required for the tool to be usable autonomously by an agent, but it is secondary to the core rename behaviour in Story 1.

**Independent Test**: In a vault containing both `a.md` and `b.md`, invoke `rename_file` with `old_path="a.md"` and `new_path="b.md"`. Verify that the tool returns an error identifying the collision and that both files remain untouched on disk.

**Acceptance Scenarios**:

1. **Given** `a.md` and `b.md` both exist in the vault, **When** the caller invokes `rename_file(old_path="a.md", new_path="b.md")`, **Then** the tool returns an error indicating the destination already exists and no files are modified.
2. **Given** the rename was rejected for any reason (collision, missing source, malformed path), **When** the caller inspects the vault afterwards, **Then** every file is in the same state as before the call — no partial rename, no partial link rewrite.

---

### User Story 3 - Make the link-integrity precondition discoverable (Priority: P2)

An agent reading the MCP tool catalogue should be able to learn, from the tool description alone, that `rename_file`'s wikilink-integrity guarantee depends on a specific Obsidian setting being enabled. The agent (or its operator) can then verify that setting before adopting the tool, rather than discovering the gap by losing links in production.

**Why this priority**: The guarantee is conditional. If the precondition is hidden from the tool schema, callers will form an incorrect mental model and use the tool unsafely. Surfacing the precondition is what makes the conditional guarantee acceptable.

**Independent Test**: Inspect the MCP tool list (e.g., via `tools/list` or whatever the MCP client uses to discover tools). Verify that the `rename_file` description text explicitly names the required Obsidian setting ("Automatically update internal links" under Settings → Files & Links) and states that the wikilink guarantee does not hold when that setting is off.

**Acceptance Scenarios**:

1. **Given** any MCP client connected to this server, **When** it lists available tools, **Then** the description for `rename_file` names the required Obsidian setting and the location to find it in Obsidian's UI.
2. **Given** the description is read by a human or an LLM, **When** they reason about whether the tool is safe to use, **Then** the description gives them enough information to know they should verify the setting first — without needing to read the source code or external docs.

---

### Edge Cases

- **Source file does not exist**: `old_path` points to a path the vault does not contain. The tool must return an error identifying the missing source and must not create an empty file at `new_path`.
- **Source and destination are identical**: `old_path == new_path`. The tool should return without modifying anything (and without erroring as if it were a real failure), so callers performing idempotent operations are not punished.
- **Cross-folder rename**: `new_path` is in a different folder than `old_path`, and the destination folder does not yet exist. The tool relies on Obsidian's built-in command behaviour for folder handling; if Obsidian's command fails because the parent folder is missing, the tool surfaces that failure rather than silently creating folders behind Obsidian's back.
- **Path outside the vault**: Either path resolves outside the focused vault. The tool must reject the call rather than attempt the rename.
- **Underlying Obsidian command fails**: The dispatched "Rename file" command returns a non-success response (e.g., file is locked, plugin error, vault read-only). The tool must surface the underlying failure to the caller in enough detail to diagnose, and must not claim success.
- **Setting is disabled at call time**: The "Automatically update internal links" setting is off. The tool still dispatches the command and the file rename succeeds, but referencing wikilinks are NOT rewritten. The tool does not detect this state — it is documented as a caller responsibility (see Assumptions).
- **Unicode and special-character filenames**: Names containing spaces, non-ASCII characters, or characters legal in the vault but awkward at the OS level must be passed through unchanged so Obsidian's own rename logic handles them.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The MCP server MUST expose a tool named `rename_file` that accepts two required string parameters, `old_path` and `new_path`, both interpreted as vault-relative paths.
- **FR-002**: `rename_file` MUST perform the rename by dispatching Obsidian's built-in "Rename file" command through the existing `execute_command` infrastructure (`POST /commands/{commandId}/`), and MUST NOT perform a filesystem-level rename, copy, or write of its own.
- **FR-003**: `rename_file` MUST be implemented as a thin composition over the existing `execute_command` tool — it MUST NOT contain any logic that parses note contents or rewrites wikilinks itself.
- **FR-004**: When the rename succeeds, every wikilink in the vault that referenced the old path MUST be updated to reference the new path, by virtue of Obsidian's "Automatically update internal links" behaviour being triggered (provided the user-controlled precondition in FR-005 holds).
- **FR-005**: The tool's MCP description (the `description` field exposed in the tool schema) MUST explicitly state that wikilink integrity depends on Obsidian's "Automatically update internal links" setting being enabled, and MUST name where to find that setting in Obsidian's UI (Settings → Files & Links).
- **FR-006**: `rename_file` MUST refuse to proceed when `new_path` already identifies an existing file in the vault, returning an error that names the conflict; no file content or links may be modified in this case.
- **FR-007**: `rename_file` MUST refuse to proceed when `old_path` does not identify an existing file in the vault, returning an error that names the missing source; no file may be created at `new_path` in this case.
- **FR-008**: `rename_file` MUST surface failures from the underlying Obsidian command (including failures caused by a missing destination folder, a locked file, or any non-success response) to the caller, and MUST NOT report success unless the underlying command reported success.
- **FR-009**: When `old_path` and `new_path` are equal, `rename_file` MUST return a non-error result without modifying the vault.
- **FR-010**: `rename_file` MUST reject paths that resolve outside the focused vault and MUST NOT attempt the rename in that case.
- **FR-011**: On success, the tool's response MUST identify both the original path and the resulting path, so the caller can confirm what changed without issuing a follow-up read.

### Key Entities *(include if feature involves data)*

- **Vault file**: A note or attachment located at a vault-relative path. Identified by its path. Has zero or more incoming wikilinks from other vault files.
- **Wikilink reference**: An occurrence of `[[target]]`, `[[target|alias]]`, `[[folder/target]]`, or `[[folder/target|alias]]` inside a vault file's body, whose `target` resolves (under Obsidian's resolution rules) to a specific vault file. When the target file is renamed with the relevant Obsidian setting enabled, Obsidian rewrites the reference text so that it continues to resolve to the same underlying file.
- **Obsidian "Rename file" command**: A built-in command exposed by Obsidian (and by this server's existing command infrastructure) that performs the rename and, conditionally on a user setting, updates referencing wikilinks in the same operation. Identified by its Obsidian command id.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a vault with the required setting enabled, 100% of incoming `[[wikilink]]` references to the renamed file are updated by a single `rename_file` call, with no caller-side post-processing.
- **SC-002**: An MCP-aware agent reading only the tool catalogue (no source code, no external docs) can correctly identify the required Obsidian setting and where to find it in Obsidian's UI — the description must contain the setting name and its UI location verbatim.
- **SC-003**: When the call is rejected (collision, missing source, out-of-vault path, underlying command failure), zero files in the vault are modified — the vault is byte-for-byte identical to its pre-call state.
- **SC-004**: A caller can rename a file and learn its final path from the tool's response in a single round-trip, with no follow-up call needed to confirm.
- **SC-005**: The implementation adds zero new code paths that read or write note contents directly — measured by the implementation containing no file-content parsing or link-rewriting logic of its own beyond invoking `execute_command`.

## Assumptions

- The Obsidian instance the MCP server is connected to has the Local REST API plugin (or equivalent) enabled and reachable, since `execute_command` already depends on that.
- The Obsidian command id for "Rename file" is stable enough to be hard-coded or discoverable via the existing command-list endpoint; verifying the exact id is an implementation-time concern, not a spec-time one.
- The user (not the tool) is responsible for ensuring "Automatically update internal links" is enabled in the focused vault before relying on this tool's link-integrity guarantee. The tool documents the requirement in its description but does not programmatically detect the setting's state.
- "Vault-wide" means every file Obsidian considers part of the focused vault. The tool inherits whatever scope Obsidian's own rename command applies — it does not attempt to extend or narrow that scope.
- Markdown-style links of the form `[text](path.md)` are out of scope for the integrity guarantee unless Obsidian's own "Automatically update internal links" behaviour already covers them; this tool inherits Obsidian's coverage exactly and does not add to it.
- Callers are expected to be either humans driving an MCP client or LLM agents; both are assumed capable of reading the tool description before invoking the tool.
