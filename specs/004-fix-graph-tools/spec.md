# Feature Specification: Fix Graph Tools

**Feature Branch**: `004-fix-graph-tools`
**Created**: 2026-04-26
**Status**: Draft
**Input**: User description: "Fix Graph Tools — All seven graph tools registered on this MCP advertise their schemas at the JSON layer but return 'Error: Unknown tool: <name>' at runtime when called. Investigate the cause and resolve via one of three paths (wire existing implementations, port from upstream, or withdraw the schemas)."

## Clarifications

### Session 2026-04-26

- Q: How should aggregation graph tools behave when the vault contains malformed notes (broken frontmatter, malformed wikilinks, unreadable files, invalid UTF-8)? → A: Skip-and-continue. Every response payload carries a `skipped` integer (always present, may be `0`) and a `skippedPaths` array of up to 50 entries; if `skipped > skippedPaths.length` the array is truncated. A non-zero `skipped` means the result is partial; callers should interpret accordingly.
- Q: For per-note tools (`get_note_connections`, `find_path_between_notes`), what should the response be when the target note path is not present in the vault? → A: Precondition-style error naming the missing path (e.g. `note not found: foo/bar.md`). Distinct from "found but no connections" and "found but no path between endpoints". When an explicit `vaultId` was supplied, the error also names the vault id searched. For `find_path_between_notes`, when one or both endpoints are missing, the error names whichever input(s) are not found. The tool's schema description MUST state this contract so LLM callers see the boundary.
- Q: Under Path C (schemas withdrawn), how should the README communicate the absence of graph tools? → A: One-sentence note in the "Available tools" section listing all seven tool names, stating they are inherited from upstream `@connorbritain/obsidian-mcp-server` but not currently exposed in this fork, with a link to `specs/004-fix-graph-tools/spec.md` for context. Suggested wording: *"Graph tools (`get_vault_stats`, `get_vault_structure`, `find_orphan_notes`, `get_note_connections`, `find_path_between_notes`, `get_most_connected_notes`, `detect_note_clusters`) are inherited from the upstream `@connorbritain/obsidian-mcp-server` but are not currently exposed in this fork. See `specs/004-fix-graph-tools/spec.md` for context."*
- Q: Should the regression test cover only `get_vault_stats` (FR-006) or also the other six graph tools? → A: Both. Keep the `get_vault_stats` deep test (mock backend + assert payload parsing) AND add a parametrized smoke test covering the other six. Smoke contract: each parameter row calls the tool with minimal valid inputs and asserts the response is NOT an `Unknown tool: <name>` error. Other errors (missing arguments, vault path not configured, etc.) are acceptable — they prove the dispatcher routed the call. The parameter list updates when graph tools are added or removed; the assertion logic stays the same. Captured as FR-013.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Eliminate the contract mismatch (Priority: P1)

An LLM caller (or any MCP client) discovers the seven graph tools from the advertised schema and invokes one of them against a vault that has `hasVaultPath: true`. Today, every such call returns `Error: Unknown tool: <name>`, even though the schema validated locally. After this work, the contract is honest: either every advertised graph tool actually runs and returns a recognisable payload, or the tool is no longer advertised at all. No caller ever sees `Unknown tool` for a tool listed in the catalog.

**Why this priority**: This is the headline bug. The current state actively misleads callers: the LLM keeps selecting these tools (because the schema says they exist) and keeps failing (because the dispatcher rejects them). Until the contract is restored, any other improvement is moot.

**Independent Test**: With the MCP running and `OBSIDIAN_VAULT_PATH` set so `list_vaults` reports `hasVaultPath: true`, enumerate the advertised tool catalog and call every graph tool present. Pass criterion: zero `Unknown tool` errors. Either each call returns a recognisable payload (Paths A/B), or the tool is absent from the catalog and so is not called (Path C).

**Acceptance Scenarios**:

1. **Given** the MCP is running and `OBSIDIAN_VAULT_PATH` is set, **When** a caller invokes `get_vault_stats` with no inputs, **Then** the response is either a stats payload (object with notes/links/orphans/cluster fields or similar) or — if Path C was chosen — `get_vault_stats` is not present in the advertised tool list and so is never called.
2. **Given** the MCP is running and `OBSIDIAN_VAULT_PATH` is set, **When** a caller invokes any of `get_vault_structure`, `find_orphan_notes`, `get_note_connections`, `find_path_between_notes`, `get_most_connected_notes`, `detect_note_clusters`, **Then** each returns a recognisable payload of the appropriate shape (e.g. an array of file paths for `find_orphan_notes`) or — if Path C was chosen — is absent from the advertised tool list.
3. **Given** investigation has been performed, **When** the resolution is applied, **Then** the diagnosis (which of the three hypotheses applied) and the chosen resolution path are recorded in the implementation plan so future contributors understand why this fork landed where it did.

