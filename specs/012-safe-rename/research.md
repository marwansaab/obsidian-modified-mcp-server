# Research: Safe Rename Tool (`rename_file`) — Option B

**Feature**: 012-safe-rename | **Phase**: 0 (Outline & Research) | **Date**: 2026-05-02 (Option B revision)

This document resolves the open questions surfaced in [plan.md](./plan.md) §"Phase 0 — Outline & Research". Items R1, R6, R7, R8 from the original Option-A planning are preserved (with mechanism updates where the Option-B pivot affects them); R2–R5 are obsolete or rewritten. New items R9–R12 capture the Option-B-specific research.

---

## R1. Composition layer: legacy `execute_command` MCP tool vs. service-layer methods

**Decision (unchanged from Option A; scope expanded)**: Compose at the **service** layer. Under Option B, the handler invokes five service-layer methods on `ObsidianRestService` directly: `getFileContents`, `putContent`, `listFilesInDir`, `findAndReplace` (item 25), and `deleteFile`. None of these go through the legacy MCP `execute_command` tool — that wrapper's per-command error swallowing (see [src/index.ts:455-470](../../src/index.ts#L455-L470)) would break Principle IV exactly as it would have under Option A.

**Rationale**: The Option-A rationale ports forward unchanged. The legacy MCP `execute_command` tool wraps each individual command call in a try/catch that converts thrown errors into a string `✗ {cmd}: {err.message}` and returns the aggregate as **successful** MCP content — a Principle IV violation. The Option-B composition uses five distinct REST primitives, each of which goes through `safeCall` in [src/services/obsidian-rest.ts](../../src/services/obsidian-rest.ts) and propagates typed `ObsidianApiError` / `ObsidianTimeoutError` / `ObsidianNotFoundError` instances. Composition at the service layer preserves the typed-error chain end-to-end.

**Alternatives considered**: All rejected for the same reasons as Option A (see the original draft in git history).

**Follow-up** (carried forward from Option A): the legacy `execute_command` tool's error-swallowing behaviour remains a latent Principle IV violation worth a separate cleanup feature. Out of scope for 012.

---

## R2. ~~Obsidian command id for "Rename file"~~ — OBSOLETE under Option B

**Status**: **OBSOLETE.** Option B does not dispatch any Obsidian command. The 2026-05-02 T002 spike (R5) established that no stock Obsidian command performs a programmatic rename when dispatched via `POST /commands/{commandId}/`, so the question of "which command id" is moot. Restoring Option A is captured as backlog item 28 (deferred), pending an upstream `coddingtonbear/obsidian-local-rest-api` plugin enhancement that exposes a programmatic rename endpoint with body parameters.

---

## R3. ~~Active-file requirement: must `rest.openFile(old_path)` precede the command dispatch?~~ — OBSOLETE under Option B

**Status**: **OBSOLETE.** Option B does not dispatch any Obsidian command, so there is no active-file requirement. `rest.openFile` is not used. The handler operates entirely through `getFileContents` / `putContent` / `listFilesInDir` / `findAndReplace` / `deleteFile`, none of which depend on the workspace's active editor.

---

## R4. ~~How is `new_path` conveyed to the rename command?~~ — OBSOLETE under Option B

**Status**: **OBSOLETE.** Option B does not invoke any rename command, so `new_path` is not "conveyed" to anything — it is the destination argument to `rest.putContent` (step 5) and used to derive the `<new-basename>` (and `<new-folder>` for cross-folder renames) for the wikilink-rewrite passes (step 6). The R4 question — "can `POST /commands/{commandId}/` accept body parameters that the command consumes" — was empirically answered NO by the spike.

---

## R5. Feasibility-verification spike — RESULT: NEGATIVE

**Status**: **EXECUTED.** Spike ran on 2026-05-02 against the deployed `@marwansaab/obsidian-modified-mcp-server@0.5.0` connected to a live Obsidian instance (TestVault on port 27194). **Outcome: NEGATIVE.**

**Findings**:

