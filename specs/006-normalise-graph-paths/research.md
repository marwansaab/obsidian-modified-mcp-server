# Research: Normalise Path Separators for Graph Tools

**Feature**: [spec.md](spec.md)
**Plan**: [plan.md](plan.md)
**Date**: 2026-04-27

This document resolves the design questions raised by the Phase 0 step of [plan.md](plan.md). Each entry follows Decision / Rationale / Alternatives. No `NEEDS CLARIFICATION` markers remain after Phase 0.

---

## R1 — Per-tool normalisation target

**Question**: All three affected tools accept a filepath, but they consume that filepath through different downstream contracts. Should the normalisation produce the same canonical form for every tool, or different forms per downstream?

**Decision**: Different forms per downstream. Two helpers:

- `toOsNativePath(p)` — used by `get_note_connections` and `find_path_between_notes`. Output uses `path.sep` (`\` on Windows, `/` on POSIX).
- `toForwardSlashPath(p)` — used by `find_similar_notes`. Output always uses `/`.

**Rationale**:

1. The two graph tools delegate to [GraphService](../../src/services/graph-service.ts), whose internal `graphology` index is keyed by `path.relative(this.vaultPath, filePath)` ([graph-service.ts:80](../../src/services/graph-service.ts#L80)). On Node 18+, `path.relative()` always returns OS-native separators. To match the indexed key with O(1) `graph.hasNode()` lookup, the input must be in the same OS-native form. Normalising to forward-slash for these tools would *also* require rebuilding the index in forward-slash form, which is a much larger change.
2. `find_similar_notes` delegates to [SmartConnectionsService.findSimilar](../../src/services/smart-connections.ts#L125), which makes an HTTP POST to `/search/similar` with `{ path: filepath, ... }`. The Smart Connections plugin, like the rest of Obsidian's surface, treats vault-relative paths as forward-slash strings (Obsidian normalises internally to forward-slash regardless of host OS). Sending a backslash path here is the wrong form for an Obsidian plugin — the upstream may match it by coincidence on Windows or may not. Normalising to forward-slash is the correct canonical form for that contract.
3. A single canonical form across both helpers would force one of these contracts to compromise. Splitting the helpers keeps each correct for its own downstream and makes the choice explicit at every call site.

**Alternatives considered**:

- **Single helper, always forward-slash, rebuild graph index on forward-slash keys.** Rejected: requires changing `graph-service.ts` to do `relative(...).split(sep).join('/')` on every node insert and look up, and changing every existing test that asserts node IDs in OS-native form. Higher blast radius for no caller-visible benefit.
- **Single helper, always OS-native, send backslash to Smart Connections on Windows.** Rejected: Obsidian's surface is forward-slash-canonical; a backslash request to `/search/similar` is malformed by Obsidian's own conventions. Even if it works on Windows today, it is brittle.
- **Helper that detects target format and adapts.** Rejected: too clever. The decision of which target each call site needs is a static property of the call site (which downstream service does it call), so encoding it as a runtime parameter adds indirection without value.

---

## R2 — Where normalisation runs in the call chain

**Question**: At which point in the request flow should the input be normalised — in the dispatcher, in the handler, or in the service?

**Decision**: At the **handler boundary** for the two graph tools (in [src/tools/graph/handlers.ts](../../src/tools/graph/handlers.ts), immediately after the zod parse and before the service call). For `find_similar_notes`, in the new dispatcher case in [src/index.ts](../../src/index.ts), immediately after the zod parse and before the `SmartConnectionsService.findSimilar` call.

**Rationale**:

1. Matches the spec's prescribed location ("at the start of each graph-tool handler, in a shared helper if multiple tools need it").
2. Keeps `GraphService` and `SmartConnectionsService` oblivious to platform separator concerns — they continue to do exactly one job each (in-process graph queries; HTTP passthrough). This preserves Constitution Principle I (Modular Code Organization).
3. Runs *after* zod parse, so the normalisation receives a typed, validated `string` rather than `unknown`. No new defensive checks needed.
4. Centralising normalisation in the dispatcher (one place for all tools) was considered but would mean the dispatcher needs to know the right target form per tool — the same per-tool choice from R1 — which is more naturally expressed at the per-handler call site.

**Alternatives considered**:

- **Inside `GraphService.getNoteConnections` / `findPathBetweenNotes`.** Rejected: makes the service aware of "callers may pass any separator" — a wrapper-input concern leaking into the service. Other future callers of the service (e.g., new tools, tests) might *want* to pass OS-native paths and expect strict matching; absorbing normalisation into the service removes that option silently.
- **In the MCP request preprocessor (before any handler runs).** Rejected: the preprocessor would need to know which fields on which tools are filepath-shaped, recreating the per-tool dispatch logic inside the preprocessor. This adds a new abstraction with no other callers.

---

## R3 — Mixed and edge-case separator handling

**Question**: How should the helpers handle inputs containing both separator forms (`000-Meta\subdir/file.md`), leading separators (`/000-Meta/file.md`), trailing separators (`000-Meta/file.md/`), and empty strings?

**Decision**: A single global regex replace per helper:

- `toOsNativePath(p)` → `p.replace(/[\\/]/g, path.sep)`
- `toForwardSlashPath(p)` → `p.replace(/[\\/]/g, '/')`

Leading and trailing separators are preserved as-is (no stripping), because:

- `path.relative()` never produces leading or trailing separators, so a vault-relative graph node ID never contains them — a leading-separator input simply won't match any node and falls through to the existing `note not found:` error path. That is correct behaviour: a leading-separator input is malformed for vault-relative paths regardless of separator style.
- Trailing separators on a *file* input are also malformed; the existing `hasNode` check already returns false, again falling through to the existing error path correctly.
- Stripping them inside the helper would mask malformed inputs in a way that is inconsistent with how the rest of the wrapper handles them (the upstream Local REST API does not silently strip them either).

Empty string input remains empty after normalisation, then fails the existing `filepath: z.string().min(1)` zod check upstream of the helper — never reaches the helper in production. Tests still cover empty input on the helper directly to document the no-op contract.

**Rationale**:

- A single global replace covers forward-slash, backslash, and arbitrarily-mixed inputs in O(n) time on input length, with no special cases.
- The helpers are pure string transforms with no dependencies on the filesystem or the graph index, so they are trivially testable and can be unit-tested independent of any service.
- Idempotence is automatic: applying `toOsNativePath` twice produces the same result as applying it once.

**Alternatives considered**:

- **Use `path.normalize()` from Node.** Rejected: `path.normalize()` does more than separator handling — it collapses `..`, removes redundant separators, drops trailing separators on directories. We want a separator-only transform; pulling in the full `normalize()` semantics changes behaviour on inputs containing `..`, which the wrapper does not currently special-case.
- **Use `path.posix.normalize` for the forward-slash helper.** Same issue as above plus locked to POSIX semantics regardless of host. Rejected for the same reason.
- **Strip leading/trailing separators defensively.** Rejected: masks malformed inputs and creates a divergence from the rest of the wrapper's behaviour. Spec edge-case row says "normalisation should not turn an otherwise-valid lookup into a miss" — leaving leading-separator paths to fail-with-clear-error matches that spirit better than silently transforming them.

---

## R4 — Error message form when the lookup misses

**Question**: When normalisation does not find a matching node (genuinely missing file), the existing service throws `note not found: ${filepath}` using the post-normalisation form. On Windows, a caller who sent forward-slash will receive an error with a backslash form. Is that acceptable?

**Decision**: Acceptable. No additional error-decoration code added.

**Rationale**:

1. FR-006 requires the error to "identify the offending path"; the normalised form is recognisable and identifying — it points to the same logical file as the caller's input.
2. The existing handler already has one error decorator (`rethrowWithVaultSuffix` at [handlers.ts:49](../../src/tools/graph/handlers.ts#L49)) for `vault: <id>` annotations. Adding a second decorator (form-restoring) doubles the wrapping logic for a cosmetic gain.
3. The error path only fires when the file does not exist after normalisation. The forward-slash-input-on-existing-file case (the actual bug) succeeds and returns a payload — the caller never sees an error message at all. Form-preservation in error messages is therefore a Story-1-acceptance-scenario-3 concern only, not a high-traffic case.
4. A future improvement could thread the original input through the service, but that change requires modifying `GraphService`'s public method signatures — a wider blast radius than this spec calls for. Out of scope.

**Alternatives considered**:

- **Wrap the service call in try/catch and replace the path in the error message.** Possible but requires careful matching: for `findPathBetweenNotes`, the error message contains either the source, the target, or both — selectively substituting requires structured error data, not regex on the message string. Adds complexity for a minor cosmetic gain.
- **Make `GraphService` throw a structured error (e.g., `NoteNotFoundError` with `requestedPath: string`)** so the handler can re-throw with the original form. Possible but deferred — this would be a follow-on cleanup, not part of the separator fix.

---

## R5 — Dispatcher gap for `find_similar_notes`

**Question**: While preparing to apply normalisation to `find_similar_notes`, is the tool actually wired in the dispatcher today?

**Decision**: No — the dispatcher in [src/index.ts](../../src/index.ts) has no `case 'find_similar_notes'` (nor `case 'semantic_search'`). Both tools are registered in `ALL_TOOLS` but every call to either currently throws `Unknown tool: find_similar_notes` from the dispatcher's `default:` branch. Bundling the dispatcher wiring for `find_similar_notes` into this feature is required to make FR-003 testable.

**Rationale**:

1. The spec's "presumed by symmetry" framing for Story 3 reflects the spec author's reasonable assumption that the bug shape was the same across all three tools. The actual blocker is more fundamental — the tool was never callable on the test vault for any reason. Smart Connections being absent was a contributing factor (the spec author would not have called it anyway) but not the only one.
2. FR-003 requires the tool to "accept a `filepath` argument that uses forward-slash separators". A tool that throws `Unknown tool` cannot accept anything. Wiring is a prerequisite, not a separate feature.
3. The wiring follows the established pattern from the seven graph tool cases ([src/index.ts:479-498](../../src/index.ts#L479-L498)): zod-validate args, get the appropriate service via `getSemanticService(vaultId)`, call the service method, return `{ content: [{ type: 'text', text: JSON.stringify(...) }] }`. Constant complexity addition (~15 LOC).
4. The hand-written JSON schema in [semantic-tools.ts](../../src/tools/semantic-tools.ts) for `find_similar_notes` is replaced with a derived `zodToJsonSchema(FindSimilarNotesRequestSchema)` form, bringing the newly-wired tool into compliance with Constitution Principle III in the same change. This is exactly what feature 005 did for `delete_file` when it wired the new handler.

**Out of scope for this feature**:

- `semantic_search` is the sibling unwired tool. It has the same dispatcher gap but does not take a `filepath` argument, so it is unaffected by the separator bug. Wiring it is a separate latent fix and not bundled here. Documented for awareness; not included in any FR.

**Alternatives considered**:

- **Defer the dispatcher fix; leave Story 3 / FR-003 as a known-broken bullet.** Rejected: the spec lists FR-003 as a binding functional requirement, and the spec's own checklist passed on the assumption that Story 3 is independently testable. Leaving the dispatcher gap unaddressed would invalidate that checklist.
- **Wire both `find_similar_notes` and `semantic_search` in this feature.** Rejected: out of scope per the spec; `semantic_search` does not take a filepath and is unrelated to the separator bug. Bundling it would expand the surface and require additional schemas + tests.