---

### User Story 2 - Regression test guards `get_vault_stats` (Priority: P2)

A future contributor refactors the dispatcher (as happened during the `patch_content` re-enablement work that likely caused this bug). The regression test for `get_vault_stats` fails immediately, surfacing the contract drift before it ships. This prevents the same class of bug — schema advertised, runtime missing — from recurring silently.

**Why this priority**: Without a guarding test, this exact bug will recur the next time the dispatcher is refactored. `get_vault_stats` is the canary because (a) it takes no inputs, so the test is simple, and (b) it exercises the full path from dispatcher to upstream invocation to response parsing.

**Independent Test**: Run the project's test suite. The new regression test must execute, mock the upstream that backs `get_vault_stats`, assert the wrapper dispatches the call correctly, and assert the mocked response is parsed into the tool result shape.

**Acceptance Scenarios**:

1. **Given** the test suite is run on a clean checkout after the fix, **When** the `get_vault_stats` regression test executes, **Then** it passes.
2. **Given** a contributor removes the `get_vault_stats` branch from the dispatcher, **When** the test suite runs, **Then** the regression test fails with a message that points at the missing dispatch branch (not a generic timeout or unrelated error).
3. **Given** a contributor removes the dispatcher branch for any of the other six graph tools, **When** the test suite runs, **Then** the parametrized smoke test (FR-013) fails for the specific tool whose branch was removed, naming it in the failure message — making the missing dispatcher branch immediately identifiable.

---

### User Story 3 - README reflects post-fix reality (Priority: P3)

A new user reads the README's "Available tools" section to decide whether this MCP fits their needs. After the fix, what they read matches what they get when they call the server: either the seven graph tools are listed with their preconditions (e.g. "requires `OBSIDIAN_VAULT_PATH`"), or — under Path C — they are surfaced only as a one-sentence "inherited from upstream but not currently exposed in this fork" note pointing at the spec. There is no state where the README promises capabilities the runtime does not deliver, and no state where the absence is silent and unexplained.

**Why this priority**: Important for adoption and trust, but the binary correctness of the contract (US1) and the regression guard (US2) ship value first. README drift is a documentation defect, not a runtime defect.

**Independent Test**: Diff the README's "Available tools" section against the MCP's actual advertised tool catalog after the fix. Every tool in the README should be in the catalog; no graph tool in the catalog should be missing from the README; preconditions stated in the README should match those enforced at runtime.

**Acceptance Scenarios**:

1. **Given** Path A or B was taken, **When** a reader scans the README's "Available tools" section, **Then** the seven graph tools are listed with any required preconditions (e.g. `OBSIDIAN_VAULT_PATH` must be set) stated near each.
2. **Given** Path C was taken, **When** a reader scans the README's "Available tools" section, **Then** the seven graph tools are not listed as available capabilities, but a one-sentence note names all seven, states they are inherited from upstream `@connorbritain/obsidian-mcp-server` but not currently exposed in this fork, and links to `specs/004-fix-graph-tools/spec.md` for context.

---

### Edge Cases

