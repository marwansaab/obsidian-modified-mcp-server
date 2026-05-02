# Data Model: Safe Rename Tool (`rename_file`)

**Feature**: 012-safe-rename | **Phase**: 1 (Design & Contracts) | **Date**: 2026-05-02

This feature is a thin composition wrapper, not a data-storage feature, so the "model" here is small: it captures the **request and response shapes** the handler operates on, the **conceptual entities** the spec already named, and the **state-transition** that a successful invocation effects against vault state. Implementation-facing types live in [contracts/rename_file.md](./contracts/rename_file.md); this document focuses on the conceptual model and validation rules.

---

## Conceptual entities

These are promoted from the spec's "Key Entities" section. They are not new database tables — they are Obsidian-side concepts the tool operates over.

### 1. Vault file

**Definition**: A note (typically `.md`) or attachment (image, PDF, audio, etc.) located at a vault-relative path inside the focused vault.

**Identity**: The vault-relative path string (e.g. `Inbox/draft.md`, `images/cover.png`). Paths use forward slashes regardless of host OS, per Obsidian's vault convention. The path is the only identifier.

**Attributes** (relevant to this feature):

| Attribute | Type | Notes |
|---|---|---|
| `path` | `string` | Vault-relative; unique within the vault. |
| `kind` | `'note' \| 'attachment'` | Implicit; determined by Obsidian. The tool does not branch on this — both kinds are in scope per Q2. |
| `incoming_wikilinks` | `WikilinkReference[]` | Conceptual; never enumerated by this tool. Obsidian's command rewrites these as a side effect of the rename. |

**Lifecycle relevant to this feature**: A file's `path` changes exactly once per successful `rename_file` invocation (from `old_path` to `new_path`). On failure, the path is unchanged (FR-008, SC-003).

### 2. Folder

**Definition**: A vault-relative directory path inside the focused vault.

**Relevance**: **Out of scope for renaming** (Q2 / FR-001a). This entity exists in the model only to be explicitly rejected: any `old_path` that resolves to a folder must be rejected per the FR-001a requirement, and the rejection happens by error propagation from the upstream `openFile` / `executeCommand` calls (per [research.md](./research.md) R6, no pre-flight check). A future `rename_folder` tool will own folder-renaming semantics.

### 3. Wikilink reference

**Definition**: An occurrence of `[[target]]`, `[[target|alias]]`, `[[folder/target]]`, or `[[folder/target|alias]]` inside a vault file's body, whose `target` resolves under Obsidian's resolution rules to a specific vault file. Embed links of the form `![[target]]` are the same shape with a leading `!` and resolve to the same target file; for the purposes of this tool, embed links are treated identically to wikilinks (per the "Embed link integrity (attachments)" edge case in the spec).

**Identity**: Not directly addressable; references are positional within their containing file's body.

**Attributes**:

| Attribute | Type | Notes |
|---|---|---|
| `target` | `string` | The text inside `[[…]]` before any `\|` (alias) or `#` (anchor). |
| `alias` | `string \| undefined` | Display text after `\|`, if present. **Preserved verbatim** during a rename. |
| `containing_file` | `path` | Which vault file the reference appears in. |

**State transition during rename**: When the rename succeeds AND Obsidian's "Automatically update internal links" setting is enabled (FR-005 precondition), every `WikilinkReference` whose `target` resolved to the renamed file is rewritten so `target` resolves to the new path; `alias` is preserved (FR-004a). The same rewrite applies to embed references `![[target]]` referencing the renamed file (FR-004), which is the path that covers attachment renames. This rewriting is performed entirely by Obsidian — this tool MUST NOT inspect or modify reference text (SC-005).

### 4. Obsidian command

**Definition**: A registered command exposed by Obsidian's command palette and dispatchable via the Local REST API plugin's `POST /commands/{commandId}/` endpoint.

**Identity**: A string `commandId` (e.g. `workspace:edit-file-title` — exact id confirmed by the implementation-time spike per R2/R5 in [research.md](./research.md)).

**Attributes relevant to this feature**:

| Attribute | Type | Notes |
|---|---|---|
| `id` | `string` | Stable identifier; hardcoded in `handler.ts` as a single named constant after the spike resolves it. |
| `operates_on` | `'active_file'` (implicit) | Per R3 in [research.md](./research.md), Obsidian commands target the workspace's active editor. The handler must call `openFile(old_path)` before dispatching. |

