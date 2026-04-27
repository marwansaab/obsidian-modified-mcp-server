# Quickstart: Normalise Path Separators for Graph Tools

**Feature**: [spec.md](spec.md)
**Plan**: [plan.md](plan.md)
**Date**: 2026-04-27

Three verification flows to confirm the fix on Windows: a manual smoke test against a real vault, an automated test run, and an MCP `tools/list` schema check.

---

## 1. Manual smoke test against a real Obsidian vault (Windows)

**Prerequisite**: A vault configured with `OBSIDIAN_VAULT_PATH` pointing at a directory that contains a nested file. The bug-report fixture was `000-Meta/Vault Identity.md`; any nested `.md` file works.

### Step 1.1 — Reproduce the original bug (pre-fix baseline, optional)

If you want to confirm the bug exists before applying the fix, on the `main` branch (or a commit before `006-normalise-graph-paths`):

```text
Tool call: get_note_connections
Args: { "filepath": "000-Meta/Vault Identity.md" }

Expected (pre-fix):
  Error: note not found: 000-Meta/Vault Identity.md

Tool call: get_note_connections
Args: { "filepath": "000-Meta\\Vault Identity.md" }

Expected (pre-fix):
  { "filepath": "000-Meta\\Vault Identity.md.md", "outgoingLinks": [...], "backlinks": [...], "tags": [...] }
```

The discrepancy between forward-slash (error) and backslash (success) for the same file is the bug.

### Step 1.2 — Verify the fix

After checking out `006-normalise-graph-paths` and running `npm install && npm run build`:

```text
Tool call: get_note_connections
Args: { "filepath": "000-Meta/Vault Identity.md" }

Expected (post-fix):
  { "filepath": "000-Meta\\Vault Identity.md.md", "outgoingLinks": [...], "backlinks": [...], "tags": [...] }
  # Note: response filepath is the OS-native graph node ID; this is unchanged from pre-fix backslash behaviour.

Tool call: get_note_connections
Args: { "filepath": "000-Meta\\Vault Identity.md" }

Expected (post-fix):
  Identical payload to the forward-slash call (same outgoingLinks, backlinks, tags).

Tool call: get_note_connections
Args: { "filepath": "does-not-exist.md" }

Expected (post-fix):
  Error: note not found: does-not-exist.md
  # Genuinely missing files still surface a clear error (FR-006 / Story 1 acceptance scenario 3).

Tool call: get_note_connections
Args: { "filepath": "000-Meta\\subdir/file.md" }

Expected (post-fix):
  If 000-Meta/subdir/file.md exists in the vault, returns its connections payload.
  Mixed separators normalise to the same indexed entry as the canonical form (FR-005 / spec edge cases).
```

Then for `find_path_between_notes`:

```text
Tool call: find_path_between_notes
Args: { "source": "000-Meta/Vault Identity.md", "target": "010-Notes/Reference.md" }

Expected (post-fix):
  Either { "path": ["000-Meta\\Vault Identity.md", ..., "010-Notes\\Reference.md"] }
  or     { "path": null }   # no link path between the two
  Never  Error: note not found: ...   # when both files exist
```

For `find_similar_notes`, this also verifies the fix to the dispatcher gap (the tool was previously unreachable; now callable when Smart Connections is configured):

```text
Tool call: find_similar_notes
Args: { "filepath": "000-Meta/Vault Identity.md" }

Pre-fix expected:  Error: Unknown tool: find_similar_notes
Post-fix expected: Smart Connections payload (or "Smart Connections not configured" if smartConnectionsPort env is unset)
                   — never "Unknown tool" and never "note not found" due to separator form.
```

---

## 2. Automated test run

From the repo root:

```bash
npm install
npm run lint
npm run typecheck
npm run build
npm run test
```

For just this feature's tests:

```bash
npm run test -- tests/utils tests/tools/graph tests/tools/semantic-tools
```

What each block asserts:

### `tests/utils/path-normalisation.test.ts`

Pure unit tests for the new helper module. Asserts:

- `toOsNativePath('a/b/c')` → `a${sep}b${sep}c` (uses `path.sep` so the assertion is platform-correct).
- `toOsNativePath('a\\b\\c')` → `a${sep}b${sep}c`.
- `toOsNativePath('a/b\\c')` → `a${sep}b${sep}c` (mixed input, single canonical output).
- `toForwardSlashPath('a\\b\\c')` → `'a/b/c'`.
- `toForwardSlashPath('a/b\\c')` → `'a/b/c'`.
- Idempotence: `toOsNativePath(toOsNativePath(x)) === toOsNativePath(x)` for a representative input set; same for `toForwardSlashPath`.
- Length-preservation: `output.length === input.length`.
- Empty string in → empty string out (both helpers).
- Top-level filename (`'README.md'`) → unchanged (both helpers).
- Leading separator preserved.
- Trailing separator preserved.
- `isAbsolutePath('a/b')` returns false; `isAbsolutePath` agrees pre/post normalisation for the same input.

### `tests/tools/graph/handler-per-note.test.ts` (extended)

The existing per-note handler test gains separator regression cases:

- `handleGetNoteConnections` with forward-slash nested filepath returns the same payload as the backslash form. (FR-001, FR-008.)
- `handleGetNoteConnections` with mixed-separator filepath returns the same payload. (FR-005.)
- `handleGetNoteConnections` with a forward-slash nested filepath that does not exist still throws `note not found:`. (FR-006 / Story 1 acceptance scenario 3.)
- `handleFindPathBetweenNotes` with both arguments forward-slash returns either a path or `null` — never `note not found:` when both files exist. (FR-002.)
- `handleFindPathBetweenNotes` with one valid and one missing forward-slash arg throws `note not found:` identifying the missing one. (Story 2 acceptance scenario 3.)

Both index-backed tools share the FR-008 regression-test mandate; covering them in the existing per-note test file keeps the matrix tight.

### `tests/tools/semantic-tools/registration.test.ts`

Asserts `find_similar_notes` appears in `ALL_TOOLS` exactly once and that its `inputSchema` is the derived `zodToJsonSchema` form (has `properties.filepath` of type `string` with `minLength: 1`).

### `tests/tools/semantic-tools/schema.test.ts`

Asserts `FindSimilarNotesRequestSchema`:

- Rejects empty / missing / whitespace `filepath` with the field-path in the error.
- Accepts valid input with optional `limit` / `threshold` / `vaultId`.
- Rejects `threshold` outside `[0, 1]`.
- Rejects non-positive `limit`.

### `tests/tools/semantic-tools/find-similar-handler.test.ts`

Uses `nock` to mock the `/search/similar` endpoint:

- (a) Forward-slash input → POST body's `path` field is the same forward-slash form (no double-conversion); response payload is returned to the caller.
- (b) Backslash input → POST body's `path` field is normalised to forward-slash; response payload is returned.
- (c) Vault is not configured for Smart Connections → clear error.
- (d) Upstream returns 404 → clear "Similar notes endpoint not available" error preserved (existing behaviour, not changed by this feature).

---

## 3. MCP `tools/list` schema check

Run the server and inspect the published tool list:

```bash
npm run start
# (or via the MCP host of your choice — the dev/IDE harness will issue tools/list)
```

Verify:

- `find_similar_notes` appears with an `inputSchema` whose `properties.filepath` has `description` containing "Forward-slash or backslash separators both accepted." (per [data-model.md FindSimilarNotesRequestSchema](data-model.md#findsimilarnotesrequest-zod--srctoolssemantic-toolsts)).
- `get_note_connections` and `find_path_between_notes` schemas are unchanged from the pre-fix state (no schema-level signal of the fix; the change is in handler behaviour only).

---

## Pre-existing latent issues observed but NOT fixed by this feature

While preparing the plan we observed two adjacent issues that this feature deliberately leaves alone:

1. The `semantic_search` tool ([src/tools/semantic-tools.ts:9](../../src/tools/semantic-tools.ts#L9)) is also unwired in the dispatcher — calling it returns `Unknown tool: semantic_search`. It does not take a filepath argument and is unrelated to separator normalisation, so it is out of scope for this feature. See [research.md R5](research.md#r5--dispatcher-gap-for-find_similar_notes).
2. Error messages from `note not found:` paths use the post-normalisation form (backslash on Windows) regardless of the caller's input form. This is a cosmetic-only UX point and is acceptable per FR-006; see [research.md R4](research.md#r4--error-message-form-when-the-lookup-misses).

Neither blocks the spec's acceptance criteria.
