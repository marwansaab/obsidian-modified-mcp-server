# Quickstart: Safe Rename Tool (`rename_file`)

**Feature**: 012-safe-rename | **Phase**: 1 (Design & Contracts) | **Date**: 2026-05-02
**Audience**: The implementer of this feature, and anyone manually verifying the tool against a real Obsidian instance.

This document covers two things in order:

1. **Pre-implementation verification spike** (R5 in [research.md](./research.md)) — must run BEFORE substantial handler code is committed, because it confirms the feature's mechanism is feasible at all.
2. **Post-implementation manual smoke test** — the end-to-end golden path, run after the handler is wired up but before the PR is opened.

The test suite (vitest) covers the unit-level contract; this document covers what only a real Obsidian + Local REST API instance can prove.

---

## Prerequisites

You need:

- A running Obsidian desktop instance with the **Local REST API plugin** (coddingtonbear/obsidian-local-rest-api) installed and enabled.
- A scratch vault (do **NOT** use a vault containing irreplaceable notes — the spike performs real renames).
- The vault's API key from Local REST API plugin settings.
- `OBSIDIAN_API_KEY`, `OBSIDIAN_HOST`, `OBSIDIAN_PORT`, `OBSIDIAN_PROTOCOL` configured for the scratch vault (see [README.md](../../README.md) §"Environment Variables").
- `curl` or any HTTP client. The examples below use `curl`; equivalents in a REST GUI (Insomnia, Bruno) work the same.

In Obsidian, confirm:

- **Settings → Files & Links → "Automatically update internal links" is ON.** (This is the FR-005 precondition. If it's off, the rename will succeed but wikilinks won't be rewritten — defeating the entire purpose of the tool.)

In a fresh terminal:

```sh
export OBS_HOST="https://127.0.0.1:27124"   # or whatever your config has
export OBS_KEY="<your local-rest-api key>"
alias obs='curl -ksS -H "Authorization: Bearer $OBS_KEY"'
```

---

## Part 1 — Pre-implementation feasibility spike

**Why first**: R4/R5 in [research.md](./research.md) flag that conveying `new_path` to Obsidian's "Rename file" command via `POST /commands/{commandId}` is an unverified mechanism. Stock Obsidian command-palette commands take no arguments and the rename command typically opens a UI input. If the spike fails, do NOT write handler code — escalate to the user (see "If the spike fails" below).

### Step 1: Set up the spike vault state

In your scratch vault, create three files (open Obsidian, click "New note" twice, paste content):

- **`notes/spike-source.md`**:

  ```markdown
  # Spike source
  
  Some content. This file is the rename target.
  ```

- **`notes/index.md`**:

  ```markdown
  # Index
  
  See [[spike-source]] for details.
  Another reference: [[notes/spike-source]].
  An aliased one: [[spike-source|the source]].
  ```

- **`notes/control.md`**:

  ```markdown
  # Control
  
  This file is unchanged by the spike. Verify after.
  ```

### Step 2: Discover candidate command ids

```sh
obs "$OBS_HOST/commands/" | jq '.commands[] | select(.name | test("rename"; "i"))'
```

Expected output: one or more entries like:

```json
{ "id": "workspace:edit-file-title", "name": "Rename file" }
```

Note every candidate `id`.

### Step 3: For each candidate, run the rename and observe

For each candidate id (the most likely one is `workspace:edit-file-title`):

```sh
# 3a. Open the source file (so it becomes the active editor).
obs -X POST "$OBS_HOST/open/?file=notes/spike-source.md"

# 3b. Try dispatching the candidate command. Try several body shapes:
obs -X POST "$OBS_HOST/commands/workspace:edit-file-title/"
# If the above just opens a UI input and nothing happens server-side, also try:
obs -X POST "$OBS_HOST/commands/workspace:edit-file-title/" \
  -H "Content-Type: application/json" \
  -d '{"newName": "spike-target"}'
obs -X POST "$OBS_HOST/commands/workspace:edit-file-title/" \
  -H "Content-Type: application/json" \
  -d '{"newPath": "notes/spike-target.md"}'

# 3c. Inspect Obsidian: did a rename happen on disk?
obs "$OBS_HOST/vault/notes/" | jq '.files'
# Expect: the array now contains "spike-target.md" and NO "spike-source.md".

# 3d. Did the wikilinks update?
obs "$OBS_HOST/vault/notes/index.md" -H "Accept: text/markdown"
# Expect: every [[spike-source]] / [[notes/spike-source]] / [[spike-source|alias]]
# is now [[spike-target]] / [[notes/spike-target]] / [[spike-target|alias]].
```

### Step 4: Pass / fail

**Pass criteria** (both must hold):

1. Exactly one command id (and one body shape) produces an on-disk rename without leaving a UI modal open.
2. That same call also rewrites the wikilinks in `notes/index.md`.

**Pass action**: Capture the working `commandId` and the request body shape (if any). Record both as a comment on the PR or a temporary `specs/012-safe-rename/spike-results.md` (delete before merge — this is implementation knowledge that goes into the handler, not the spec). The implementer will hardcode the id as `RENAME_COMMAND_ID` in `src/tools/rename-file/handler.ts` per [contracts/rename_file.md](./contracts/rename_file.md).

**Fail action**: **Stop**. Do not write handler code. Escalate to the user with the spike results. Possible escalation outcomes per R5 in [research.md](./research.md):

