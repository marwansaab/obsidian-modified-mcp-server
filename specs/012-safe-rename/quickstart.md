# Quickstart: Safe Rename Tool (`rename_file`) — Option B

**Feature**: 012-safe-rename | **Phase**: 1 (Design & Contracts) | **Date**: 2026-05-02 (Option B revision)
**Audience**: The implementer of this feature, and anyone manually verifying the tool against a real Obsidian instance.

This document covers two things:

1. **Pre-implementation feasibility spike (T002) — RAN, NEGATIVE OUTCOME, drove the Option-B pivot.** Recorded for posterity. The Option-A "dispatch Obsidian's Rename file command" approach was empirically established to be infeasible against stock Obsidian + the current Local REST API plugin.
2. **Post-implementation manual smoke test (Option-B end-to-end).** Run after the Option-B handler is wired up (which itself happens after Tier 2 backlog item 25 / `find_and_replace` ships).

The test suite (vitest) covers the unit-level contract; this document covers what only a real Obsidian + Local REST API instance can prove.

---

## Prerequisites

You need:

- A running Obsidian desktop instance with the **Local REST API plugin** (coddingtonbear/obsidian-local-rest-api) installed and enabled.
- A scratch vault that is on a **clean git working tree**. (Use a dedicated TestVault — not a vault with irreplaceable notes. The Option-B `rename_file` is best-effort across mid-flight failures and the documented rollback is `git restore .`.)
- The vault's API key from Local REST API plugin settings.
- `OBSIDIAN_API_KEY`, `OBSIDIAN_HOST`, `OBSIDIAN_PORT`, `OBSIDIAN_PROTOCOL` configured for the scratch vault (see [README.md](../../README.md) §"Environment Variables").

In a fresh terminal:

```sh
export OBS_HOST="https://127.0.0.1:27124"   # or whatever your config has
export OBS_KEY="<your local-rest-api key>"
alias obs='curl -ksS -H "Authorization: Bearer $OBS_KEY"'
```

---

## Part 1 — Pre-implementation feasibility spike (T002): EXECUTED, NEGATIVE OUTCOME