- **`OBSIDIAN_VAULT_PATH` unset**: When a graph tool is called without the required vault path, the response MUST be a clear precondition error (e.g. "vault path not configured"), never `Unknown tool: <name>`. This applies whether Path A, B, or C is chosen — under Path C the tool is absent, so the question does not arise.
- **Empty vault (zero notes)**: `get_vault_stats` and similar aggregations MUST return a well-formed payload with zero counts (and `skipped: 0`, `skippedPaths: []`), not throw.
- **Malformed or unreadable notes**: When a note has broken frontmatter, malformed wikilinks, unreadable contents, or invalid UTF-8, the graph tool MUST skip that note and continue. Every response payload carries `skipped` (integer, always present, may be `0`) and `skippedPaths` (array of up to 50 entries; truncated if `skipped > 50`). A non-zero `skipped` indicates the result is partial. See FR-011.
- **Missing note path for per-note tools**: When `get_note_connections` or `find_path_between_notes` is called with a note path that is not present in the targeted vault (typo, deleted file, wrong vault), the response MUST be a precondition-style error naming the missing path. This is distinct from the "found but empty" and "found but no path" cases below. See FR-012.
- **Disconnected notes for `find_path_between_notes`**: When *both* endpoints exist in the vault but no walk connects them, the response MUST indicate "no path" in a recognisable shape (e.g. empty array or `{ path: null }`), not a hard error. (If one or both endpoints are missing entirely, the missing-path edge case above applies instead.)
- **Vault with thousands of notes**: Graph tools MUST complete in time bounded by the underlying graph library's complexity; this spec does not impose additional latency budgets beyond what users expect from the upstream behaviour.
- **Path C chosen, then later reversed**: If a future contributor re-adds the schemas, they MUST also wire the dispatcher branches and add tests — both the `get_vault_stats` deep regression test (US2 / FR-006) and the parametrized smoke test for the other six tools (FR-013) are intentionally retained even under Path C, but skipped or marked pending so the scaffold is not lost.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The implementation MUST begin with an investigation phase that determines which of three hypotheses explains the `Unknown tool` error: (a) implementations exist but are not wired into the dispatcher, (b) implementations are missing entirely, or (c) implementations require an unset build-time flag, runtime env var, or missing dependency.
- **FR-002**: The investigation MUST select exactly one resolution path — Path A (wire existing implementations), Path B (port from upstream `@connorbritain/obsidian-mcp-server`), or Path C (withdraw the schemas) — preferring A over B over C.
- **FR-003**: After resolution, no graph tool that is present in the MCP's advertised tool list MUST return `Error: Unknown tool: <name>` at runtime. (This is the core contract-integrity requirement and applies to all three paths.)
- **FR-004**: If Path A or B is chosen, each of the seven graph tools (`get_vault_stats`, `get_vault_structure`, `find_orphan_notes`, `get_note_connections`, `find_path_between_notes`, `get_most_connected_notes`, `detect_note_clusters`) MUST return a non-error payload of a recognisable shape when invoked against a vault with `hasVaultPath: true`.
- **FR-005**: If Path C is chosen, the seven schemas MUST be removed from the MCP's advertised tool list such that a `ToolSearch` query for any of the seven tool names returns zero results.
- **FR-006**: A regression test MUST cover `get_vault_stats` end-to-end through the dispatcher, mocking the underlying graph backend and asserting both that the wrapper invokes it correctly and that the mocked response is parsed into the tool result.
- **FR-007**: The README's "Available tools" section MUST accurately reflect the post-fix reality: under Paths A/B, list the seven tools with any preconditions stated; under Path C, do not list them as available capabilities but include a one-sentence note that names all seven tools, states they are inherited from upstream `@connorbritain/obsidian-mcp-server` but not currently exposed in this fork, and links to `specs/004-fix-graph-tools/spec.md` for context.
- **FR-008**: Under Paths A and B, each graph tool's description (in the schema advertised over MCP) MUST state any preconditions it requires — at minimum, that `OBSIDIAN_VAULT_PATH` must be set for the targeted vault.
- **FR-009**: Under Paths A and B, when a graph tool is invoked but its preconditions are unmet (e.g. no vault path configured), the response MUST be a clear precondition error, never `Unknown tool`.
- **FR-010**: If Path B is chosen, the response shapes and underlying graph-library calls SHOULD follow the upstream `@connorbritain/obsidian-mcp-server` reference unless there is a documented reason to diverge.
- **FR-011**: Under Paths A and B, every aggregation graph tool (`get_vault_stats`, `get_vault_structure`, `find_orphan_notes`, `get_most_connected_notes`, `detect_note_clusters`) MUST tolerate malformed notes by skipping them rather than aborting. Each response payload MUST include a `skipped` integer (always present, may be `0`) and a `skippedPaths` array of up to 50 entries (truncated when `skipped > 50`). A non-zero `skipped` value signals partial results. (Per-note tools `get_note_connections` and `find_path_between_notes` do not aggregate, so skip-and-continue does not apply — see FR-012 for their not-found / not-parseable contract.)
- **FR-012**: Under Paths A and B, the per-note tools `get_note_connections` and `find_path_between_notes` MUST return a precondition-style error when a target note path is not present in the targeted vault, distinct from "found but no connections" and "found but no path". The error message MUST name the missing path (e.g. `note not found: foo/bar.md`); when an explicit `vaultId` is supplied, the error MUST also name the vault id searched. For `find_path_between_notes`, if one or both endpoints are missing, the error MUST name whichever input(s) are not found. Each tool's schema description MUST state this contract so LLM callers see the boundary in the catalog. The same error shape applies when the target note is present but cannot be parsed (broken frontmatter / unreadable file / invalid UTF-8).
- **FR-013**: A parametrized smoke test MUST cover the six graph tools other than `get_vault_stats` (i.e. `get_vault_structure`, `find_orphan_notes`, `get_note_connections`, `find_path_between_notes`, `get_most_connected_notes`, `detect_note_clusters`). Each parameter row MUST call the tool with minimal valid inputs and assert the response is NOT an `Unknown tool: <name>` error. Other error responses (missing arguments, vault path not configured, etc.) are acceptable — they prove the dispatcher routed the call to a handler, which is what this test guards against. When a tool is added to or removed from the graph set, the parameter list updates; the assertion logic stays the same.

