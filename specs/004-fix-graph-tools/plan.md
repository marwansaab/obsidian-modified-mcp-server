# Implementation Plan: Fix Graph Tools

**Branch**: `004-fix-graph-tools` | **Date**: 2026-04-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-fix-graph-tools/spec.md`

## Summary

The seven graph tools (`get_vault_stats`, `get_vault_structure`, `find_orphan_notes`, `get_note_connections`, `find_path_between_notes`, `get_most_connected_notes`, `detect_note_clusters`) are advertised via `ALL_TOOLS` and have a complete local implementation in [src/services/graph-service.ts](../../src/services/graph-service.ts), but the dispatcher's `switch (name)` in [src/index.ts:300-478](../../src/index.ts#L300-L478) does not include any `case` branch for them — every call falls through to `default: throw new Error(\`Unknown tool: ${name}\`)` at line 476. **This is Hypothesis 1**, the most likely scenario the spec considered, and dictates **Path A** (wire the existing implementations).

The technical approach: refactor the graph tool registration to follow the constitution-compliant pattern already used by `patch-content` and `surgical-reads` (zod schema → derived JSON inputSchema + thin handler that validates at the boundary), wire seven new `case` branches in the dispatcher, extend `GraphService` to track `skipped` / `skippedPaths` per build (FR-011), align its existing not-found errors to the FR-012 contract, and add the test net required by FR-006 + FR-013 (FR-014 is moot under Path A).

## Technical Context

**Language/Version**: TypeScript 5.6.x (strict mode, ES modules), compiled with `tsc --noEmit` clean and bundled with `tsup`
**Primary Dependencies**: `@modelcontextprotocol/sdk` ^1.12.0 (server transport + types), `graphology` ^0.25.4 (graph data structure), `graphology-communities-louvain` ^2.0.1 (cluster detection), `graphology-metrics` ^2.3.0 (PageRank), `graphology-shortest-path` ^2.1.0 (path-finding), `zod` ^3.23.8 (boundary input validation, per Constitution Principle III), `zod-to-json-schema` 3.25.2 (schema derivation)
**Storage**: Local Obsidian vault on filesystem (no DB). Vault contents read via `node:fs/promises` walk inside `GraphService`.
**Testing**: `vitest` 4.1.5; `nock` 14.0.13 already installed for HTTP mocking. For the graph tools, the underlying backend is local filesystem — mocks will substitute the `GraphService` instance rather than HTTP.
**Target Platform**: Node.js >= 18 (per `package.json` `engines`); cross-platform (Windows, macOS, Linux) per the existing path normalization in `GraphService.findMarkdownFiles`.
**Project Type**: Library / MCP server (single TypeScript project, `src/` + `tests/` mirror). No frontend, no separate API layer.
**Performance Goals**: Out of scope for this bug fix (per spec). Existing `graphCacheTtl` (default 300s) is preserved.
**Constraints**: Constitution Principles I–IV apply. No new runtime dependencies needed (graphology suite + zod already installed).
**Scale/Scope**: Vaults of "thousands of notes" are mentioned in the spec; the existing `GraphService` already handles that range using `graphology` natively. No additional scaling work in this feature.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution defines four normative principles ([.specify/memory/constitution.md](../../.specify/memory/constitution.md)). Each is evaluated against this feature:

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Modular Code Organization** | ✅ PASS | New code lands under `src/tools/graph/` (subdirectory), matching the layout already used by `patch-content` and `surgical-reads`. `GraphService` already lives in `src/services/`. The dispatcher wiring is the only change in `src/index.ts` and remains thin (each `case` calls a single handler module). |
| **II. Public Tool Test Coverage (NON-NEGOTIABLE)** | ✅ PASS by design | Per FR-006 and FR-013, the seven tools get a `get_vault_stats` deep test (happy path + service-mock assertions) and a parametrized smoke test for the other six (each row asserts non-`Unknown tool` response). Per Principle II's "happy path AND validation-failure" requirement, each tool also gets at least one test exercising a zod validation failure (e.g. `get_note_connections` called without `filepath`) — these are added during implementation; the spec requires the smoke test to *accept* validation failures as proof of dispatch, but Principle II requires the validation-failure case to be its own assertion. |
| **III. Boundary Input Validation with Zod** | ✅ PASS by design | The current `src/tools/graph-tools.ts` defines hand-written JSON schemas — these will be replaced with zod schemas in `src/tools/graph/schemas.ts`, and the JSON `inputSchema` will be derived via `zod-to-json-schema` (matching `patch-content/tool.ts`). Each handler calls `assertValid*Request(args)` before delegating to `GraphService`. |
| **IV. Explicit Upstream Error Propagation** | ✅ PASS | `GraphService` already throws on filesystem errors and on missing notes. The handlers will let those throws propagate (the dispatcher's `try/catch` at `src/index.ts:250-260` already converts them to MCP `isError: true` responses with the message preserved). The new `skipped` / `skippedPaths` fields surface partial-result information that would otherwise be silently dropped when malformed notes are encountered — a strict win for Principle IV. |

**Test runner gap**: Constitution sync impact report flagged that vitest needed to be added "before the next public tool is shipped or amended." This has since been completed (`vitest@4.1.5` is in `devDependencies` and prior features 001 + 003 added tests under `tests/tools/`). No remaining gap.

**Gates evaluated post-design** (re-check after Phase 1): no constitution violations identified. No `Complexity Tracking` entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/004-fix-graph-tools/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output: investigation outcome + design decisions
├── data-model.md        # Phase 1 output: payload shapes for the seven tools (incl. skipped fields)
├── quickstart.md        # Phase 1 output: how to verify the fix manually + via tests
├── contracts/           # Phase 1 output: per-tool I/O contracts
│   ├── get_vault_stats.md
│   ├── get_vault_structure.md
│   ├── find_orphan_notes.md
│   ├── get_note_connections.md
│   ├── find_path_between_notes.md
│   ├── get_most_connected_notes.md
│   └── detect_note_clusters.md
├── checklists/
│   └── requirements.md  # From /speckit-specify
├── spec.md              # From /speckit-specify
└── tasks.md             # Phase 2 output (NOT created here — see /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── config.ts                          # (unchanged)
├── index.ts                           # MODIFIED: 7 new switch cases dispatching to graph handlers
├── types.ts                           # MODIFIED: extend VaultStats / NoteConnections envelopes with skipped/skippedPaths; add SkipReport
├── services/
│   ├── graph-service.ts               # MODIFIED: track lastSkipped/lastSkippedPaths during buildGraph; align not-found error wording to FR-012
│   ├── obsidian-rest.ts               # (unchanged)
│   └── smart-connections.ts           # (unchanged)
└── tools/
    ├── graph-tools.ts                 # REPLACED by graph/tool.ts re-export (or removed; tools/index.ts updated)
    ├── graph/                         # NEW directory (matches patch-content/, surgical-reads/ pattern)
    │   ├── schemas.ts                 # NEW: 7 zod schemas + assertValid*Request functions
    │   ├── handlers.ts                # NEW: 7 thin handler functions (validate → call service → wrap result)
    │   └── tool.ts                    # NEW: GRAPH_TOOLS array, inputSchemas derived via zodToJsonSchema
    ├── index.ts                       # MODIFIED: import from ./graph/tool.js instead of ./graph-tools.js
    ├── patch-content/                 # (unchanged — reference pattern)
    ├── surgical-reads/                # (unchanged — reference pattern)
    └── ... (other unchanged tool files)

tests/
└── tools/
    ├── graph/                         # NEW directory
    │   ├── registration.test.ts       # NEW: each of 7 tools appears in ALL_TOOLS with derived inputSchema
    │   ├── schema.test.ts             # NEW: zod validation rejects bad inputs (one per tool)
    │   ├── handler-vault-stats.test.ts# NEW: FR-006 deep test (mock GraphService; assert dispatch + payload parsing)
    │   └── smoke.test.ts              # NEW: FR-013 parametrized smoke test for the other six tools
    ├── patch-content/                 # (unchanged)
    └── surgical-reads/                # (unchanged)
```

**Structure Decision**: Single TypeScript project with `src/` + `tests/` mirror, identical to the layout used by features 001 and 003. New code is concentrated in `src/tools/graph/` (matching `src/tools/patch-content/`) and `tests/tools/graph/`. The dispatcher in `src/index.ts` gains seven new `case` branches plus three new imports (one per handler module — or one consolidated `import { handleGraphTool } from './tools/graph/handlers.js'` if a single dispatch table is cleaner). `src/services/graph-service.ts` keeps its current shape; the only behavioural changes there are (a) tracking `lastSkipped` and `lastSkippedPaths` during `buildGraph`, and (b) aligning two existing `throw new Error(...)` messages to the FR-012 wording.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations. This feature follows existing patterns directly — every architectural decision has a precedent in `patch-content` (specs/001) or `surgical-reads` (specs/003). No `Complexity Tracking` entries needed.