- The user identifies a custom plugin command id you didn't try → re-run the spike.
- The user revises FR-002 to use a different mechanism (e.g. `PATCH /vault/{path}` if that's exposed) → reopen via `/speckit-clarify`.
- The user abandons the feature → close the branch.

### Step 5: Reset the vault

```sh
# Restore the spike state if you intend to re-run.
# Easiest: rm -r notes/ in the vault and start over.
```

---

## Part 2 — Post-implementation manual smoke test

Run AFTER `src/tools/rename-file/{schema,tool,handler}.ts` are written, the dispatcher case is added in `src/index.ts`, and `npm run lint && npm run typecheck && npm run build && npm test` all pass.

This test exercises the MCP tool end-to-end through the running server — same path a real LLM client takes.

### Step 1: Start the server pointed at your scratch vault

```sh
npm run build
node dist/index.js
# (Or however the server is normally launched. The MCP transport is stdio.)
```

In a separate terminal, use any MCP client (Claude Desktop with this server configured, or `mcp` CLI tool) to talk to it. The examples below are pseudocode for the tool calls; adapt to your client.

### Step 2: Verify the description (User Story 3 / FR-005 / SC-002)

Call `tools/list`. Find `rename_file`. Confirm the `description` text contains all three of:

- `"Automatically update internal links"`
- `"Settings → Files & Links"`
- `"Folder paths are out of scope"`

If any substring is missing, the registration test should already have caught it — investigate why CI didn't fail.

### Step 3: Happy path (User Story 1 / FR-004 / SC-001)

Set up vault state in your scratch vault (same `notes/spike-source.md`, `notes/index.md`, `notes/control.md` as Part 1).

Invoke:

```json
{
  "name": "rename_file",
  "arguments": {
    "old_path": "notes/spike-source.md",
    "new_path": "notes/renamed-source.md"
  }
}
```

Expected response:

```json
{
  "content": [
    { "type": "text", "text": "{\n  \"old_path\": \"notes/spike-source.md\",\n  \"new_path\": \"notes/renamed-source.md\"\n}" }
  ]
}
```

Then verify in the vault:

- `notes/spike-source.md` no longer exists.
- `notes/renamed-source.md` exists with the original content.
- `notes/index.md` now contains `[[renamed-source]]` (or `[[notes/renamed-source]]`) instead of `[[spike-source]]`. Aliases are preserved (`[[renamed-source|the source]]`).
- `notes/control.md` is byte-for-byte unchanged.

### Step 4: Collision rejection (User Story 2 / FR-006 / Q1 delegation)

In the vault, create both `notes/a.md` and `notes/b.md` (any content).

Invoke:

```json
{
  "name": "rename_file",
  "arguments": { "old_path": "notes/a.md", "new_path": "notes/b.md" }
}
```

Expected response: an MCP error result (`isError: true`) carrying the upstream Obsidian error. Both files MUST still exist on disk, byte-for-byte unchanged (SC-003).

### Step 5: Folder rejection (Q2 / FR-001a)

In the vault, create a folder `notes/some-folder/` (with at least one file inside so it's a real folder).

Invoke:

```json
{
  "name": "rename_file",
  "arguments": { "old_path": "notes/some-folder", "new_path": "notes/other-folder" }
}
```

Expected response: an MCP error result. The folder MUST be unchanged. (Per R6, the rejection comes from the upstream `openFile` call failing for a non-file path; the user-facing error message is whatever Obsidian returns — it does NOT have to literally say "folder out of scope.")

### Step 6: Missing parent folder rejection (FR-012 / Q3)

In the vault, ensure `notes/deep/path/` does NOT exist.

Invoke:

```json
{
  "name": "rename_file",
  "arguments": { "old_path": "notes/control.md", "new_path": "notes/deep/path/moved.md" }
}
```

Expected response: an MCP error result. `notes/control.md` MUST still exist at its original path. The folder `notes/deep/` MUST NOT have been auto-created (FR-012).

### Step 7: Idempotent no-op (FR-009)

Invoke:

```json
{
  "name": "rename_file",
  "arguments": { "old_path": "notes/control.md", "new_path": "notes/control.md" }
}
```

Expected response: a normal success response with both fields equal to `notes/control.md`. No REST calls should hit Obsidian (you can verify by tailing Obsidian's REST API plugin logs if available, or by checking that the vault is unchanged — there should not even be an `openFile` side effect).

### Step 8: Validation failure (input contract)

Invoke:

```json
{ "name": "rename_file", "arguments": {} }
```

Expected response: an MCP error result with text matching `Invalid input — old_path: …`.

### Step 9: Setting-disabled regression check (Edge case in spec)

In the vault, **toggle off** Settings → Files & Links → "Automatically update internal links". Then re-run Step 3 (happy path) against fresh `notes/spike-source.md` + `notes/index.md` setup.

Expected: The file rename still succeeds and the tool still returns success — but `notes/index.md` is NOT updated; it still contains `[[spike-source]]` even though `notes/spike-source.md` no longer exists. This confirms the precondition documented in FR-005 / SC-002 is real and the responsibility for verifying the setting is correctly placed on the caller (per Q3 / spec Assumptions).

**Re-enable the setting** when finished so subsequent manual tests work as expected.

---

## Done criteria for this feature

The feature is ready to merge when:

- All Part 2 steps pass (1–9).
- `npm run lint && npm run typecheck && npm run build && npm test` are all green.
- The PR description includes a Constitution compliance line (Principles I–IV considered, no deviations) per the Governance section of the constitution.
- The pre-implementation spike's `commandId` and any required request-body shape are captured in `src/tools/rename-file/handler.ts` (no `// TODO: discover at runtime` comments).
- The `tests/tools/rename-file/registration.test.ts` description-substring assertions cover all three pinned strings (precondition, folder-out-of-scope, no-auto-create).
- `tests/tools/rename-file/handler.test.ts` covers at minimum the four scenarios listed in [contracts/rename_file.md](./contracts/rename_file.md) §"Test-coverage contract".
