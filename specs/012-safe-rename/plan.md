# Implementation Plan: Safe Rename Tool (`rename_file`) — Option B

**Branch**: `012-safe-rename` | **Date**: 2026-05-02 (Option B pivot) | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/012-safe-rename/spec.md`
**Status**: Documentation pivot complete; implementation gated on Tier 2 backlog item 25 (`find_and_replace`) shipping first.

## Summary

`rename_file(old_path, new_path)` is a thin wrapper-side composition over five service-layer REST primitives: `rest.getFileContents` (×2 — pre-flight source + pre-flight destination), `rest.listFilesInDir` (pre-flight parent), `rest.putContent` (write destination), `rest.findAndReplace` (×N passes — vault-wide wikilink rewrite, provided by Tier 2 backlog item 25), and `rest.deleteFile` (delete source). The 2026-05-02 T002 feasibility spike empirically established that Obsidian's stock command-palette commands (`workspace:edit-file-title`, `file-explorer:move-file`) cannot perform programmatic renames when dispatched headlessly via `POST /commands/{commandId}/` — they open UI inputs and silently no-op. The original Option-A design (composition over `rest.openFile` + `rest.executeCommand`) is therefore infeasible against stock Obsidian + the current Local REST API plugin, and this plan implements **Option B** instead.

The eight algorithm steps (`pre_flight_source`, `pre_flight_destination`, `pre_flight_parent`, `read_source`, `write_destination`, `find_and_replace_pass_A` / `_B` / `_C` / `_D`, `delete_source`) are documented in [contracts/rename_file.md §"Composition algorithm"](./contracts/rename_file.md). Pre-flight failures (steps 1–3) are clean — vault unchanged. Mid-flight failures (steps 4–8) leave a partial state that the structured response identifies via `failedAtStep` and `partialState`; the caller's git-clean precondition is the rollback baseline. Q1's pure-delegation contract from the original Clarifications session still applies to FR-007 / FR-012 (upstream 404 propagation) but is explicitly superseded for FR-006 (collision check is now wrapper-side because `putContent`'s default semantic is overwrite). SC-005 is rewritten to forbid markdown-AST parsing rather than all file-content reads — `getFileContents` is allowed for the legitimate purpose of moving content; the wrapper's regex pattern construction is allowed because the regexes are passed as opaque strings to `find_and_replace`, which owns the actual matching.

The wrapper is registered at `src/tools/rename-file/` following the established `{schema, tool, handler}.ts` module pattern, with a sibling `regex-passes.ts` module exporting the four pass-builder functions (`buildPassA(oldBasename)` etc.) plus the `escapeRegex` utility — these are spike-independent and can ship before the handler. Tests live in `tests/tools/rename-file/`, with hermetic regex-pass tests (`regex-passes.test.ts`) validating each pass's correctness against synthetic strings, and handler tests (`handler.test.ts`) validating the composition flow against a mocked `ObsidianRestService`. Manual end-to-end verification against TestVault is captured in [quickstart.md](./quickstart.md) Part 2.

**Implementation order constraint** (FR-013): Tier 2 backlog item 25 (`find_and_replace`) MUST ship and merge to `main` before this feature's handler can be implemented. The handler imports `rest.findAndReplace` as a static module dependency — there is no runtime feature-detection. The documentation pivot, the regex-passes module, and the registration tests are spike-independent and can land in this branch now; the handler, dispatcher wiring, and `ALL_TOOLS` re-wiring wait for item 25.

## Technical Context

**Language/Version**: TypeScript, compiled via `tsc --noEmit` and bundled via `tsup` (existing toolchain; no version bump).
**Primary Dependencies**: `@modelcontextprotocol/sdk` (transport, `Tool[]` registration), `zod` (boundary validation, single source of truth for `inputSchema`), `zod-to-json-schema` (derives MCP JSON Schema from the zod schema), `axios` via the existing `ObsidianRestService` client. **Build-time dependency** on Tier 2 backlog item 25's `rest.findAndReplace` helper (FR-013).
**Storage**: N/A. The tool delegates entirely to Obsidian's REST API; no local persistence.
**Testing**: `vitest` (per [vitest.config.ts](../../vitest.config.ts)). Tests in `tests/tools/rename-file/`: `registration.test.ts` (description substrings + `RENAME_FILE_TOOLS` shape), `regex-passes.test.ts` (hermetic regex correctness for Passes A–D against synthetic strings), `handler.test.ts` (composition flow against mocked `ObsidianRestService`).
**Target Platform**: Cross-platform Node.js process consumed as an MCP server by Claude Desktop / Claude Code / other MCP clients (per existing [README.md](../../README.md)).
**Project Type**: TypeScript module library exposing a set of MCP tools.
**Performance Goals**: Up to nine REST round-trips per `rename_file` invocation in the cross-folder case (3 pre-flight + 1 read + 1 write + 4 `find_and_replace` passes + 1 delete), or eight in the same-folder case (Pass D skipped). Latency dominated by the `find_and_replace` passes, each of which scans the vault. No perf budget set by this feature.
**Constraints**:
- Must add zero new runtime dependencies (Constitution: "new runtime dependencies MUST be justified"). The `rest.findAndReplace` dependency is intra-repo (item 25 ships in this same project); no external library is added.
- Must lint/typecheck/build clean (Quality Gates 1–3).
- Must include ≥1 happy-path test and ≥1 failure-path test for the registered tool (Principle II, NON-NEGOTIABLE). The regex-passes tests are an additional structural correctness gate.
- Must validate inputs at the boundary via a single zod schema reused for `inputSchema` (Principle III).
- Must propagate upstream errors verbatim, no swallowing or fallback values (Principle IV; the wrapper-constructed FR-006 collision error is the single explicit Q1 supersession, justified in spec Clarifications).
- Must NOT introduce markdown-AST parsing or link-graph construction (SC-005, narrowed for Option B).

**Scale/Scope**:
- 1 new tool registration (joins ~30+ existing tools).
- 4 new source files (~200–250 LOC total): `schema.ts`, `tool.ts`, `regex-passes.ts`, `handler.ts`. Schema and tool are already shipped (commit `bebe709`); regex-passes ships in this Option-B documentation-pivot commit; handler ships once item 25 merges.
- 3 new test files (~250 LOC total): `registration.test.ts` (already shipped, description substrings updated in this commit), `regex-passes.test.ts` (ships in this commit), `handler.test.ts` (ships with the handler).
- 5 new spec artifacts: this plan, `research.md`, `data-model.md`, `contracts/rename_file.md`, `quickstart.md` (all updated in this commit).
- 1 dispatcher hook in [src/index.ts](../../src/index.ts) (one new `case 'rename_file'` branch, ~3 lines) — DEFERRED until item 25 ships and the handler can be wired.
- 1 aggregation entry in [src/tools/index.ts](../../src/tools/index.ts) — IMPORTED in this commit, but `...RENAME_FILE_TOOLS` is removed from the `ALL_TOOLS` array per the "no false advertisement" principle. Restored when item 25 ships and the handler is in.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution version: **1.0.0** ([.specify/memory/constitution.md](../../.specify/memory/constitution.md)).

| # | Principle | Status | How this plan satisfies it |
|---|---|---|---|
| I | Modular Code Organization | **PASS** | New code lives in its own module `src/tools/rename-file/` (schema/tool/regex-passes/handler split mirrors `list-tags`, `delete-file`, `patch-content`, with the additional `regex-passes.ts` separating the regex-construction logic from the composition logic). Imports flow tool → service → external SDK only; no upward or cyclic deps. The module has one responsibility (compose a rename via REST primitives + `find_and_replace`). |
| II | Public Tool Test Coverage (NON-NEGOTIABLE) | **PASS** (by design) | `tests/tools/rename-file/handler.test.ts` will include at least one happy-path test (mocked `rest` records all five REST methods called in algorithm order; tool returns `{ok: true, oldPath, newPath, wikilinkPassesRun, wikilinkRewriteCounts}`) and at least one failure-path test (mocked `rest.findAndReplace` rejects mid-flight; tool returns `{ok: false, failedAtStep: "find_and_replace_pass_B", partialState: {...}}` AND propagates the error). `registration.test.ts` pins the four description substrings (User Story 3 — non-atomic, git-clean, shape coverage, setting-irrelevance). `regex-passes.test.ts` pins each of Passes A–D against synthetic strings, including code-block-skipping behaviour (delegated to `find_and_replace`'s own `skipCodeBlocks: true` flag, so the pass test focuses on regex correctness only). Tests live next to the source under the parallel `tests/tools/<name>/` path. |
| III | Boundary Input Validation with Zod | **PASS** (by design — unchanged from Option A) | A single `RenameFileRequestSchema` in `schema.ts` validates `old_path: z.string().trim().min(1)`, `new_path: z.string().trim().min(1)`, optional `vaultId`. The same schema is fed through `zod-to-json-schema` to produce the MCP `inputSchema` (matches the `list-tags` pattern). Inner functions receive already-typed `RenameFileRequest`. No hand-rolled `typeof`/`instanceof` validation. **Schema text is identical between Option A and Option B** — only the handler implementation changes. The schema file shipped in commit `bebe709` requires no edit for the Option-B pivot. |
| IV | Explicit Upstream Error Propagation | **PASS** (by design) | Handler does NOT wrap any of the five REST methods in a try/catch that swallows the error. Typed `ObsidianApiError` / `ObsidianTimeoutError` / `ObsidianNotFoundError` from each `safeCall` propagate to the dispatcher's outer try/catch in `src/index.ts`. The single explicit deviation from pure delegation is the FR-006 wrapper-constructed collision error, which is justified in spec Clarifications: `putContent`'s default-overwrite semantic would otherwise silently violate FR-006. The two locally-caught exceptions are: (1) `z.ZodError` from boundary validation, rethrown as a plain `Error` with the field path inlined (matches the [list-tags handler pattern](../../src/tools/list-tags/handler.ts)); (2) the FR-011 mid-flight `failedAtStep` capture, where the handler catches the error from steps 5–8, builds the `{ok: false, failedAtStep, partialState}` response, AND re-throws the original error so the dispatcher still surfaces it to the client (the structured response is for the success-result body; the error remains the actual exception). |

**Stack constraints**:

- TypeScript, `tsc --noEmit` clean: **PASS by design** (no `any`; `unknown` only inside the zod boundary).
- `zod` is the only validation lib: **PASS** (sole boundary validator).
- `@modelcontextprotocol/sdk`: **PASS** (registration through existing `Tool[]` aggregation; dispatcher uses `CallToolRequest`).
- `eslint` + `prettier`: **PASS by design** (matches existing module conventions verbatim).
- No new runtime dependencies: **PASS** (uses only `zod`, `zod-to-json-schema`, the SDK, and the in-repo `ObsidianRestService` — including `rest.findAndReplace` from the same repo's item-25 work).

**Quality Gates 1–4** (lint, typecheck, build, tests): all addressed structurally; verification happens at PR time.

**Conclusion**: All four principles satisfied; no Complexity Tracking entry required.

## Project Structure

### Documentation (this feature)

```text
specs/012-safe-rename/
├── plan.md                       # This file (/speckit-plan output, Option-B revision)
├── research.md                   # Phase 0 output (Option-B revision: spike result + Option-B research items)
├── data-model.md                 # Phase 1 output (Option-B revision)
├── contracts/
│   └── rename_file.md            # Phase 1 output (Option-B revision: composition algorithm)
├── quickstart.md                 # Phase 1 output (Option-B revision: Part 1 = spike result; Part 2 = E2E for Option B)
├── checklists/
│   └── requirements.md           # From /speckit-specify, updated with the Option-B pivot note
├── spec.md                       # From /speckit-specify + /speckit-clarify + /speckit-analyze + Option-B redesign
└── tasks.md                      # From /speckit-tasks, updated with Option-B task structure
```

### Source Code (repository root)

```text
src/
├── index.ts                      # +1 dispatcher branch DEFERRED: case 'rename_file' → handleRenameFile(args, rest)
├── tools/
│   ├── index.ts                  # IMPORTED ✓; ...RENAME_FILE_TOOLS removed from ALL_TOOLS until item 25 ships
│   └── rename-file/              # MODULE
│       ├── schema.ts             # ✓ shipped in bebe709 — UNCHANGED for Option B
│       ├── tool.ts               # ✓ shipped in bebe709 — DESCRIPTION REWRITTEN in this Option-B commit
│       ├── regex-passes.ts       # NEW (this commit) — escapeRegex + buildPassA/B/C/D regex builders; spike-independent
│       └── handler.ts            # DEFERRED — written when item 25's rest.findAndReplace is importable
└── services/
    └── obsidian-rest.ts          # UNCHANGED in this commit; gains rest.findAndReplace when item 25 ships

