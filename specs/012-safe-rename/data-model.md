# Data Model: Safe Rename Tool (`rename_file`) — Option B

**Feature**: 012-safe-rename | **Phase**: 1 (Design & Contracts) | **Date**: 2026-05-02 (Option B revision)

This feature is a thin composition wrapper, not a data-storage feature. The "model" here captures the **conceptual entities** the spec names, the **request and response shapes** the handler operates on, and the **state-transition** that a successful (or partially-successful) invocation effects against vault state. Implementation-facing types live in [contracts/rename_file.md](./contracts/rename_file.md); this document focuses on the conceptual model and validation rules.

The Option-B redesign expands the model substantially compared to the original Option-A version: there are now four distinct entity types (vault file, wikilink reference, **composition step**, **wikilink rewrite pass**) instead of three, and the state-transition diagram covers both pre-flight rejection (atomic) and mid-flight failure (partial state) explicitly.

---

## Conceptual entities

### 1. Vault file

**Definition**: A note (typically `.md`) or attachment (image, PDF, audio, etc.) located at a vault-relative path inside the focused vault.

**Identity**: The vault-relative path string (e.g. `Inbox/draft.md`, `images/cover.png`). Paths use forward slashes regardless of host OS, per Obsidian's vault convention. The path is the only identifier.

**Attributes** (relevant to this feature):

| Attribute | Type | Notes |
|---|---|---|
| `path` | `string` | Vault-relative; unique within the vault. |
| `kind` | `'note' \| 'attachment'` | Implicit; both kinds are in scope per Q2 (unchanged from Option A). |
| `incoming_wikilinks` | `WikilinkReference[]` | Conceptual; never enumerated by this tool. The four `find_and_replace` passes rewrite them as a side effect of the rename, but the wrapper neither reads nor counts the references itself — it relies on `find_and_replace`'s vault traversal. |

**Lifecycle relevant to this feature**: A file's `path` changes via the algorithm's step-5 (`putContent` to new_path) + step-7 (`deleteFile` from old_path) sequence. On pre-flight rejection (FR-006/007/010/012/001a), the path is unchanged. On mid-flight failure, the path may be in one of the partial states described under "State transitions" below.

### 2. Folder

**Definition**: A vault-relative directory path inside the focused vault.

**Relevance**: **Out of scope for renaming** (Q2 / FR-001a). This entity exists in the model only to be explicitly rejected. Under Option B, the rejection happens at algorithm step 1 (`rest.getFileContents(old_path)` returns a non-2xx for a folder path) — the original Option-A mechanism (`openFile`-based rejection) is obsolete (research §R6).

### 3. Wikilink reference

**Definition**: An occurrence of one of the seven reliable shapes in a vault file's body:

- `[[basename]]`
- `[[basename|alias]]`
- `[[basename#heading]]`
- `[[basename#heading|alias]]`
- `[[basename#^block-id]]`
- `![[basename]]`
- `![[basename|alias]]`

Plus the "reliable when cross-folder" full-path forms with the same suffix variants:

- `[[folder/basename]]`, `[[folder/basename#heading]]`, `[[folder/basename|alias]]`, etc.

**Identity**: Not directly addressable; references are positional within their containing file's body.

**Attributes**:

| Attribute | Type | Notes |
|---|---|---|
| `target` | `string` | The basename (or `folder/basename`) inside `[[…]]` or `![[…]]` before any `\|` (alias) or `#` (anchor). |
| `alias` | `string \| undefined` | Display text after `\|`, if present. **Preserved verbatim** during a rename via Pass A/B/C/D's `$2` (or `$3` in Pass B) capture. |
| `containing_file` | `path` | Which vault file the reference appears in. |

**State transition during rename**: When the rename succeeds, every `WikilinkReference` whose `target` matches one of the four pass regexes is rewritten so the new `target` resolves to `new_path`. The rewriting is performed by `rest.findAndReplace` (item 25), invoked four times by the wrapper (or three times for same-folder renames; Pass D is skipped). The wrapper MUST NOT inspect or modify reference text directly (SC-005); it constructs the regex strings from `<old-basename>`/`<new-basename>`/`<old-folder>`/`<new-folder>` and passes them as opaque inputs to `find_and_replace`.

