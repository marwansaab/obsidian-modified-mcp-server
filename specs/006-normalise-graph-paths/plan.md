# Implementation Plan: Normalise Path Separators for Graph Tools

**Branch**: `006-normalise-graph-paths` | **Date**: 2026-04-27 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/006-normalise-graph-paths/spec.md`

## Summary

Three MCP tools that take a filepath argument — `get_note_connections`, `find_path_between_notes`, `find_similar_notes` — currently reject forward-slash separators on Windows even though every other tool on the wrapper accepts them. The cause differs per tool, but a single shared normalisation utility resolves all three.

For `get_note_connections` and `find_path_between_notes`, the lookups go through [src/services/graph-service.ts](../../src/services/graph-service.ts) into a `graphology` index whose node keys are produced by `path.relative(this.vaultPath, filePath)` ([graph-service.ts:80](../../src/services/graph-service.ts#L80)) — i.e., **OS-native** separators. The handlers in [src/tools/graph/handlers.ts](../../src/tools/graph/handlers.ts) call `service.hasNode(filepath)` directly with the caller's input, so on Windows a forward-slash input fails the `hasNode` check even when the file exists. The fix: normalise the caller's filepath to OS-native at the handler boundary before delegating to the service.

For `find_similar_notes`, the picture is different in two ways: (a) the dispatcher in [src/index.ts](../../src/index.ts) has **no `case 'find_similar_notes'`** — calling the tool today returns `Unknown tool: find_similar_notes`, which is why the spec author could not reproduce the bug; (b) the tool delegates to [SmartConnectionsService.findSimilar](../../src/services/smart-connections.ts#L125) which is an HTTP POST to the Smart Connections plugin's `/search/similar` endpoint, not an in-process index lookup. Obsidian's surface is forward-slash-canonical, so this handler normalises **toward forward-slash** (the wrapper's published input contract) rather than OS-native. The dispatcher case must also be wired before the normalisation matters.

The implementation surface is small: one new helper module ([src/utils/path-normalisation.ts](../../src/utils/path-normalisation.ts)) exporting two named functions (`toOsNativePath`, `toForwardSlashPath`) plus an `isAbsolutePath` guard; minimal handler edits in [src/tools/graph/handlers.ts](../../src/tools/graph/handlers.ts) for the two index-backed tools; a new dispatcher case in [src/index.ts](../../src/index.ts) for `find_similar_notes` that applies forward-slash normalisation; and a regression test exercising both separator forms against at least one tool (per FR-008). [GraphService](../../src/services/graph-service.ts) is intentionally left unchanged — separator handling is a wrapper-boundary concern, not a service concern.

## Technical Context

**Language/Version**: TypeScript 5.6.x (strict mode, ES modules), compiled with `tsc --noEmit` clean and bundled with `tsup`
**Primary Dependencies**: `@modelcontextprotocol/sdk` ^1.12.0 (MCP transport), `graphology` ^0.25.4 (in-process directed graph index keyed by relative path), `axios` ^1.7.7 (HTTP to Smart Connections plugin), `zod` ^3.23.8 (boundary input validation per Constitution Principle III), `zod-to-json-schema` 3.25.2 (JSON Schema derivation for the published MCP tool contract). Path separator helpers come from Node's built-in `node:path` (`sep`); no new runtime dependencies.
**Storage**: No new storage. The graph index is rebuilt in-memory on TTL expiry from the on-disk vault — its key format (`path.relative()` output) is the contract the normalisation helper must match. No persistence change.
**Testing**: `vitest` 4.1.5 (unit + integration), `nock` 14.0.13 for HTTP mocking — the established pattern (used by features 001, 003, 004, 005). The graph handler tests already use a small in-memory fixture ([tests/tools/graph/handler-per-note.test.ts](../../tests/tools/graph/handler-per-note.test.ts)) which extends naturally to cover the separator regression.
**Target Platform**: Node.js >= 18 (per `package.json` `engines`); cross-platform (Windows, macOS, Linux). The bug only manifests on Windows because that is the only platform where `path.sep === '\\'`. The fix MUST be a no-op on POSIX for forward-slash input and MUST NOT crash on backslash input on POSIX (per spec edge cases).
**Project Type**: Library / MCP server (single TypeScript project, `src/` + `tests/` mirror). No frontend, no separate API layer.
**Performance Goals**: Out of scope. Path normalisation is an O(n) string transform on input length only, called once per tool invocation. No measurable impact on the existing TTL-based graph rebuild cycle.
**Constraints**: Constitution Principles I–IV apply. The wrapper's published forward-slash input contract is preserved (FR-007). The graph index's internal key format is unchanged (no rebuild). All existing backslash-form callers continue to work (FR-004). Mixed-separator inputs resolve to the same indexed entry as the canonical form (FR-005).
**Scale/Scope**: Three tool handlers touched, one new helper module (~30 LOC) with its own test file, plus regression tests added under existing `tests/tools/graph/` and a new `tests/tools/semantic-tools/`. No constitution-relevant cross-cutting changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution defines four normative principles ([.specify/memory/constitution.md](../../.specify/memory/constitution.md)). Each is evaluated against this feature:

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Modular Code Organization** | ✅ PASS | The normalisation helpers land in their own module (`src/utils/path-normalisation.ts`) with a narrow, typed interface. Cross-module imports flow `tool handler → utils` (downward), no upward or cyclic deps. Graph handlers gain a single `import` line and one normalisation call each — no logic leaks elsewhere. `GraphService` is untouched, preserving the service's "oblivious to separator concerns" responsibility. The new dispatcher case for `find_similar_notes` follows the same per-tool dispatch pattern already used for `delete_file`, `patch_content`, etc., and does not introduce a new abstraction. |
| **II. Public Tool Test Coverage (NON-NEGOTIABLE)** | ✅ PASS by design | The three affected tools — `get_note_connections`, `find_path_between_notes`, `find_similar_notes` — are each registered MCP tools. The plan's Phase 1 contract requires: (a) extending [tests/tools/graph/handler-per-note.test.ts](../../tests/tools/graph/handler-per-note.test.ts) with separator regression cases that exercise both forward-slash and backslash inputs and assert equivalent results (FR-008); (b) a new `tests/tools/semantic-tools/registration.test.ts` and `tests/tools/semantic-tools/find-similar-handler.test.ts` covering the newly-wired `find_similar_notes` case (happy path with both separator forms, validation failure on missing filepath, upstream-error path via `nock`). Both branches of Principle II ("happy path AND validation/upstream-error path") are exercised for every changed tool. The new helper module gets its own unit tests (`tests/utils/path-normalisation.test.ts`). |
| **III. Boundary Input Validation with Zod** | ✅ PASS | The graph tools' existing zod schemas in [src/tools/graph/schemas.ts](../../src/tools/graph/schemas.ts) are sufficient (`filepath`, `source`, `target` already constrained to non-empty strings). Normalisation runs *after* zod parse and *before* service delegation — it operates on the validated, typed string, not on raw `unknown`. No `typeof` / `instanceof` chains introduced. For `find_similar_notes`, the dispatcher case adds zod-schema-based validation matching the pattern used by other tools — replacing the existing hand-written JSON schema in [src/tools/semantic-tools.ts](../../src/tools/semantic-tools.ts) with a derived `inputSchema` from a new `FindSimilarNotesRequestSchema`. |
| **IV. Explicit Upstream Error Propagation** | ✅ PASS | Normalisation is a pure string transform — it cannot itself fail. After normalisation, `service.hasNode(...)` returning false continues to throw the existing structured `note not found: <path>` error (preserved verbatim), which already satisfies Principle IV. Genuinely missing files still surface as a structured error (FR-006). For `find_similar_notes`, the existing `SmartConnectionsService.findSimilar` already maps upstream 404 / 503 / network errors to clear MCP-level error messages — the dispatcher case wraps these via the existing `safeCall`-style try/catch already used by the other dispatcher cases. No silent fallbacks introduced. |

**Test runner**: `vitest@4.1.5` is configured and exercised by features 001/003/004/005. No setup work needed.

**Gate result**: No constitution violations. No `Complexity Tracking` entries needed. Re-evaluated post-Phase-1 design (below) — still no violations.

## Project Structure

### Documentation (this feature)

```text
specs/006-normalise-graph-paths/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output: separator semantics + dispatcher-gap discovery
├── data-model.md        # Phase 1 output: helper signatures + per-tool normalisation target
├── quickstart.md        # Phase 1 output: how to verify the fix manually + via tests
├── contracts/           # Phase 1 output: per-tool I/O contract for the three affected tools
│   ├── get_note_connections.md
│   ├── find_path_between_notes.md
│   └── find_similar_notes.md
├── checklists/
│   └── requirements.md  # From /speckit-specify
├── spec.md              # From /speckit-specify (no /speckit-clarify run — none needed)
└── tasks.md             # Phase 2 output (NOT created here — see /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── config.ts                                # (unchanged)
├── index.ts                                 # MODIFIED: add `case 'find_similar_notes'` (currently missing — falls through to "Unknown tool"); the case validates args via FindSimilarNotesRequestSchema, normalises filepath via toForwardSlashPath, then delegates to SmartConnectionsService.findSimilar
├── types.ts                                 # (unchanged)
├── utils/                                   # NEW directory
│   └── path-normalisation.ts                # NEW: toOsNativePath(p), toForwardSlashPath(p), isAbsolutePath(p) — pure string helpers, no I/O, no platform branching beyond reading path.sep
├── services/
│   ├── graph-service.ts                     # (unchanged — separator handling stays a wrapper-boundary concern)
│   ├── smart-connections.ts                 # (unchanged — passthrough endpoint accepts whatever path the caller sends; canonical form is the wrapper's responsibility)
│   ├── obsidian-rest.ts                     # (unchanged)
│   └── obsidian-rest-errors.ts              # (unchanged)
└── tools/
    ├── graph/
    │   ├── handlers.ts                      # MODIFIED: handleGetNoteConnections — toOsNativePath(req.filepath) before service call; handleFindPathBetweenNotes — toOsNativePath on req.source AND req.target before service call
    │   ├── schemas.ts                       # (unchanged — filepath/source/target schemas already correct)
    │   └── tool.ts                          # (unchanged)
    ├── semantic-tools.ts                    # MODIFIED: replace hand-written `find_similar_notes` JSON schema with zodToJsonSchema-derived schema from a new FindSimilarNotesRequestSchema; export the new schema + assertValidFindSimilarNotesRequest helper. (The existing `semantic_search` tool — which is also unwired in the dispatcher — is OUT OF SCOPE for this feature; documented as a separate latent issue in research.md R5.)
    └── ... (other unchanged tool files)