tests/
└── tools/
    └── rename-file/
        ├── registration.test.ts  # ✓ shipped in bebe709 — PINNED SUBSTRINGS REWRITTEN + decoupled from ALL_TOOLS in this commit
        ├── regex-passes.test.ts  # NEW (this commit) — hermetic tests for each of Passes A–D against synthetic strings
        └── handler.test.ts       # DEFERRED — written with the handler, after item 25 ships
```

**Structure Decision**: Single-project TypeScript layout (Option 1 from the template), already established. The Option-B redesign adds a fourth file to the standard 3-file `{schema, tool, handler}.ts` module pattern: `regex-passes.ts` separates the regex-construction logic from the composition logic so the regex correctness can be pinned by hermetic unit tests in isolation, and the handler becomes a thin glue layer that imports the pass builders + composes them with `rest.findAndReplace`. This split is justified by the volume of regex-correctness assertions FR-014 demands (8 wikilink shapes × 4 passes = a lot of test surface) and by the fact that regex correctness is verifiable without the handler existing — useful while item 25 is in flight. Composition still happens at the service layer (no dispatch through the legacy MCP `execute_command` tool); the rationale from research.md §R1 (Principle IV / error swallowing) carries forward unchanged.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*N/A — no violations.* All four principles pass by design. The single deviation from Q1's pure-delegation contract (FR-006 wrapper-constructed collision error) is documented as an explicit Clarifications-log supersession with stated justification (`putContent` default-overwrite semantic), not a constitution violation.

## Phase 0 — Outline & Research

See [research.md](./research.md). The research items are reorganised for the Option-B pivot:

1. **R1** (composition layer choice — service layer over execute_command tool): partially superseded by the Option-B redesign. The conclusion (compose at service layer) STILL APPLIES under Option B — every REST call goes through `ObsidianRestService` methods, not through any MCP-tool wrapper. The scope of composition has expanded (5 methods now vs. 2 originally) but the layer is the same.
2. **R2–R5** (Obsidian command id, active-file requirement, how `new_path` was conveyed, the spike procedure): **all OBSOLETE under Option B.** R5 is preserved with the spike outcome documented (negative; established Option-A infeasibility against stock Obsidian + current Local REST API plugin). R2–R4 are marked obsolete with pointers to the supersession.
3. **R6** (folder-vs-file detection): MOSTLY VALID under Option B. The conclusion (delegate, don't pre-flight folder-vs-file) holds — `rest.getFileContents(old_path)` will reject a folder path the same way `rest.openFile` would have. Mechanism note updated.
4. **R7** (success response shape): EXPANDED. The Option-B response shape is much richer than Option-A's `{old_path, new_path}` echo — see FR-011 for the full schema (`ok`, paths, `wikilinkPassesRun`, `wikilinkRewriteCounts`, plus failure fields).
5. **R8** (`vaultId` parameter convention): UNCHANGED.
6. **NEW R9** (regex shape coverage rationale): why these 4 passes, what they cover, what they don't.
7. **NEW R10** (`escapeRegex` utility): why required, where to source from.
8. **NEW R11** (atomicity trade-off): why best-effort + git rollback rather than recovery code.
9. **NEW R12** (item 25 dependency / FR-013): why build-time over runtime; why Option (a) over Options (b)/(c) for the cross-tool invocation question.

## Phase 1 — Design & Contracts

Outputs (all updated in the Option-B pivot commit):

- [data-model.md](./data-model.md) — entities (vault file, wikilink reference, composition step, wikilink rewrite pass) and the request/response shapes. Reflects the Option-B richer response and the multi-step composition.
- [contracts/rename_file.md](./contracts/rename_file.md) — the authoritative MCP tool contract: zod schema (unchanged), `inputSchema` (unchanged), composition algorithm (8 steps), success/failure response shapes, FR-mapping table, the four regex-pass templates, and the test-coverage contract.
- [quickstart.md](./quickstart.md) — Part 1 now records the negative spike result and the Option-B decision. Part 2 is the post-implementation manual verification recipe for the Option-B flow.
- Agent context update: [CLAUDE.md](../../CLAUDE.md) SPECKIT marker continues to point at this `plan.md`; no edit needed beyond the previous repointing.

Re-evaluation of Constitution Check after Phase 1: **still PASS**. The Option-B contracts confirm a zod-only validation surface (Principle III), tests are scoped per registered tool plus the additional regex-pass module (Principle II — exceeds minimum), the module remains single-purpose (Principle I — split into 4 files for clarity, all in the same `rename-file/` directory), and the contract documents the FR-006 supersession explicitly so error propagation is auditable (Principle IV).

**Plan ends here.** Phase 2 (`tasks.md`) is updated by the Option-B pivot commit; Phase 3+ (handler implementation) is gated on Tier 2 backlog item 25 shipping.