- **`workspace:edit-file-title`** — Dispatch via `POST /commands/{commandId}/` returned `✓` from the wrapper (the `execute_command` MCP tool's error-swallowing layer was active and reported success even though the command had no on-disk effect). The fixture file `Projects/Project Alpha.md` remained at `Projects/Project Alpha.md` post-call. The command opens the inline tab-title rename UI in Obsidian and waits for user input that headless dispatch cannot provide.
- **`file-explorer:move-file`** — Same result. Wrapper returned `✓`; in-app behaviour was a folder-picker UI that had no headless-dispatch counterpart; no on-disk action.
- **No other rename-family command exists.** Filtered `list_commands` against `/rename/i` and `/move/i` — only the two commands above plus `editor:rename-heading` (heading-rename, not file-rename, out of scope).
- **Body shape is not the issue.** The upstream `POST /commands/{commandId}/` endpoint is fire-and-forget; the rename commands themselves don't consume body parameters. Even with `{"newName": "..."}` or `{"newPath": "..."}` bodies, the commands wouldn't read them — they're hardcoded for in-app interactive use.

**The wrapper's `✓` masking** (the Principle-IV violation captured in R1's follow-up and tracked separately) hid the no-op. With the masking, the empirical evidence reads as `command-dispatched-but-rename-not-performed` — exactly the R5 worst-case the spike was designed to surface.

**Decision**: Per the spike's documented fail-action (escalate; do not write handler code; user must choose recovery path), the user has chosen **Option B** — replace the Obsidian-command dispatch with a wrapper-side composition over `getFileContents` + collision-check + `putContent` + `findAndReplace` (item 25, 4 passes) + `deleteFile`. Restoring Option A is captured as backlog item 28 (deferred; pending upstream plugin enhancement; out of project control).

**Implications**: R2, R3, R4 are obsolete; R6, R7 update with new mechanism details; R9–R12 are added to capture Option-B-specific research.

---

## R6. Folder-vs-file detection for FR-001a

**Decision (mechanism updated; conclusion unchanged)**: **Trust upstream**. Do not add a pre-flight folder/file probe in the handler; let the algorithm's first call (`rest.getFileContents(old_path)`) fail when `old_path` resolves to a folder, and propagate that error per Q1.

**Rationale (Option-B mechanism)**: Under Option A, the failure manifested at `rest.openFile(old_path)`. Under Option B, the failure manifests at `rest.getFileContents(old_path)` — folders aren't readable as file content via this endpoint, so the Local REST API plugin returns a non-2xx response that `safeCall` turns into a typed error. The shape of the response is the same as Option A's (typed exception, propagated), and the trade-off accepted in the original R6 (error message text comes from upstream rather than being "folder out of scope" verbatim) carries forward unchanged.

**Alternatives considered**: All previously rejected; see Option-A history.

**Trade-off accepted**: Same as Option A — error text comes from upstream, callers should not pattern-match on the exact message. The FR-001a wording in spec.md was already softened during the analyze-pass remediation to match this trade-off.

---

## R7. Success response shape

**Decision (Option-B revision; significantly expanded from Option A)**: On success, the handler returns an MCP `CallToolResult` whose single text content block contains a structured JSON object:

```json
{
  "ok": true,
  "oldPath": "<validated old_path>",
  "newPath": "<validated new_path>",
  "wikilinkPassesRun": ["A", "B", "C"],
  "wikilinkRewriteCounts": {
    "passA": 7,
    "passB": 2,
    "passC": 0,
    "passD": null
  },
  "totalReferencesRewritten": 9
}
```

On mid-flight failure (steps 5–8), the structured response is:

```json
{
  "ok": false,
  "oldPath": "<validated old_path>",
  "newPath": "<validated new_path>",
  "failedAtStep": "find_and_replace_pass_B",
  "partialState": {
    "destinationWritten": true,
    "passesCompleted": ["A"],
    "sourceDeleted": false
  },
  "error": "<upstream error message verbatim>"
}
```

**Rationale**: FR-011 requires the response to (a) identify both paths, (b) name which passes ran (so callers can distinguish "no passes ran" from "passes ran, found zero references"), (c) report the per-pass counts (so callers can verify expected coverage), (d) on mid-flight failure, name the step at which it failed and what was written. The richer shape is necessary because Option B's composition is no longer fire-and-forget — there are five REST calls and four optional regex passes whose individual outcomes are useful to the caller for chaining and recovery.

**Alternatives considered**:

- **Minimal `{old_path, new_path}` echo (Option A's choice)** — rejected. Loses the per-pass count + failed-step information that Option B's caller needs.
- **Include the full `find_and_replace` response per pass** — rejected as overly verbose. The per-pass count is sufficient; callers needing the full per-file detail can call `find_and_replace` themselves with the same regex.
- **Return distinct CallToolResults per step** — not possible. MCP tool calls are one request → one result; multi-step internal work returns one structured result.

---

## R8. `vaultId` parameter convention

**Decision (unchanged)**: Include an optional `vaultId: z.string().trim().optional()` field, matching the established convention in `ListTagsRequestSchema` ([src/tools/list-tags/schema.ts:13](../../src/tools/list-tags/schema.ts#L13)) and other recent tools.

**Rationale, alternatives**: Unchanged from Option A.

---

## R9. Wikilink shape coverage rationale (NEW under Option B)

**Decision**: Cover seven "reliable" wikilink shapes (FR-014) via four regex passes (A, B, C, D), gating Pass D to cross-folder renames only. Explicitly document the unsupported shapes (relative-path forms, markdown-style `[text](path)` links).

**Rationale**: Obsidian's own "Automatically update internal links" handles a broader set than the four passes here, but reproducing every edge case would push the wrapper into markdown-AST-parsing territory (SC-005 violation). The four passes hit the >95%-coverage shape catalogue empirically observed in real Obsidian vaults:

- **Pass A**: bare and aliased forms — `[[basename]]`, `[[basename|alias]]`. Most common shape; ~70% of references in typical vaults.
- **Pass B**: heading-targeted forms with optional alias — `[[basename#heading]]`, `[[basename#heading|alias]]`, `[[basename#^block-id]]` (block references match because `#^…` is a valid `#…` segment).
- **Pass C**: embed forms with optional alias — `![[basename]]`, `![[basename|alias]]`. Critical for attachment renames (image/PDF embeds).
- **Pass D**: full-path forms (only relevant when `dirname(old_path) != dirname(new_path)`). Same shapes as Passes A+B but rooted at the old folder path. Skipped on same-folder renames as a no-op.

**Alternatives considered**:

- **Single mega-regex covering all four shapes in one pass** — rejected. Harder to test, harder to debug, harder to extend, and `find_and_replace`'s `skipCodeBlocks` / `skipHtmlComments` semantics are easier to reason about per pass.
- **Cover relative-path forms (`[[../folder/basename]]`) as Pass E** — rejected for now. Relative paths require enumerating arbitrary `../` depths, which adds complexity for a low-frequency shape. Documented as out-of-scope in FR-014; callers needing this can compose additional `find_and_replace` calls.
- **Cover markdown-style `[text](path)` links as Pass F** — rejected for the same reasons. Markdown-style links to vault files are uncommon; out-of-scope per FR-014.
- **Use Obsidian's own "Automatically update internal links" handling** — that's Option A, which the spike (R5) established as infeasible.

**Trade-off accepted**: The "less reliable" shapes in FR-014 (relative-path, markdown-style) leave the rename incomplete for vaults that use them heavily. The tool's description (FR-005(c)) discloses this honestly.

---

## R10. `escapeRegex` utility (NEW under Option B)

**Decision**: Implement `escapeRegex(str: string): string` as a small in-repo utility in `src/tools/rename-file/regex-passes.ts`. Borrow the canonical implementation:

```ts
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

**Rationale**: Filenames containing regex metacharacters (`(`, `)`, `.`, `+`, `*`, `?`, etc.) are common — the planned project rename target is `Obsidian MCP Server (Multi-Vault Edition).md`, which contains parentheses. Without escaping, the parens in `<old-basename>` would be interpreted as regex group syntax and the pass would either fail to match or match the wrong thing.

**Alternatives considered**:

- **Use a third-party `escape-string-regexp` package** — rejected. Adds a runtime dependency for a 1-line function, against the constitution's "new runtime dependencies MUST be justified" rule. The function is too small to justify the import cost.
- **Borrow from another in-repo module** — checked; no existing in-repo `escapeRegex` utility was found via grep. A future refactor could pull the helper up to `src/utils/` if other tools need it; for now, locality wins.

**Where used**: Both `<old-basename>` (every pass) and `<old-folder>` (Pass D only) are passed through `escapeRegex` before substitution into the regex template strings.

---

## R11. Atomicity trade-off (NEW under Option B)

**Decision**: **Multi-step, not atomic. Best-effort, no recovery code.** The structured response (`failedAtStep` + `partialState`) tells the caller exactly what was done and what wasn't. The git-clean precondition (FR-005(b)) is the rollback baseline — `git restore .` from the pre-call commit fully reverses any partial state.

**Rationale**: Real recovery code (e.g. "if `delete_source` fails, attempt a reverse-direction `find_and_replace` + delete the newly-written `new_path`") is fragile in three ways:

1. **The recovery itself can fail.** A failure in the recovery path leaves the vault in a worse state than the original failure — and there's no deeper recovery layer.
2. **The recovery has its own failure modes that need their own structured responses.** This recurses; eventually you stop and accept a partial state. Better to stop at the first failure with full state disclosure.
3. **Git is a better recovery tool than anything we'd write.** Every Obsidian vault that's been touched by `find_and_replace` (item 25) is already required to be on clean git state at invocation time — that requirement carries forward. `git restore .` is one command, well-understood, and recovers from any partial state we could leave behind.

The user gets the trade-off via FR-005(a) (description discloses non-atomicity) and FR-005(b) (description recommends git-clean precondition). The structured response (FR-011) gives them the details.

**Alternatives considered**:

- **Reverse-direction recovery code** — rejected per the rationale above.
- **Two-phase commit (write all, then commit, then delete)** — rejected. The Local REST API plugin doesn't expose a transaction boundary, so any "two-phase" we built would be illusory.
- **Refuse to invoke if the vault isn't on clean git state** — rejected. Adds a dependency on git CLI availability and vault-is-a-git-repo assumption; both are reasonable in practice but not enforceable from a REST API tool. Documented as a precondition instead, matching how `find_and_replace` (item 25) handles the same risk.

---

## R12. Item 25 dependency / FR-013 (NEW under Option B)

**Decision**: **Build-time dependency, not runtime.** The handler imports `rest.findAndReplace` as a static module dependency, mirroring how Option A would have imported `rest.openFile` and `rest.executeCommand`. There is no `toolRegistry.has('find_and_replace')` runtime check; the build either succeeds (item 25 is in main) or fails (it's not). Implementation order: item 25 ships first; item 4 ships against the now-importable `rest.findAndReplace` afterward.

**Rationale**: The user's original B1 framing proposed runtime feature-detection ("`if (toolRegistry.has('find_and_replace'))`"), but no such `toolRegistry` abstraction exists in this codebase. Inventing one as part of feature 012 would be a substantial new piece of architecture that's both (a) out of scope for the rename feature and (b) not described in the spec or design. The clean alternative — Option (a) from the B1 escalation — is symmetric with Option A's already-blessed pattern: import the service-layer helper directly, no runtime check.

**Implications**:

- The 012 documentation pivot (this commit) lands in parallel with item 25's branch.
- The 012 implementation (handler + dispatcher wiring + ALL_TOOLS re-wiring) waits for item 25's merge to main.
- A 013 feature branch for item 25 (Vault-wide Find and Replace) starts in parallel with this Option-B documentation pivot. When 013 merges to main, 012 unblocks.
- This is symmetric with how 012 was originally going to depend on item 25 anyway (per the in-vault backlog item 24's coverage matrix); the only difference is the dependency is now load-bearing for the implementation rather than just operationally adjacent.

**Alternatives considered**:

- **Option (b): build a new tool-registry/dispatch infrastructure as part of 012** — rejected. Substantial new architecture, not in the design, expands 012's scope materially.
- **Option (c): ship 012 with a permanently-firing precondition error skeleton** — rejected. A registered tool that's permanently unusable advertises capability it doesn't have, which trips the project's "no false advertisement" pattern (per the in-vault backlog item 23 cleanup constraint).

**Falsification (what would change this decision)**: If item 25 hits a hard infeasibility of its own (its own R5-style spike fails), then 012 is also blocked indefinitely, and the user will need to choose whether to abandon 012 entirely or revisit the decision tree. Out of this research's scope.

---

## Summary of resolutions

| ID | Topic | Status |
|---|---|---|
| R1 | Composition layer (service vs. legacy MCP tool) | **Resolved** — service layer (now five REST methods, expanded scope) |
| R2 | Obsidian command id | **OBSOLETE** under Option B |
| R3 | Active-file requirement (open-before-rename) | **OBSOLETE** under Option B |
| R4 | How `new_path` is conveyed to the command | **OBSOLETE** under Option B |
| R5 | Feasibility-verification spike | **EXECUTED — NEGATIVE.** Drove the Option-B pivot. |
| R6 | Folder-vs-file detection for FR-001a | **Resolved** — trust upstream (mechanism note: now `getFileContents` instead of `openFile`) |
| R7 | Success response shape | **Resolved** — structured `{ok, oldPath, newPath, wikilinkPassesRun, wikilinkRewriteCounts, totalReferencesRewritten}` (plus `failedAtStep`/`partialState` on mid-flight failure) |
| R8 | `vaultId` parameter | **Resolved** — include, optional, matches convention |
| R9 | Wikilink shape coverage rationale | **Resolved** — 4 passes (A/B/C/D), Pass D gated to cross-folder, less-reliable shapes documented |
| R10 | `escapeRegex` utility | **Resolved** — in-repo helper in `regex-passes.ts`; canonical 1-line impl |
| R11 | Atomicity trade-off | **Resolved** — best-effort, no recovery, git as rollback baseline |
| R12 | Item 25 dependency / FR-013 | **Resolved** — build-time import; ship item 25 first; no runtime feature-detect |

All twelve resolutions land in the Option-B documentation pivot commit. No outstanding NEEDS CLARIFICATION blocks the implementation; the only remaining gate is item 25 shipping.