**Out of scope for the integrity guarantee** (per FR-014):

- Relative-path forms: `[[../folder/basename]]`. Passes A–D do not enumerate parent-directory traversal patterns.
- Markdown-style links: `[text](path.md)`. Passes A–D target only the `[[…]]` and `![[…]]` shapes.

### 4. Composition step (NEW under Option B)

**Definition**: One of the eight named steps in the algorithm (see [contracts/rename_file.md §"Composition algorithm"](./contracts/rename_file.md)):

| Step name | Algorithm action | Atomicity |
|---|---|---|
| `pre_flight_source` | `rest.getFileContents(old_path)` — also captures content for step 5 | Pre-flight (atomic) |
| `pre_flight_destination` | `rest.getFileContents(new_path)` — collision check | Pre-flight (atomic) |
| `pre_flight_parent` | `rest.listFilesInDir(dirname(new_path))` — parent existence check | Pre-flight (atomic) |
| `read_source` | No-op (content captured at step 1) | n/a |
| `write_destination` | `rest.putContent(new_path, sourceContent)` | **Mid-flight (NOT atomic)** |
| `find_and_replace_pass_A` | `rest.findAndReplace({ pattern: <Pass A>, ... })` | **Mid-flight (NOT atomic)** |
| `find_and_replace_pass_B` | `rest.findAndReplace({ pattern: <Pass B>, ... })` | **Mid-flight (NOT atomic)** |
| `find_and_replace_pass_C` | `rest.findAndReplace({ pattern: <Pass C>, ... })` | **Mid-flight (NOT atomic)** |
| `find_and_replace_pass_D` | `rest.findAndReplace({ pattern: <Pass D>, ... })` (cross-folder only) | **Mid-flight (NOT atomic)** |
| `delete_source` | `rest.deleteFile(old_path)` | **Mid-flight (NOT atomic)** |

**Identity**: Step name string, used in the `failedAtStep` field of the FR-011 failure response.

**Lifecycle**: Each invocation of `rename_file` traverses these steps in order. Pre-flight failures (steps 1–3) exit before any mutation. Mid-flight failures (steps 5–8) leave a partial state captured by the `partialState` object.

### 5. Wikilink rewrite pass (NEW under Option B)

**Definition**: One of four regex passes (A, B, C, D) executed against the vault by `rest.findAndReplace`. Each pass targets a distinct wikilink shape family per FR-014.

**Identity**: Pass letter (`'A'`, `'B'`, `'C'`, `'D'`), used in `wikilinkPassesRun` and `wikilinkRewriteCounts` fields of the FR-011 success response.

**Attributes**:

| Attribute | Type | Notes |
|---|---|---|
| `letter` | `'A' \| 'B' \| 'C' \| 'D'` | Pass identifier |
| `regexTemplate` | `RegExp` factory | Built from `<old-basename>` (and `<old-folder>` for D) via the `buildPassN` functions in `regex-passes.ts` |
| `replacementTemplate` | `string` factory | Built from `<new-basename>` (and `<new-folder>` for D); references the regex's capture groups via `$2`/`$3` |
| `gatedOn` | `'always' \| 'crossFolder'` | Pass D is gated on `crossFolder`; A, B, C are always run |
| `flags` | `findAndReplace` options | Passed to `rest.findAndReplace` per call: `flags: 'g'`, `skipCodeBlocks: true`, `skipHtmlComments: true` |

**Behaviour per pass**:

| Pass | Targets | Pattern (with `<oldBasename>` / `<oldFolder>` regex-escaped) | Replacement |
|---|---|---|---|
| A | bare + aliased | `(?<!!)\[\[(<oldBasename>)(\|[^\]]*)?\]\]` | `[[<newBasename>$2]]` |
| B | heading-targeted (with optional alias and block-ref) | `(?<!!)\[\[(<oldBasename>)(#[^\]\|]*)(\|[^\]]*)?\]\]` | `[[<newBasename>$2$3]]` |
| C | embed (with optional alias) | `!\[\[(<oldBasename>)(\|[^\]]*)?\]\]` | `![[<newBasename>$2]]` |
| D (cross-folder only) | full-path forms | `(?<!!)\[\[<oldFolder>/(<oldBasename>)(#[^\]\|]*)?(\|[^\]]*)?\]\]` | `[[<newFolder>/<newBasename>$2$3]]` |

The `(?<!!)` negative lookbehind on Passes A, B, D ensures exclusive ownership of shape families: embeds (`![[…]]`) are handled exclusively by Pass C, never inadvertently by the others. Without the lookbehind, Pass A's regex would match the inner `[[basename]]` of `![[basename]]` and double-rewrite the embed (Pass A then Pass C), which would still produce a correct end result but violates the per-pass single-responsibility intent and breaks the `wikilinkRewriteCounts` accuracy (Pass A would over-count by the number of embed references).

The `escapeRegex` utility (research §R10) is applied to `<oldBasename>` and `<oldFolder>` before substitution into the pattern templates, so filenames containing regex metacharacters (e.g. `Foo (Bar).md`) are handled correctly.

---

## Request / response shapes

### `RenameFileRequest` (input) — UNCHANGED from Option A

| Field | Type | Required | Validation rule | Source |
|---|---|---|---|---|
| `old_path` | `string` | Yes | Non-empty after trim. Vault-relative. Treated as a file path. | FR-001 |
| `new_path` | `string` | Yes | Non-empty after trim. Vault-relative. | FR-001 |
| `vaultId` | `string \| undefined` | No | Trimmed; defaults to the configured default vault if absent. | research.md §R8 |

**Cross-field rules**:

- If `old_path === new_path` after trim, the handler returns the FR-009 idempotent no-op result without dispatching any REST call.