tests/
├── utils/                                   # NEW directory
│   └── path-normalisation.test.ts           # NEW: unit tests for toOsNativePath / toForwardSlashPath / isAbsolutePath covering: forward-slash input, backslash input, mixed-separator input, leading/trailing separators, empty string, top-level filename (no separator), platform-correct output via os.platform() mocking or sep-aware assertions
├── tools/
│   ├── graph/
│   │   └── handler-per-note.test.ts         # MODIFIED: extend the existing per-note handler test with separator regression cases — for both get_note_connections and find_path_between_notes, verify forward-slash and backslash inputs return equivalent results, and verify mixed-separator inputs also resolve. Includes the FR-008 mandatory regression test.
│   ├── semantic-tools/                      # NEW directory
│   │   ├── registration.test.ts             # NEW: assert find_similar_notes appears in ALL_TOOLS exactly once with the derived inputSchema
│   │   ├── schema.test.ts                   # NEW: zod rejects empty/missing filepath; happy parse for valid input including optional limit/threshold/vaultId
│   │   └── find-similar-handler.test.ts     # NEW: dispatch path covers (a) happy path with forward-slash input — assert request POSTed to /search/similar with forward-slash path; (b) happy path with backslash input — assert POSTed path was normalised to forward-slash; (c) Smart Connections not configured → clear error; (d) upstream 404 → clear error
│   └── ... (other unchanged test directories)
```

**Structure Decision**: Single TypeScript project with `src/` + `tests/` mirror, identical to the layout used by features 001, 003, 004, and 005. New code is concentrated in two new files (`src/utils/path-normalisation.ts` + its test) plus the new `tests/tools/semantic-tools/` directory; all other touchpoints are minimal edits to existing files. The `src/utils/` directory is new but follows the standard convention for cross-tool helpers (the codebase had no shared utility module before because no shared utility was needed; this feature is the first to introduce one). The `find_similar_notes` dispatcher wiring is a discovered latent fix bundled in because FR-003 cannot be testably satisfied without it (see research.md R5).

## Phase 0 — Outline & Research

See [research.md](research.md) for full Decision / Rationale / Alternatives entries. Summary of the five research questions resolved:

- **R1 — Normalisation target per tool**: For `get_note_connections` and `find_path_between_notes`, normalise to **OS-native** (matches `path.relative()` output that keys the graph index). For `find_similar_notes`, normalise to **forward-slash** (matches Obsidian's canonical surface and the wrapper's published input contract; Smart Connections is an HTTP passthrough, not a local index lookup). One helper module exports both functions; each handler picks the right one for its downstream contract.
- **R2 — Where to apply normalisation**: At the handler boundary (in [src/tools/graph/handlers.ts](../../src/tools/graph/handlers.ts) for the two graph tools and in the new dispatcher case in [src/index.ts](../../src/index.ts) for `find_similar_notes`), not inside `GraphService` or `SmartConnectionsService`. This preserves separator-obliviousness as a *service-layer* invariant — the wrapper's input contract is enforced at the wrapper boundary only. Matches the spec's prescribed resolution location.
- **R3 — Mixed-separator handling**: A single global `replace(/[\\/]/g, target)` in each helper handles forward-slash, backslash, and mixed forms uniformly. No special cases for leading/trailing separators — `path.relative()` already strips trailing separators, and a leading separator on a vault-relative path is malformed anyway (graph nodes are stored without leading separators). The normalisation is purely a separator transform; other path-canonicalisation concerns (case, Unicode) remain out of scope (spec Assumptions).
- **R4 — Error message form**: When `service.hasNode(<normalised>)` returns false, the existing service throws `note not found: ${filepath}` using the *normalised* form. For Story 1 acceptance scenario 3 ("genuinely missing file") the caller sees the normalised form in the error message — on Windows that means a backslash form even if they sent forward-slash. This is acceptable per FR-006 ("identifying the offending path"); the path is still recognisable, and pursuing form-preserving error decoration is a separate UX improvement out of scope here. No spec FR mandates form preservation in the error message.
- **R5 — Dispatcher gap for `find_similar_notes`**: The tool is registered in [src/tools/semantic-tools.ts](../../src/tools/semantic-tools.ts) and exported via `ALL_TOOLS` ([src/tools/index.ts:28](../../src/tools/index.ts#L28)) but has no `case` in the dispatcher in [src/index.ts](../../src/index.ts) — calls to it currently throw `Unknown tool: find_similar_notes`, which is why the spec author could not reproduce the separator bug independent of Smart Connections being absent. Wiring the dispatcher case is a prerequisite for FR-003 to be testable; bundling it into this feature keeps the spec's three-tool surface coherent. The sibling tool `semantic_search` is also unwired in the dispatcher — that is a separate latent issue not in scope here (it does not take a `filepath` argument and is unrelated to separator normalisation).

## Phase 1 — Design & Contracts

### Data model

See [data-model.md](data-model.md). Summary of entities introduced by this feature:

- **`PathNormaliser`** (module, not a class) — exports two pure string functions and one boolean predicate:
  - `toOsNativePath(p: string): string` — replaces all `/` and `\` in `p` with `path.sep`. Idempotent. Used by the two graph handlers.
  - `toForwardSlashPath(p: string): string` — replaces all `/` and `\` in `p` with `/`. Idempotent. Used by the `find_similar_notes` dispatcher case.
  - `isAbsolutePath(p: string): boolean` — defensive check used by tests to validate the helpers do not turn relative paths into absolute ones (a separator change can never affect absoluteness, but the predicate documents the invariant).
- **`FindSimilarNotesRequest`** (zod) — the validated input shape: `{ filepath: string; limit?: number; threshold?: number; vaultId?: string }` with `filepath` constrained to a non-empty trimmed string. Replaces the hand-written JSON schema in `semantic-tools.ts` to comply with Constitution Principle III for the newly-wired tool.

No changes to existing entities. `NoteConnections` (returned by `get_note_connections`) is unchanged — the path stored in `filepath` of the response continues to be the OS-native graph node ID (the lookup key), preserving the current contract.

### Contracts

Per-tool I/O contracts in [contracts/](contracts/):

- [contracts/get_note_connections.md](contracts/get_note_connections.md) — input contract gains a "separator-tolerant" clause; output contract unchanged. Documents that the response's `filepath` field reflects the resolved graph node ID (OS-native), not the caller's input form.
- [contracts/find_path_between_notes.md](contracts/find_path_between_notes.md) — same separator-tolerant clause for both `source` and `target`; the response's `path` array of node IDs is in the same OS-native form as today.
- [contracts/find_similar_notes.md](contracts/find_similar_notes.md) — input contract is forward-slash-canonical; the wrapper normalises any backslashes the caller sends before dispatching to Smart Connections. Output contract is the existing Smart Connections payload, untouched.

### Quickstart

See [quickstart.md](quickstart.md). Three verification flows:

1. Manual smoke test against a real Obsidian vault using the bug report's reproduction steps: call `get_note_connections` with forward-slash and backslash forms of a nested file path; both return the same connections payload.
2. Automated test commands: `npm run test -- tests/utils tests/tools/graph tests/tools/semantic-tools`. Each block lists what it asserts.
3. Manual MCP `tools/list` verification: `find_similar_notes` is now callable (no longer "Unknown tool"); its `inputSchema` is the zod-derived form.

### Agent context update

The plan reference between the `<!-- SPECKIT START -->` / `<!-- SPECKIT END -->` markers in [CLAUDE.md](../../CLAUDE.md) is updated to point at this plan file (`specs/006-normalise-graph-paths/plan.md`) rather than the 005 plan.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations. The feature follows the established conventions:

- New helper module under `src/utils/` is the smallest possible unit for a cross-tool string transform; smaller than a class, exposes only pure functions. Modular Code Organization (Principle I) is satisfied.
- Wiring `find_similar_notes` in the dispatcher is a known-good pattern from the seven existing graph tool cases and the four delete/patch/surgical-read cases. No new abstraction.
- The hand-written JSON schema in `semantic-tools.ts` is replaced with a zod-derived one — bringing the newly-wired tool into compliance with Principle III, exactly as feature 004 and feature 005 did for their respective tools when they wired them.

No `Complexity Tracking` entries needed.
