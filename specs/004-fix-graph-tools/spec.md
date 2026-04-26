# Feature Specification: Fix Graph Tools

**Feature Branch**: `004-fix-graph-tools`
**Created**: 2026-04-26
**Status**: Draft
**Input**: User description: "Fix Graph Tools — All seven graph tools registered on this MCP advertise their schemas at the JSON layer but return 'Error: Unknown tool: <name>' at runtime when called. Investigate the cause and resolve via one of three paths (wire existing implementations, port from upstream, or withdraw the schemas)."

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

---

### User Story 3 - README reflects post-fix reality (Priority: P3)

A new user reads the README's "Available tools" section to decide whether this MCP fits their needs. After the fix, what they read matches what they get when they call the server: either the seven graph tools are listed with their preconditions (e.g. "requires `OBSIDIAN_VAULT_PATH`"), or they are not listed at all. There is no third state where the README promises capabilities the runtime does not deliver.

**Why this priority**: Important for adoption and trust, but the binary correctness of the contract (US1) and the regression guard (US2) ship value first. README drift is a documentation defect, not a runtime defect.

**Independent Test**: Diff the README's "Available tools" section against the MCP's actual advertised tool catalog after the fix. Every tool in the README should be in the catalog; no graph tool in the catalog should be missing from the README; preconditions stated in the README should match those enforced at runtime.

**Acceptance Scenarios**:

1. **Given** Path A or B was taken, **When** a reader scans the README's "Available tools" section, **Then** the seven graph tools are listed with any required preconditions (e.g. `OBSIDIAN_VAULT_PATH` must be set) stated near each.
2. **Given** Path C was taken, **When** a reader scans the README's "Available tools" section, **Then** the seven graph tools are absent and the section makes no claim about graph capabilities.

---

### Edge Cases

- **`OBSIDIAN_VAULT_PATH` unset**: When a graph tool is called without the required vault path, the response MUST be a clear precondition error (e.g. "vault path not configured"), never `Unknown tool: <name>`. This applies whether Path A, B, or C is chosen — under Path C the tool is absent, so the question does not arise.
- **Empty vault (zero notes)**: `get_vault_stats` and similar aggregations MUST return a well-formed payload with zero counts, not throw.
- **Disconnected notes for `find_path_between_notes`**: When no path exists between two notes, the response MUST indicate "no path" in a recognisable shape (e.g. empty array or `{ path: null }`), not a hard error.
- **Vault with thousands of notes**: Graph tools MUST complete in time bounded by the underlying graph library's complexity; this spec does not impose additional latency budgets beyond what users expect from the upstream behaviour.
- **Path C chosen, then later reversed**: If a future contributor re-adds the schemas, they MUST also wire the dispatcher branches and add tests — the regression test for `get_vault_stats` (US2) is intentionally retained even under Path C, but skipped or marked pending so the scaffold is not lost.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The implementation MUST begin with an investigation phase that determines which of three hypotheses explains the `Unknown tool` error: (a) implementations exist but are not wired into the dispatcher, (b) implementations are missing entirely, or (c) implementations require an unset build-time flag, runtime env var, or missing dependency.
- **FR-002**: The investigation MUST select exactly one resolution path — Path A (wire existing implementations), Path B (port from upstream `@connorbritain/obsidian-mcp-server`), or Path C (withdraw the schemas) — preferring A over B over C.
- **FR-003**: After resolution, no graph tool that is present in the MCP's advertised tool list MUST return `Error: Unknown tool: <name>` at runtime. (This is the core contract-integrity requirement and applies to all three paths.)
- **FR-004**: If Path A or B is chosen, each of the seven graph tools (`get_vault_stats`, `get_vault_structure`, `find_orphan_notes`, `get_note_connections`, `find_path_between_notes`, `get_most_connected_notes`, `detect_note_clusters`) MUST return a non-error payload of a recognisable shape when invoked against a vault with `hasVaultPath: true`.
- **FR-005**: If Path C is chosen, the seven schemas MUST be removed from the MCP's advertised tool list such that a `ToolSearch` query for any of the seven tool names returns zero results.
- **FR-006**: A regression test MUST cover `get_vault_stats` end-to-end through the dispatcher, mocking the underlying graph backend and asserting both that the wrapper invokes it correctly and that the mocked response is parsed into the tool result.
- **FR-007**: The README's "Available tools" section MUST accurately reflect the post-fix reality: under Paths A/B, list the seven tools with any preconditions stated; under Path C, omit them entirely.
- **FR-008**: Under Paths A and B, each graph tool's description (in the schema advertised over MCP) MUST state any preconditions it requires — at minimum, that `OBSIDIAN_VAULT_PATH` must be set for the targeted vault.
- **FR-009**: Under Paths A and B, when a graph tool is invoked but its preconditions are unmet (e.g. no vault path configured), the response MUST be a clear precondition error, never `Unknown tool`.
- **FR-010**: If Path B is chosen, the response shapes and underlying graph-library calls SHOULD follow the upstream `@connorbritain/obsidian-mcp-server` reference unless there is a documented reason to diverge.

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

## Assumptions

- The runtime dispatcher is located in `src/index.ts` or `src/server.ts`, consistent with the user's brief and with where similar dispatch logic was touched during the `patch_content` re-enablement work (specs/001-reenable-patch-content).
- `OBSIDIAN_VAULT_PATH` is the established precondition signal for vault-aware tools, since `list_vaults` already exposes `hasVaultPath` based on it.
- "Upstream" in Path B refers to `@connorbritain/obsidian-mcp-server`, the fork's parent, where the seven graph tools are reported to work.
- The exact mocking strategy for the `get_vault_stats` regression test is implementation-defined and depends on which path is taken: HTTP mock if the upstream is invoked over REST, vault-filesystem mock if the implementation is local. The user's brief mentions HTTP mocking, suggesting Path B is the most likely outcome, but this is not prescribed.
- Response shapes under Paths A/B are implementation-defined. The pass criterion is "recognisable payload of the appropriate shape" — exact field names are not part of the contract this spec enforces.
- Investigation outcome and chosen path will be recorded in the planning artefacts (`research.md`, `plan.md`) under this feature directory, not in the spec itself, since the spec is path-agnostic by design.
- Path C does not require deletion of any handler source files that may exist — only removal of the schemas from the advertised catalog. This preserves work for a future re-enablement.
