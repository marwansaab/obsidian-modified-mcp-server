# Research: Safe Rename Tool (`rename_file`)

**Feature**: 012-safe-rename | **Phase**: 0 (Outline & Research) | **Date**: 2026-05-02

This document resolves the open questions surfaced in [plan.md](./plan.md) §"Phase 0 — Outline & Research". Each item follows the format **Decision / Rationale / Alternatives considered**, with explicit risk callouts where empirical verification is still required at implementation time.

---

## R1. Composition layer: legacy `execute_command` MCP tool vs. `ObsidianRestService.executeCommand` service method

**Decision**: Compose at the **service** layer. The handler calls `rest.executeCommand(commandId)` directly (and `rest.openFile(old_path)` first — see R3), not the legacy MCP `execute_command` tool.

**Rationale**: The legacy MCP `execute_command` tool, at [src/index.ts:455-470](../../src/index.ts#L455-L470), wraps each individual command call in a try/catch that converts thrown errors into a string `✗ {cmd}: {err.message}` and returns the aggregate as **successful** MCP content. This explicitly violates Constitution Principle IV ("Errors raised by upstream systems MUST be either handled with a documented recovery path or surfaced to the MCP client as a structured error… `catch` blocks MUST NOT return empty results, default values, or `null` to mask a failure"). The Q1 clarification (pure delegation, errors propagate verbatim) cannot be honoured if we compose through a layer that rewrites errors into success text. The service method `ObsidianRestService.executeCommand` ([src/services/obsidian-rest.ts:368](../../src/services/obsidian-rest.ts#L368)) wraps `safeCall(...)`, which lets typed `ObsidianApiError` / `ObsidianTimeoutError` / `ObsidianNotFoundError` propagate to the caller — exactly what FR-008 + FR-006/007 require under Q1.

**Alternatives considered**:

- **Compose through the legacy MCP `execute_command` tool layer** — rejected. Would silently turn upstream errors into success and break Principle IV plus the Q1 contract. Would also force us to parse the `✗ {cmd}: …` text back into an error, which is a worse contract than what the service layer already gives us for free.
- **Add a new `rename_file` method to `ObsidianRestService`** that wraps `executeCommand` for renames specifically — rejected as premature. The handler is small enough that composition at the handler layer (open-then-execute) is clearer than burying it in the service. If a second rename-style tool is ever added (e.g. `rename_folder`, per Q2's deferred future), shared logic can be promoted to the service layer at that point — not before.
- **Refactor the legacy `execute_command` tool to surface errors properly first**, then compose through it — rejected for scope. That refactor is a real Principle IV violation in its own right and deserves its own feature; folding it into this work would expand the blast radius and slow the rename feature for no functional gain. Surface as a follow-up.

**Follow-up**: Note for future cleanup — the legacy `execute_command` tool's error-swallowing behaviour is independently a Principle IV violation. Worth filing a separate cleanup feature once this lands.

---

## R2. Obsidian command id for "Rename file"

**Decision**: Treat the exact command id as **implementation-time configuration**, not a planning unknown. The handler accepts the command id from a single named constant in `src/tools/rename-file/handler.ts` (or imports it from a small shared registry), and the implementer resolves the id during the implementation spike (see R5).

**Rationale**: The spec's Assumptions section explicitly classifies this: *"The Obsidian command id for 'Rename file' is stable enough to be hard-coded or discoverable via the existing command-list endpoint; verifying the exact id is an implementation-time concern, not a spec-time one."* The discovery procedure is mechanical:

1. Run the existing `list_commands` MCP tool (or directly: `GET /commands/`) against a real Obsidian instance.
2. Filter the response for entries whose `name` matches `/rename/i`.
3. Pick the entry whose name corresponds to the menu label "Rename file" (likely id: `workspace:edit-file-title`, but to be confirmed empirically).

**Alternatives considered**:

- **Hardcode `workspace:edit-file-title` now** based on prior knowledge — rejected as not empirically verified for the Local REST API plugin path. Risk of guessing the wrong id and shipping a tool that errors immediately on first use.
- **Discover the id at runtime on every call** by calling `list_commands` first — rejected. Adds a REST round-trip per invocation for no benefit; the id is stable across Obsidian sessions.
- **Make the command id a config knob (env var or vault config)** — rejected as over-engineered for a stable platform constant. If the id ever changes upstream, that's a single-line edit.

**Risk**: The implementer may discover that no single Obsidian command produces a programmatic rename (see R5). If so, this whole feature's mechanism is infeasible as currently designed and the user must be consulted before further work.

---

## R3. Active-file requirement: must `rest.openFile(old_path)` precede the command dispatch?

**Decision**: **Yes** — the handler calls `rest.openFile(old_path)` immediately before `rest.executeCommand(commandId)`.

**Rationale**: Obsidian's command-palette commands operate on the workspace's *active* editor, not on a path argument. The existing `OBSIDIAN_TOOLS` registration even documents this directly: `"Execute one or more Obsidian commands in order. **For commands that operate on notes, open a note first.**"` ([src/tools/obsidian-tools.ts:54](../../src/tools/obsidian-tools.ts#L54)). The `ObsidianRestService.openFile(path)` method ([src/services/obsidian-rest.ts:274](../../src/services/obsidian-rest.ts#L274)) is `POST /open/?file={path}`, which makes the named file active in the editor without modifying it. Calling it before the rename command ensures the rename targets `old_path` rather than whatever happened to be active.

**Alternatives considered**:

- **Skip the open step and assume the caller has already opened the file** — rejected. Forces a hidden pre-condition on every caller, violates the principle that a tool's contract should be self-contained, and produces silent failures (the wrong file gets renamed) when the caller forgets.
- **Use `rest.getActiveFile()` to assert the open succeeded before dispatching the command** — rejected as defensive validation that violates the spirit of Q1's pure delegation. If `openFile` fails, its own error propagates; if it silently succeeds against a different path, that's an Obsidian/REST plugin bug, not something this tool should paper over.

**Risk**: If `POST /open/` itself fails (e.g. file doesn't exist), that error propagates as the rename's FR-007 "missing source" path. This is consistent with Q1: the open call counts as part of the "underlying command" failure surface for delegation purposes.

---

## R4. How is `new_path` conveyed to the rename command?

**Decision**: **Open empirical question** flagged for the implementation-time spike (R5). The handler's signature and structure are independent of the answer; the spike resolves the body of the dispatch step.

**Rationale**: Obsidian's stock command palette commands take no arguments. The "Rename file" command, when invoked from the palette, opens an inline rename input on the active file's title at the top of the editor pane — that's a UI-driven flow, not a programmatic one. There are several mechanisms by which `new_path` could be conveyed when invoked via REST, none of which can be confirmed without testing:

- The Local REST API plugin may forward a request body to the command (undocumented or version-specific).
- The REST plugin may auto-confirm the inline rename input and read the new name from a header or query parameter.
- A community-maintained fork of `coddingtonbear/obsidian-local-rest-api` may add a dedicated `PATCH /vault/{path}` rename endpoint that the user actually intends.
- The user may have a different mechanism in mind that bypasses the command-palette path entirely (in which case spec FR-002's "POST /commands/{commandId}/" framing would need revisiting).

**Mitigation**: The spike (R5) is the gate. If the spike confirms a working mechanism, the handler's dispatch step is a one-liner using whichever shape the spike found. If the spike fails, escalate to the user before committing further code; possible escalation paths include `/speckit-clarify` re-entry to revisit FR-002, or a switch to a `PATCH /vault/{path}` endpoint if the Local REST API version in use exposes one.

**Alternatives considered**: All deferred to the spike, since they are empirical not architectural.

---

## R5. Feasibility-verification spike (must run before substantial implementation)

**Decision**: Define a tightly-scoped manual spike that verifies the entire end-to-end flow against a real Obsidian instance with the Local REST API plugin enabled, *before* any handler code is committed.

**Spike procedure** (also captured in [quickstart.md](./quickstart.md) under "Pre-implementation verification"):

1. In a scratch Obsidian vault, create three files:
   - `notes/spike-source.md` containing some text.
   - `notes/index.md` containing the literal body `See [[spike-source]] for details.`.
   - `notes/other.md` (untouched, control file).
2. Confirm Settings → Files & Links → "Automatically update internal links" is ON.
3. Issue `GET /commands/` and capture every entry whose `name` matches `/rename/i`. Note their `id` values.
4. For each candidate command id:
    a. `POST /open/?file=notes/spike-source.md` (open the source file).
    b. `POST /commands/{candidateId}` (with whatever body shape is plausible: empty, `{ "newName": "spike-target" }`, `{ "newPath": "notes/spike-target.md" }`).
    c. Observe: Did the file actually rename? Did `notes/index.md`'s wikilink update from `[[spike-source]]` to `[[spike-target]]`? Or did a UI modal pop in Obsidian and nothing changed on disk?
5. Record findings in a comment on this feature's PR (or in a temporary `specs/012-safe-rename/spike-results.md` that's deleted before merge).

**Pass criteria**:

- Exactly one command id produces an on-disk rename without UI interaction, AND
- That same command id triggers the wikilink update in `notes/index.md`.

**If the spike passes**: capture the id and the request body shape (if any) and proceed with implementation per [contracts/rename_file.md](./contracts/rename_file.md).

**If the spike fails** (no command id produces a programmatic rename): **escalate to the user** before writing handler code. Do not attempt workarounds (e.g. issuing a filesystem rename and parsing files to update links) — that would be outside SC-005 and outside the spec entirely. Possible escalation outcomes:

- The user may identify a non-stock command id (e.g. from a custom plugin) — re-run the spike with that id.
- The user may revise the spec to use a different mechanism (e.g. `PATCH /vault/{path}` directly) — `/speckit-clarify` to reopen FR-002.
- The user may abandon the feature.

**Rationale**: Catches an infeasibility before substantial code is written. The spike is short (~15 minutes against a running Obsidian) and gives a clean go/no-go signal.

---

## R6. Folder-vs-file detection for FR-001a (Q2 rejection of folder paths)

**Decision**: **Trust upstream**. Do not add a pre-flight folder/file probe in the handler; let the rename dispatch fail upstream when `old_path` resolves to a folder, and propagate that error per Q1.

**Rationale**: This is symmetrical with the Q1 pure-delegation contract for FR-006/FR-007. Stock Obsidian's "Rename file" command targets a file (the active editor's file). When `old_path` is a folder, the prior `rest.openFile(old_path)` step will likely fail (folders don't open as editors) — and that failure naturally yields the FR-001a rejection error path without any new code. If `openFile` somehow succeeds against a folder (unlikely but possible in some plugin variants), then the subsequent `executeCommand` call will fail because there's no editor title to rename, and again we propagate.

**Alternatives considered**:

- **Add a `rest.statPath(path)` helper that returns `'file' | 'folder' | 'missing'`** and check explicitly before dispatching — rejected as inconsistent with Q1's "no pre-flight" principle. Adds a REST round-trip on the happy path for a check that would be redundant most of the time. Also would require adding new code to `ObsidianRestService` (the existing service has `listFilesInDir(dirpath)` and `getFileContents(filepath)` but no general stat).
- **Inspect the path string for trailing-slash heuristics** to reject "folder-shaped" paths — rejected. Heuristic, not a real check; would reject legitimate file paths and miss folder paths without trailing slashes.

**Trade-off accepted**: When `old_path` is a folder, the propagated error message will be Obsidian's own ("file not found" or similar from the `openFile` call), not a tool-constructed "folder renames are out of scope" message. The FR-001a wording explicitly anticipates the rejection-by-error-propagation path; the user-facing distinction between "folder rejected" and "missing file" is acceptable because both lead the caller to the same corrective action (use a different tool / supply a real file path).

---

## R7. Response shape on success

**Decision**: On success, the handler returns an MCP `CallToolResult` with a single `text` content block containing the JSON `{ "old_path": <string>, "new_path": <string> }` (pretty-printed with 2-space indent, matching the project's `JSON.stringify(body, null, 2)` convention used in [list-tags handler](../../src/tools/list-tags/handler.ts)).

**Rationale**: FR-011 requires the response to "identify both the original path and the resulting path." Echoing the validated inputs is sufficient because:

- `ObsidianRestService.executeCommand` returns `void` — there's no upstream payload to surface.
- The caller already knows what they sent; echoing back lets them confirm without a follow-up read (SC-004) and gives a clean record for chaining operations.
- Adding any extra field (e.g. "wikilinks_updated_count") would require parsing files, violating SC-005.

**Alternatives considered**:

- **Return `null` content / empty text on success** — rejected. Loses the FR-011 confirmation contract and makes test assertions less specific.
- **Include the upstream HTTP status code** — rejected as leaky implementation detail; the MCP-level success/failure is the right abstraction.

---

## R8. `vaultId` parameter convention

**Decision**: Include an optional `vaultId: z.string().trim().optional()` field, matching the established convention in `ListTagsRequestSchema` ([src/tools/list-tags/schema.ts:13](../../src/tools/list-tags/schema.ts#L13)) and other recent tools.

**Rationale**: The server supports multiple simultaneous vaults via `vaultId` (per [README.md](../../README.md) "OBSIDIAN_API_KEY" / multi-vault section). Tools that target the wrong vault silently are a footgun. The field is optional, defaulting to the configured default vault, so single-vault users see no friction.

**Alternatives considered**:

- **Omit `vaultId`** for simplicity — rejected. Would diverge from established convention and quietly break for multi-vault users. The cost of adding it is negligible (3 lines in the schema, 0 lines in the handler since the existing `rest` instance is already vault-bound by the dispatcher).

---

## Summary of resolutions

| ID | Topic | Status |
|---|---|---|
| R1 | Composition layer (service vs. legacy MCP tool) | **Resolved** — service layer (`rest.executeCommand` + `rest.openFile`) |
| R2 | Obsidian command id for "Rename file" | **Resolved as implementation-time spike** (per spec Assumption) |
| R3 | Active-file requirement (open before rename) | **Resolved** — yes, `openFile` precedes `executeCommand` |
| R4 | How `new_path` is conveyed to the command | **Open** — gated on R5 spike |
| R5 | Feasibility-verification spike | **Procedure defined** — must run before substantial implementation |
| R6 | Folder-vs-file detection for FR-001a | **Resolved** — trust upstream, propagate rejection error |
| R7 | Success response shape | **Resolved** — JSON `{ old_path, new_path }` echo |
| R8 | `vaultId` parameter | **Resolved** — include, optional, matches convention |

R4/R5 are the only items not fully resolved by the planning round. Both are scoped to the implementation-time spike per the spec's own Assumption clause; neither is a NEEDS CLARIFICATION blocking the plan.