**Status**: This spike was run on 2026-05-02 against the deployed `@marwansaab/obsidian-modified-mcp-server@0.5.0` connected to a live Obsidian instance (TestVault on port 27194). **Outcome: negative.** The original Option-A design (dispatch Obsidian's "Rename file" command via `POST /commands/{commandId}/`) was established to be infeasible. The Option-B redesign was chosen as the recovery path. See [research.md §R5](./research.md) for the full result; key findings:

- **`workspace:edit-file-title`** dispatched headlessly → wrapper returned `✓` but no on-disk rename. Command opens an inline UI input that headless dispatch cannot satisfy.
- **`file-explorer:move-file`** dispatched headlessly → same result. Folder-picker UI; no on-disk action.
- **No other rename-family command** exists in stock Obsidian.
- **Body shape is not the issue.** The `POST /commands/{commandId}/` endpoint is fire-and-forget; the rename commands don't consume body parameters even when supplied.

**This spike does NOT need to be re-run.** Restoring the Obsidian-managed approach is captured as backlog item 28 (deferred), pending an upstream `coddingtonbear/obsidian-local-rest-api` plugin enhancement that exposes a programmatic file-rename endpoint. Out of project control.

The historical spike commands and pass/fail criteria are preserved in git history (the prior version of this file under commit `bebe709`) for reference; they are not reproduced here.

---

## Part 2 — Post-implementation manual smoke test (Option B end-to-end)

Run AFTER all of the following have happened:

1. Tier 2 backlog item 25 (`find_and_replace`) has shipped and merged to main, exposing `rest.findAndReplace` on `ObsidianRestService`.
2. T005 (`src/tools/rename-file/handler.ts`) has been written against the now-importable `rest.findAndReplace`.
3. T007 (dispatcher case in `src/index.ts`) has been added.
4. T006-restore (`...RENAME_FILE_TOOLS` re-added to `ALL_TOOLS` in `src/tools/index.ts`).
5. `npm run lint && npm run typecheck && npm run build && npm test` all pass.

This test exercises the MCP tool end-to-end through the running server — same path a real LLM client takes. It complements (does NOT replace) the hermetic regex-pass and handler tests in `tests/tools/rename-file/`.

### Step 1: Start the server pointed at your scratch vault

```sh
npm run build
node dist/index.js
# (Or however the server is normally launched. The MCP transport is stdio.)
```

In a separate terminal, use any MCP client (Claude Desktop with this server configured, or `mcp` CLI tool) to talk to it.

### Step 2: Verify the description (User Story 3 / FR-005 / SC-002)

Call `tools/list`. Find `rename_file`. Confirm the `description` text contains all four of:

- The "multi-step and not atomic" disclosure.
- The "clean git working tree" precondition.
- The wikilink shape coverage list.
- The "Automatically update internal links" setting irrelevance statement.

If any substring is missing, the registration test should already have caught it — investigate why CI didn't fail.

### Step 3: Happy path — single-folder rename (User Story 1 / FR-004 / SC-001)

Set up vault state in your scratch vault. Open Obsidian and create:

- `notes/spike-source.md` (any content)
- `notes/index.md` containing a representative mix of wikilink shapes:

  ```markdown
  # Index
  
  Bare: See [[spike-source]] for details.
  Aliased: See [[spike-source|the source]].
  Heading: See [[spike-source#Some Heading]].
  Heading + alias: See [[spike-source#Some Heading|the heading]].
  Block ref: See [[spike-source#^block-id]].
  Embed: ![[spike-source]]
  Embed + alias: ![[spike-source|caption]]
  
  Should NOT be rewritten (different basename): [[spike-source-extended]] [[spike-source-foo]]
  ```

- `notes/control.md` (any content; this file should be untouched after the rename)
- A fenced code block referencing the old name in another file, e.g. `notes/code-fence.md`:

  ```markdown
  Outside the fence: [[spike-source]] (this should be rewritten)
  
  ​```
  Inside the fence: [[spike-source]] (this should NOT be rewritten — find_and_replace's skipCodeBlocks)
  ​```
  ```

**Commit the vault to clean git state** before proceeding (`git add . && git commit -m "spike fixture"` from inside the vault).

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

Expected response (structured success):

```json
{
  "ok": true,
  "oldPath": "notes/spike-source.md",
  "newPath": "notes/renamed-source.md",
  "wikilinkPassesRun": ["A", "B", "C"],
  "wikilinkRewriteCounts": {
    "passA": 2,    // bare + aliased
    "passB": 3,    // heading + heading-alias + block-ref
    "passC": 2,    // embed + embed-alias
    "passD": null  // same-folder rename, Pass D skipped
  },
  "totalReferencesRewritten": 7
}
```

Then verify in the vault:

- `notes/spike-source.md` no longer exists.
- `notes/renamed-source.md` exists with the original content.
- `notes/index.md` now contains the rewritten variants:
  - `[[renamed-source]]`, `[[renamed-source|the source]]`, `[[renamed-source#Some Heading]]`, `[[renamed-source#Some Heading|the heading]]`, `[[renamed-source#^block-id]]`, `![[renamed-source]]`, `![[renamed-source|caption]]`
- `[[spike-source-extended]]` and `[[spike-source-foo]]` in `notes/index.md` are **unchanged** — Pass A's regex anchors on the full bracketed token, so partial-basename matches don't fire.
- `notes/code-fence.md`'s outside-the-fence reference is rewritten; inside-the-fence reference is unchanged (`find_and_replace`'s `skipCodeBlocks: true`).
- `notes/control.md` is byte-for-byte unchanged.

### Step 4: Happy path — cross-folder rename (Pass D verification)

Reset the vault (`git restore .` and `git clean -fd` from inside the vault), then rebuild a fresh fixture:

- `Inbox/draft.md`
- `Projects/Project-X/overview.md` does NOT exist; ensure the folder DOES exist (create an empty `.gitkeep` or use Obsidian to create a dummy file you'll delete).
- `notes/index.md` containing:

  ```markdown
  Basename form: [[draft]]
  Full-path form: [[Inbox/draft]]
  Full-path with heading: [[Inbox/draft#Some Heading]]
  Full-path with alias: [[Inbox/draft|some alias]]
  ```

Commit (`git add . && git commit`). Then invoke:

```json
{
  "name": "rename_file",
  "arguments": {
    "old_path": "Inbox/draft.md",
    "new_path": "Projects/Project-X/overview.md"
  }
}
```

Expected: `wikilinkPassesRun` includes `"D"`; `wikilinkRewriteCounts.passD` is non-null and equals the number of full-path-form references (3 in the fixture above). Both `[[draft]]` (Pass A) and `[[Inbox/draft]]` (Pass D) variants are rewritten to the new location.

### Step 5: Collision rejection (User Story 2 / FR-006 / Q1 supersession)

In the vault, create both `notes/a.md` and `notes/b.md`. Commit.

Invoke:

```json
{
  "name": "rename_file",
  "arguments": { "old_path": "notes/a.md", "new_path": "notes/b.md" }
}
```

Expected response: an MCP error result (`isError: true`) carrying the wrapper-constructed text `destination already exists: notes/b.md`. Both files MUST still exist on disk, byte-for-byte unchanged. Verify via `git status` — should report no changes.

### Step 6: Missing source rejection (FR-007)

Invoke against a `old_path` that doesn't exist:

```json
{
  "name": "rename_file",
  "arguments": { "old_path": "notes/does-not-exist.md", "new_path": "notes/anywhere.md" }
}
```

Expected: an MCP error result carrying the upstream Obsidian 404 verbatim (Q1 still applies for FR-007). No file is created at `new_path`. Vault unchanged.

### Step 7: Folder rejection (Q2 / FR-001a)

In the vault, create a folder `notes/some-folder/` (with at least one file inside so it's a real folder). Commit.

Invoke:

```json
{
  "name": "rename_file",
  "arguments": { "old_path": "notes/some-folder", "new_path": "notes/other-folder" }
}
```

Expected: an MCP error result. The error comes from `getFileContents`'s upstream rejection (folders aren't readable as file content). The folder MUST be unchanged.

### Step 8: Missing parent folder rejection (FR-012 / Q3)

Ensure `notes/deep/path/` does NOT exist in the vault.

Invoke:

```json
{
  "name": "rename_file",
  "arguments": { "old_path": "notes/control.md", "new_path": "notes/deep/path/moved.md" }
}
```

Expected: an MCP error result carrying the upstream `listFilesInDir` 404. `notes/control.md` MUST still exist at its original path. The folder `notes/deep/` MUST NOT have been auto-created (FR-012). `git status` should report no changes.

### Step 9: Idempotent no-op (FR-009)

Invoke:

```json
{
  "name": "rename_file",
  "arguments": { "old_path": "notes/control.md", "new_path": "notes/control.md" }
}
```

Expected response:

```json
{
  "ok": true,
  "oldPath": "notes/control.md",
  "newPath": "notes/control.md",
  "wikilinkPassesRun": [],
  "wikilinkRewriteCounts": { "passA": null, "passB": null, "passC": null, "passD": null },
  "totalReferencesRewritten": 0
}
```

No REST calls should hit Obsidian (the empty `wikilinkPassesRun` confirms the FR-009 short-circuit fired).

### Step 10: Validation failure (input contract)

Invoke:

```json
{ "name": "rename_file", "arguments": {} }
```

Expected: an MCP error result with text matching `Invalid input — old_path: …`.

### Step 11: Mid-flight failure observation (FR-015 / SC-003 partial-state contract)

This step requires deliberately inducing a failure between steps 5 and 7. The cleanest approach: temporarily make `find_and_replace` fail by passing a regex flag combination it doesn't accept (or by similar surgical means — exact recipe depends on item 25's API). Construct a vault state with multiple wikilink shapes, then invoke `rename_file` and observe the structured failure response.

Expected response shape:

```json
{
  "ok": false,
  "oldPath": "notes/some-source.md",
  "newPath": "notes/some-target.md",
  "failedAtStep": "find_and_replace_pass_B",
  "partialState": {
    "destinationWritten": true,
    "passesCompleted": ["A"],
    "sourceDeleted": false
  },
  "error": "<upstream find_and_replace error verbatim>"
}
```

Then verify with `git status`:

- `notes/some-target.md` exists (new file; modification reported by git).
- `notes/some-source.md` still exists (deletion did NOT happen).
- Some wikilinks have been rewritten (Pass A completed) — `git diff` shows the partial state.

**Recovery**: Run `git restore . && git clean -fd` from inside the vault. Verify the vault is back to the pre-call commit state. This validates the FR-005(b) precondition / FR-015 rollback baseline contract.

### Step 12: Setting-irrelevance regression check (FR-005(d) / spec Edge Case)

Toggle off Settings → Files & Links → "Automatically update internal links" in Obsidian. Re-run Step 3 (happy path) against a fresh `notes/spike-source.md` + `notes/index.md` setup.

**Expected**: Identical behaviour to Step 3. The wikilink rewriting is performed by the wrapper's `find_and_replace` passes, not by Obsidian's index. The setting being off has no effect on this tool. This is the post-Option-B inverse of the original Option-A regression check (which proved the setting being off broke Option-A's link integrity).

**Re-enable the setting** when finished, in case other tools you use depend on it.

---

## Done criteria for this feature

The feature is ready to merge when:

- All Part 2 steps pass (1–12).
- `npm run lint && npm run typecheck && npm run build && npm test` are all green.
- The PR description includes a Constitution compliance line (Principles I–IV considered, no deviations) per the Governance section of the constitution.
- `tests/tools/rename-file/regex-passes.test.ts` covers the regex correctness for all 4 passes against synthetic strings (per the test-coverage contract in [contracts/rename_file.md](./contracts/rename_file.md)).
- `tests/tools/rename-file/handler.test.ts` covers at minimum the 7 scenarios listed in [contracts/rename_file.md §"Test-coverage contract"](./contracts/rename_file.md) under `handler.test.ts (DEFERRED)`.
- `tests/tools/rename-file/registration.test.ts` covers the 6 description-substring assertions (Option-B revision).
- `RENAME_FILE_TOOLS` is wired back into `ALL_TOOLS` in `src/tools/index.ts` (un-wired during the Option-B documentation pivot per the "no false advertisement" principle; restored once item 25 ships and T005/T007 are complete).