---

## Request / response shapes

The handler operates on three values: the validated request, the void return from the dispatched command, and the synthesised response. The wire-level zod schema lives in [contracts/rename_file.md](./contracts/rename_file.md); the conceptual shapes are:

### `RenameFileRequest` (input)

| Field | Type | Required | Validation rule | Source |
|---|---|---|---|---|
| `old_path` | `string` | Yes | Non-empty after trim. Vault-relative. Treated as a file path; folder paths produce error propagation per FR-001a. | FR-001 |
| `new_path` | `string` | Yes | Non-empty after trim. Vault-relative. | FR-001 |
| `vaultId` | `string \| undefined` | No | Trimmed; defaults to the configured default vault if absent. | R8 in [research.md](./research.md) |

**Cross-field rules**:

- If `old_path === new_path` after trimming, the handler returns the FR-009 idempotent no-op result without dispatching any REST call. This is the only cross-field check; all other validation is delegated to Obsidian per Q1.

**Out-of-scope validation rules** (deliberately NOT enforced by this tool, per Q1's pure-delegation contract — all of these are handled by error propagation from the upstream `openFile`/`executeCommand` calls, with the resulting error message coming from Obsidian rather than the tool):

- Existence of `old_path`. Delegated to upstream `openFile` / `executeCommand`. (FR-007.)
- File-vs-folder kind of `old_path`. Delegated; failure manifests at `openFile` time. (FR-001a.)
- Non-existence of `new_path` (collision check). Delegated to upstream `executeCommand`. (FR-006.)
- Existence of `new_path`'s parent folder. Delegated. (FR-012.)
- "Inside-the-vault" check for either path. Delegated to the underlying REST endpoints' own path resolution, which will fail for paths that escape the vault. (FR-010 — note that `axios` URL composition + the REST plugin's path resolution together form the boundary; this tool does not add a separate `..`/absolute-path filter.)

### `RenameFileResponse` (success output)

| Field | Type | Notes |
|---|---|---|
| `old_path` | `string` | Echo of the validated `old_path` (FR-011, SC-004). |
| `new_path` | `string` | Echo of the validated `new_path` (FR-011, SC-004). |

Returned to the MCP client as a single `text` content block whose body is the pretty-printed JSON of this shape (R7 in [research.md](./research.md)).

### Error output

The handler does not construct error objects. Per Q1 / Principle IV, errors propagate as one of:

- `z.ZodError` from boundary validation, rethrown as a plain `Error` with the field path inlined (matches the [list-tags handler pattern](../../src/tools/list-tags/handler.ts)).
- `ObsidianApiError` / `ObsidianTimeoutError` / `ObsidianNotFoundError` from `safeCall` inside `rest.openFile` or `rest.executeCommand`. The dispatcher's outer try/catch in [src/index.ts](../../src/index.ts) wraps these into the MCP `{content, isError: true}` shape.

The contract file documents the precise text/shape consumers can expect. The handler itself contributes zero error-construction code beyond the zod re-throw.

---

## State transitions

Single transition, performed by Obsidian (not by this tool):

```text
              rename_file(old_path, new_path)  
              ───────────────────────────▶
   ┌──────────────────────┐         ┌──────────────────────┐
   │ Vault state BEFORE   │         │ Vault state AFTER    │
   │  • file at old_path  │  ────▶  │  • file at new_path  │
   │  • [[old_target]] ×N │         │  • [[new_target]] ×N │
   │  • ![[old]] ×M       │         │  • ![[new]] ×M       │
   └──────────────────────┘         └──────────────────────┘

   Preconditions for the wikilink/embed rewrite portion:
     • "Automatically update internal links" setting is ON (FR-005)
     • Underlying Obsidian command succeeded (FR-008)
```

If the rename fails at any point (folder rejection, missing source, collision, missing parent folder, locked file, plugin error, vault read-only, etc.), the AFTER state equals the BEFORE state — byte-for-byte (SC-003). The tool does not emit a partial state.

---

## Persistence model

**None**. This tool reads no local state, writes no local state, maintains no cache, and depends on no schema migrations. All state is in the Obsidian vault and is mutated exclusively by Obsidian's own command in response to the dispatched REST call.
