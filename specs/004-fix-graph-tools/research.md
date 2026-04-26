# Research: Fix Graph Tools

This document records the investigation phase the spec mandates as part of resolution (FR-001 + FR-002), plus the design decisions that fell out of it. Each section follows: **Decision** / **Rationale** / **Alternatives considered**.

---

## R1 — Investigation outcome (which hypothesis applies)

**Decision**: **Hypothesis 1 confirmed.** The implementations exist in the source but are not wired into the dispatcher.

**Evidence (gathered by reading the code at HEAD = 41f7493 on `004-fix-graph-tools`)**:

1. [src/services/graph-service.ts](../../src/services/graph-service.ts) defines `GraphService` with all seven public methods (`getVaultStats`, `findOrphanNotes`, `getNoteConnections`, `findPathBetweenNotes`, `getMostConnectedNotes`, `detectNoteClusters`, `getVaultStructure`). Each method uses `graphology` natively and is internally consistent.
2. [src/tools/graph-tools.ts](../../src/tools/graph-tools.ts) defines `GRAPH_TOOLS: Tool[]` containing the seven schemas — each with name, description, and JSON inputSchema.
3. [src/tools/index.ts](../../src/tools/index.ts) spreads `...GRAPH_TOOLS` into `ALL_TOOLS`, which [src/index.ts:242-244](../../src/index.ts#L242-L244) returns from the `ListToolsRequestSchema` handler. So the schemas reach clients.
4. [src/index.ts:90-99](../../src/index.ts#L90-L99) defines `getGraphService(vaultId)`, which lazily constructs `GraphService` per vault and includes the `if (!vault.vaultPath) throw ...` precondition the spec requires (FR-009).
5. [src/index.ts:264-478](../../src/index.ts#L264-L478) is `handleToolCall(name, args)`. Its `switch (name)` enumerates 19 tools (`list_vaults`, `list_files_in_vault`, `list_files_in_dir`, `get_file_contents`, `get_heading_contents`, `get_frontmatter_field`, `search`, `patch_content`, `append_content`, `put_content`, `delete_file`, `batch_get_file_contents`, `complex_search`, `get_periodic_note`, `get_recent_periodic_notes`, `get_recent_changes`, `get_active_file`, `open_file`, `list_commands`, `execute_command`, `pattern_search`). **None of the seven graph-tool names appears.** Calls fall through to `default: throw new Error(\`Unknown tool: ${name}\`)` at line 476 — the exact error the user reproduced.
6. `package.json` already declares `graphology@^0.25.4`, `graphology-communities-louvain@^2.0.1`, `graphology-metrics@^2.3.0`, `graphology-shortest-path@^2.1.0`, `graphology-traversal@^0.3.1`, `graphology-utils@^2.3.1`. **Hypothesis 3 (missing dependency) is ruled out** — every import the existing service needs is satisfied.

**Rationale**: The fix is a wiring problem, not a porting problem. The existing service is well-formed and returns recognisable shapes that match the spec's "stats payload (object with notes/links/orphans/cluster fields or similar)" example for `get_vault_stats` directly (`VaultStats` already has `totalNotes`, `totalLinks`, `orphanCount`, `tagCount`, `clusterCount`).

**Alternatives considered**:
- *Hypothesis 2 (implementations missing entirely)*: Refuted by the existence of `src/services/graph-service.ts` with 7 working public methods.
- *Hypothesis 3 (missing build flag / env var / dep)*: Refuted by `package.json` (all graphology deps present) and by the absence of any feature-flag check in either the dispatcher or `GraphService`.
- *Plausibility of pre-existing branches having been deleted*: `git log -p src/index.ts -- "graph"` could be checked for removed `case` lines. Not done — the current absence is sufficient evidence and the cause (likely the patch-content re-enablement work touching the dispatcher) is not load-bearing for the fix.

---

## R2 — Resolution path selection

**Decision**: **Path A — wire the existing implementations.**

**Rationale**: Path A is mandated by FR-002's preference order ("preferring A over B over C") whenever it is viable, and R1 establishes that it is viable: nothing is missing. Path B (port from upstream) would duplicate code that already works locally. Path C (withdraw schemas) would discard a working implementation and reduce capability without justification.

**Alternatives considered**:
- *Path B*: Would mean replacing or supplementing the local `GraphService` with calls to `@connorbritain/obsidian-mcp-server`. Rejected: there is no upstream HTTP service to call from this fork's runtime — the upstream is a separate npm package whose graph code is in-process, just like this fork's. "Porting" would amount to copying code that already exists.
- *Path C*: Would mean removing the seven schemas from `GRAPH_TOOLS` and updating the README per the spec's Path C messaging. Rejected: there is no engineering cost saved (the implementations are already written) and a real capability is lost.

---

## R3 — Tool wrapper structure (constitution Principle III)

**Decision**: Refactor the seven graph tools to follow the **zod-first** pattern already used by `patch-content` (specs/001) and `surgical-reads` (specs/003). Each tool gets a zod schema in `src/tools/graph/schemas.ts`; the `inputSchema` published in `GRAPH_TOOLS` is derived via `zod-to-json-schema`; each handler calls an `assertValid*Request(args)` validator before delegating to `GraphService`.

**Rationale**: Constitution Principle III requires `zod` for boundary validation. The existing `src/tools/graph-tools.ts` declares hand-rolled JSON schemas — that is a pre-constitution artefact (the file dates from before the Principle III ratification on 2026-04-26). Wiring the tools into the dispatcher *without* fixing the validation pattern would land non-compliant code in `main`. Doing it correctly the first time is cheaper than a follow-up cleanup.

**Alternatives considered**:
- *Inline `if (!args.filepath) throw ...` checks in each handler*: Constitution-violating (Principle III mandates zod). Rejected.
- *Keep the hand-written JSON schemas and add zod alongside*: Two sources of truth that can drift — exactly the failure mode Principle III's "single source" rule prevents. Rejected.
- *Generate zod schemas from the existing JSON ones at runtime*: Possible but adds a dependency for no real benefit. Rejected.

---

## R4 — Skip-and-continue contract for malformed notes (FR-011)

**Decision**: Extend `GraphService.buildGraph()` to wrap each per-file `fs.readFile` + parse step in `try/catch`. Successfully-parsed files are added to the graph as today; failures push the relative path onto a private `skippedPaths: string[]` and increment a private `skipped: number`. Both fields are reset at the start of each rebuild. Each public aggregation method (`getVaultStats`, `findOrphanNotes`, `getMostConnectedNotes`, `detectNoteClusters`, `getVaultStructure`) returns an envelope of the form `{ ...originalResult, skipped, skippedPaths: skippedPaths.slice(0, 50) }` — `slice(0, 50)` enforces the 50-entry cap from the clarification. The total `skipped` count is preserved even when truncation happens, satisfying "if `skipped > 50` the array is truncated".

**Rationale**: The skip data is a per-build property of the graph — it changes only on rebuild and is shared across every aggregation that reads from the cached graph. Storing it on the service instance and reading from the public methods avoids threading a `SkipReport` through every internal helper. The 50-entry cap is enforced at the read site (the handler envelope) rather than during build, so the full path list remains available for diagnostics if needed in the future.

**Alternatives considered**:
- *Throw on the first malformed note*: Spec-violating (FR-011 mandates skip-and-continue). Rejected.
- *Return a `SkipReport` object from `buildGraph()` and pass it explicitly into each public method*: More plumbing, no functional benefit. Rejected.
- *Cap `skippedPaths` at 50 inside `buildGraph` itself*: Loses the count-vs-list distinction the spec carefully preserves. Rejected.

---

## R5 — Per-note tool not-found contract (FR-012)

**Decision**: Align the existing `throw new Error(...)` messages in `GraphService.getNoteConnections` and `findPathBetweenNotes` to the FR-012 wording: `note not found: <path>` for the single-note tool, and for the pair tool, `note not found: <source>` / `note not found: <target>` / `notes not found: <source>, <target>` depending on which endpoints are missing. When the handler was called with an explicit `vaultId`, the message is suffixed with ` (vault: <id>)`.

**Rationale**: The current messages (`Note not found in graph: ${filepath}`, `Source note not found: ${source}`, `Target note not found: ${target}`) are close to the spec but the wording differs. Aligning to the spec contract makes the schema description in `GRAPH_TOOLS` truthful (FR-012 requires the contract to be stated in the description) and lets tests assert against a stable string. The vault-id suffix is added inside the handler (which knows whether `vaultId` was explicitly supplied) rather than in the service (which only sees the resolved vault).

**Alternatives considered**:
- *Throw a structured error class (e.g. `NoteNotFoundError`)* and translate to a string in the handler: Cleaner, but adds a type the dispatcher's existing string-based `try/catch` doesn't need. Rejected for now; can be revisited if more error types appear.
- *Keep the existing wording*: Rejected — FR-012 mandates the specific format.

---

## R6 — Mocking strategy for the FR-006 deep test

**Decision**: Inject a mock `GraphService` instance (or stub its `getVaultStats` method via `vi.spyOn`) in the test. The handler under test is a thin wrapper: validate args, call `service.getVaultStats()`, wrap result in the envelope. Test asserts (a) the handler invokes `getVaultStats` with no arguments, (b) the mocked return value is parsed into the MCP response envelope correctly (including `skipped: 0`, `skippedPaths: []` when the mock returns a "clean build" result), and (c) the handler does not call any other service method.

**Rationale**: The graph backend is local (filesystem walk + graphology), not HTTP — so `nock` (used for `patch_content` tests) is not the right tool here. Mocking at the `GraphService` boundary keeps the test fast (no real I/O, no `graphology` build) and isolates the wrapper logic from the service logic, which is the level FR-006 cares about ("the wrapper invokes it correctly and the mocked response is parsed").

**Alternatives considered**:
- *Build a real graph against a tiny fixture vault on disk*: Would test more end-to-end but couples the test to filesystem layout and slows the suite. Better deferred to a possible future integration test (out of scope here).
- *Mock at the `node:fs/promises` boundary*: Would test more code paths but introduces fragile expectations about the internal walk order. Rejected.

---

## R7 — `vaultId` parameter handling for the seven tools

**Decision**: Every graph tool's zod schema has an optional `vaultId: z.string().optional()` field. When unset, the dispatcher's existing `resolveVaultId(args)` (src/index.ts:114-117) falls back to `defaultVaultId` from config — same as every other vault-aware tool. The handler receives the resolved vault id and passes it to `getGraphService(vaultId)`.

**Rationale**: This matches the pattern every other vault-aware tool already uses (e.g., `list_files_in_vault`, `patch_content`). No new mechanism required. The current hand-written graph schemas already include `vaultId` as a property, so this is a like-for-like translation into zod.

**Alternatives considered**: None — the existing pattern is clearly the right one to follow.

---

## R8 — Caching / build-sharing strategy

**Decision**: Keep the existing `cacheTTL` mechanism in `GraphService` (300s default, configurable via `Config.graphCacheTtl`). No changes.

**Rationale**: This is plan-level scope the spec deliberately deferred. The existing TTL-cache is appropriate: graph builds are expensive, vault contents change infrequently relative to MCP query rate, and a 5-minute staleness window is acceptable for analytics queries. No reason to add request-collapsing, instance-level locks, or other complexity in this fix.

**Alternatives considered**:
- *Disable caching*: Would slow large vaults significantly. Rejected.
- *Add request-collapsing to dedupe concurrent rebuilds*: Plausible but YAGNI for the current MCP transport pattern (single client per server process). Rejected for this feature; revisit if profiling shows contention.

---

## R9 — `get_vault_structure` response shape

**Decision**: Return the existing `Record<string, unknown>` nested-object tree structure produced by `GraphService.getVaultStructure`, wrapped in the standard envelope with `skipped` / `skippedPaths`. Folders are keys ending in `/`; files (when `includeFiles: true`) are keys with `null` values; nested objects represent subfolders.

**Rationale**: The spec is explicitly silent on this shape ("recognisable payload of the appropriate shape" — implementation-defined). The existing implementation already produces a tree, which is the natural representation for "folder structure". Switching to a flat list would lose hierarchy information without a clear caller benefit.

**Alternatives considered**:
- *Flat list with depth indicators*: More uniform but harder to render. Rejected.
- *Both shapes via a `format` arg*: Premature optionality. Rejected.

---

## R10 — Test breadth structure (FR-006 + FR-013 + Constitution Principle II)

**Decision**: Three test files under `tests/tools/graph/`:

- `registration.test.ts` — for each of the seven tool names: assert it appears in `ALL_TOOLS`, has a derived `inputSchema` of `type: 'object'`, and has a description containing the precondition phrase `OBSIDIAN_VAULT_PATH`.
- `schema.test.ts` — one zod-validation-failure assertion per tool (e.g. `assertValidGetNoteConnectionsRequest({})` rejects with `filepath` in the field path). Satisfies Principle II's "validation failure" requirement.
- `handler-vault-stats.test.ts` — FR-006 deep test: mock `GraphService`, call `handleGetVaultStats(args, mockService)`, assert dispatch + payload parsing including `skipped` / `skippedPaths`.
- `smoke.test.ts` — FR-013 parametrized test: for each of the other six tool names, build a request with minimal valid inputs, call the dispatcher's `handleToolCall(name, args)` against a real `ObsidianMCPServer` instance with a minimal mock vault config, and assert `result.content[0].text` does not match `/Unknown tool/`.

**Rationale**: This split keeps each file focused (registration ↔ catalog drift, schema ↔ validation, handler-vault-stats ↔ wiring + parsing, smoke ↔ dispatcher coverage). It also lets the `Smoke` test catch the *specific* dispatcher-omission bug that motivated this fix — a future contributor who removes one of the seven cases will see exactly which row failed.

**Alternatives considered**:
- *One mega-test-file*: Harder to navigate, slower partial reruns. Rejected.
- *Separate files per tool*: 7 × 2 = 14 files for very little extra coverage. Rejected.