### Key Entities *(include if feature involves data)*

- **Advertised tool catalog**: The set of tool names + JSON schemas the MCP exposes to clients via the standard list-tools mechanism. The bug is that this set is a superset of what the runtime can actually serve.
- **Runtime dispatcher**: The component (likely in `src/index.ts` or `src/server.ts`) that receives a tool-call request, looks up the tool name, and routes to the implementing handler. The dispatcher is currently the source of `Unknown tool: <name>` for the seven graph tools.
- **Graph tool implementation**: The handler function for each of the seven tools. May be present-but-unwired (Hypothesis 1), missing entirely (Hypothesis 2), or present-but-disabled (Hypothesis 3).
- **Vault graph**: The conceptual graph derived from the Obsidian vault — notes as nodes, wiki/Markdown links as edges. The substrate the seven tools operate on. May be implemented locally (filesystem walk + parse) or delegated to an upstream service; this spec is agnostic.
- **README "Available tools" section**: The user-facing capability list that must remain consistent with the advertised tool catalog after the fix.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero of the seven graph tools return `Unknown tool: <name>` when invoked through the MCP, measured by running each tool once against a vault with `hasVaultPath: true` after the fix.
- **SC-002**: The set of graph-tool names in the advertised tool catalog equals the set of graph-tool names that succeed at runtime — i.e. the catalog has no false advertisements. (Empty-on-both-sides under Path C also satisfies this criterion.)
- **SC-003**: The `get_vault_stats` regression test passes on a clean checkout and fails when its dispatch branch is artificially removed, demonstrating it actually guards the contract.
- **SC-004**: A reader cross-checking the README's "Available tools" section against the live MCP catalog finds no discrepancies in the graph-tools subset.
- **SC-005**: An LLM caller obtaining vault statistics needs only one tool call (no retry, no fallback to a different tool) — measurable by capturing a transcript of the canonical "what does my vault look like?" interaction.
- **SC-006**: The parametrized smoke test for the other six graph tools passes on a clean checkout and fails specifically (with a row identifier matching the affected tool name) when any one of those six dispatch branches is artificially removed.

## Assumptions

- The runtime dispatcher is located in `src/index.ts` or `src/server.ts`, consistent with the user's brief and with where similar dispatch logic was touched during the `patch_content` re-enablement work (specs/001-reenable-patch-content).
- `OBSIDIAN_VAULT_PATH` is the established precondition signal for vault-aware tools, since `list_vaults` already exposes `hasVaultPath` based on it.
- "Upstream" in Path B refers to `@connorbritain/obsidian-mcp-server`, the fork's parent, where the seven graph tools are reported to work.
- The exact mocking strategy for the `get_vault_stats` regression test is implementation-defined and depends on which path is taken: HTTP mock if the upstream is invoked over REST, vault-filesystem mock if the implementation is local. The user's brief mentions HTTP mocking, suggesting Path B is the most likely outcome, but this is not prescribed.
- Response shapes under Paths A/B are mostly implementation-defined. The exceptions are the `skipped` and `skippedPaths` fields on aggregation-tool payloads, which are mandated by FR-011. All other field names remain implementation-defined; the pass criterion for them is "recognisable payload of the appropriate shape".
- Investigation outcome and chosen path will be recorded in the planning artefacts (`research.md`, `plan.md`) under this feature directory, not in the spec itself, since the spec is path-agnostic by design.
- Path C does not require deletion of any handler source files that may exist — only removal of the schemas from the advertised catalog. This preserves work for a future re-enablement.