**Out-of-scope validation rules** (deliberately NOT enforced as wrapper-side pre-flight, except where Q1's supersession applies):

- Existence of `old_path`. **Delegated** to upstream via algorithm step 1 (`getFileContents`). FR-007.
- File-vs-folder kind of `old_path`. **Delegated**; failure manifests at step 1. FR-001a.
- Existence of `new_path`'s parent folder. **Delegated** to upstream via algorithm step 3 (`listFilesInDir`). FR-012.
- "Inside-the-vault" check for either path. **Delegated** to the underlying REST endpoints' own path resolution. FR-010.

**Q1 supersession** (the single wrapper-side pre-flight that does NOT delegate):

- Non-existence of `new_path` (collision check). **Wrapper-side** via algorithm step 2; on 200, the wrapper constructs `"destination already exists: <new_path>"` rather than propagating an upstream error. Justified because `putContent`'s default-overwrite semantic would silently violate FR-006 if the check were omitted.

### `RenameFileResponse` — Option B success shape (significantly expanded from Option A)

| Field | Type | Always present? | Notes |
|---|---|---|---|
| `ok` | `true` | Yes | Discriminant; success vs mid-flight failure |
| `oldPath` | `string` | Yes | Echo of validated `old_path` (FR-011) |
| `newPath` | `string` | Yes | Echo of validated `new_path` (FR-011) |
| `wikilinkPassesRun` | `Array<'A' \| 'B' \| 'C' \| 'D'>` | Yes | Subset of `['A', 'B', 'C', 'D']`; empty for FR-009 no-op; `['A', 'B', 'C']` for same-folder rename; `['A', 'B', 'C', 'D']` for cross-folder rename |
| `wikilinkRewriteCounts` | `{ passA, passB, passC, passD }` (each `number \| null`) | Yes | Per-pass count of references rewritten; `null` for skipped passes (Pass D on same-folder rename, all passes on FR-009 no-op) |
| `totalReferencesRewritten` | `number` | Yes | Sum of non-null counts |

Returned to the MCP client as a single `text` content block whose body is the pretty-printed JSON of this shape (research.md §R7).

### `RenameFileResponse` — Option B mid-flight failure shape

| Field | Type | Always present? | Notes |
|---|---|---|---|
| `ok` | `false` | Yes | Discriminant |
| `oldPath` | `string` | Yes | Echo of validated `old_path` |
| `newPath` | `string` | Yes | Echo of validated `new_path` |
| `failedAtStep` | `string` | Yes | One of: `read_source`, `write_destination`, `find_and_replace_pass_A` / `_B` / `_C` / `_D`, `delete_source` |
| `partialState` | `{ destinationWritten, passesCompleted, sourceDeleted }` | Yes | Boolean and array fields naming what was successfully done before the failure |
| `error` | `string` | Yes | Upstream error message verbatim |

Returned to the MCP client as a single `text` content block flagged with `isError: true`. Pre-flight failures (steps 1–3) do NOT use this shape — they propagate the upstream typed error and the dispatcher's outer try/catch wraps it into the standard MCP error shape (failure path #2 in [contracts/rename_file.md §"Output: failure"](./contracts/rename_file.md)).

### Validation error (zod) — UNCHANGED from Option A

The handler catches `z.ZodError` and rethrows as a plain `Error` with the field path inlined (`Invalid input — old_path: …`). The dispatcher converts this to an MCP error result. This is the only locally-caught exception aside from the FR-011 mid-flight wrap.

---

## State transitions

Two distinct transition flows depending on whether the failure (if any) occurs pre-flight or mid-flight:

### Flow A: Success or pre-flight rejection (atomicity holds — SC-003)

```text
              rename_file(old_path, new_path) — pre-flight rejection or full success
              ─────────────────────────────────────────▶
   ┌──────────────────────┐         ┌──────────────────────────────────────┐
   │ Vault state BEFORE   │  ────▶  │ Vault state AFTER (success):         │
   │  • file at old_path  │         │  • file at new_path                  │
   │  • [[old]] × N       │         │  • [[new]] × N (after Passes A–D)    │
   │  • ![[old]] × M      │         │  • ![[new]] × M (after Pass C)       │
   │                      │  ────▶  │ Vault state AFTER (pre-flight reject):│
   │                      │         │  • IDENTICAL to BEFORE (atomicity)    │
   └──────────────────────┘         └──────────────────────────────────────┘
```

### Flow B: Mid-flight failure (atomicity does NOT hold — FR-015)

```text
              rename_file(old_path, new_path) — mid-flight failure at step N (N ∈ {5,6,7})
              ─────────────────────────────────────────▶
   ┌──────────────────────┐         ┌──────────────────────────────────────────┐
   │ Vault state BEFORE   │  ────▶  │ Vault state AFTER (partial — depends on N):│
   │  • file at old_path  │         │                                            │
   │  • [[old]] × N       │         │  N = write_destination: vault unchanged    │
   │  • ![[old]] × M      │         │    OR file partially written at new_path   │
   │                      │         │                                            │
   │                      │         │  N = find_and_replace_pass_A: file at new  │
   │                      │         │    AND file at old; wikilinks unchanged    │
   │                      │         │                                            │
   │                      │         │  N = find_and_replace_pass_B/C/D: file at  │
   │                      │         │    new AND file at old; SOME passes        │
   │                      │         │    completed (passesCompleted array)       │
   │                      │         │                                            │
   │                      │         │  N = delete_source: file at new AND file   │
   │                      │         │    at old; ALL passes completed; wikilinks │
   │                      │         │    point to new                            │
   └──────────────────────┘         └──────────────────────────────────────────┘

   Recovery: `git restore .` from the pre-call commit reverses any partial state.
   The git-clean precondition (FR-005(b)) is the documented baseline.
```

---

## Persistence model

**None for the wrapper itself.** This tool reads no local state, writes no local state, maintains no cache, and depends on no schema migrations. All state is in the Obsidian vault and is mutated exclusively via the five composed REST primitives.

**Recovery model**: Git, not the wrapper. The mid-flight failure responses include enough information for the caller (or an operator) to reverse partial state via `git restore .`, but no automated rollback is built into the wrapper (research §R11; FR-015).
