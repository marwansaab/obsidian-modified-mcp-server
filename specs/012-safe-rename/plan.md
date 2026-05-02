# Implementation Plan: Safe Rename Tool (`rename_file`)

**Branch**: `012-safe-rename` | **Date**: 2026-05-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/012-safe-rename/spec.md`

## Summary

Add a single new MCP tool `rename_file(old_path, new_path)` that renames a vault file (markdown note or attachment) by composing the existing `ObsidianRestService.executeCommand` service with `ObsidianRestService.openFile`, so that Obsidian's built-in "Rename file" command runs against the intended file and — when the user has enabled "Automatically update internal links" — Obsidian rewrites every `[[wikilink]]` and `![[embed]]` in the same operation. The tool adds zero file-content parsing or link-rewriting logic of its own (per spec SC-005 and the Q1/Q2/Q3 clarifications): on conflict, missing source, missing parent folder, locked file, or any non-success upstream response, the underlying error from the Obsidian REST API is propagated verbatim. Folder paths are explicitly rejected (Q2). The tool's MCP `description` field carries the precondition about the "Automatically update internal links" setting verbatim (User Story 3 / FR-005), so MCP clients can discover it without reading source.

The tool follows the established `src/tools/<name>/{schema,tool,handler}.ts` module pattern and is registered through the existing dispatcher in [src/index.ts](../../src/index.ts). Composition happens at the **service** layer (`rest.executeCommand`) rather than the legacy MCP `execute_command` tool layer, because the legacy tool wraps individual command failures into success text — that wrapping would break Principle IV's prohibition on swallowing upstream errors.

## Technical Context

**Language/Version**: TypeScript, compiled via `tsc --noEmit` and bundled via `tsup` (existing toolchain; no version bump).
**Primary Dependencies**: `@modelcontextprotocol/sdk` (transport, `Tool[]` registration), `zod` (boundary validation, single source of truth for `inputSchema`), `zod-to-json-schema` (derives MCP JSON Schema from the zod schema), `axios` via the existing `ObsidianRestService` client.
**Storage**: N/A. The tool delegates entirely to Obsidian's REST API; no local persistence.
**Testing**: `vitest` (per [vitest.config.ts](../../vitest.config.ts)). Unit-style tests in `tests/tools/rename-file/` covering registration (description carries the precondition substring), happy-path dispatch (mocked `ObsidianRestService` records `openFile` then `executeCommand`), and failure-path propagation (upstream throw → MCP error).
**Target Platform**: Cross-platform Node.js process consumed as an MCP server by Claude Desktop / Claude Code / other MCP clients (per existing [README.md](../../README.md)).
**Project Type**: TypeScript module library exposing a set of MCP tools.
**Performance Goals**: One additional REST round-trip beyond the existing `openFile` call (so two REST calls per `rename_file` invocation). Latency dominated by Obsidian's own rename + link-rewrite work; no perf budget set by this feature.
**Constraints**:
- Must add zero new runtime dependencies (Constitution: "new runtime dependencies MUST be justified").
- Must lint/typecheck/build clean (Quality Gates 1–3).
- Must include at least one happy-path and one failure-path test (Principle II, NON-NEGOTIABLE).
- Must validate inputs at the boundary via a single zod schema reused for `inputSchema` (Principle III).
- Must propagate upstream errors verbatim, no swallowing or fallback values (Principle IV; reinforced by Q1's pure-delegation choice).
- Must NOT introduce file-content parsing or link-rewriting code (SC-005).

**Scale/Scope**:
- 1 new tool registration (joins ~30+ existing tools).
- 3 new source files (~120 LOC total): `schema.ts`, `tool.ts`, `handler.ts`.
- 2 new test files (~80 LOC total): `registration.test.ts`, `handler.test.ts`.
- 4 new spec artifacts: this plan, `research.md`, `data-model.md`, `contracts/rename_file.md`, `quickstart.md`.
- 1 dispatcher hook in [src/index.ts](../../src/index.ts) (one new `case 'rename_file'` branch, ~3 lines) and 1 aggregation entry in [src/tools/index.ts](../../src/tools/index.ts).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution version: **1.0.0** ([.specify/memory/constitution.md](../../.specify/memory/constitution.md)).

| # | Principle | Status | How this plan satisfies it |
|---|---|---|---|
| I | Modular Code Organization | **PASS** | New code lives in its own module `src/tools/rename-file/` (schema/tool/handler split mirrors `list-tags`, `delete-file`, `patch-content`). Imports flow tool → service → external SDK only; no upward or cyclic deps. The module has one responsibility (compose a rename via REST). |
| II | Public Tool Test Coverage (NON-NEGOTIABLE) | **PASS** (by design) | `tests/tools/rename-file/handler.test.ts` will include at least one happy-path test (mocked `rest.executeCommand` resolves; tool returns `{old_path, new_path}` echo) and at least one failure-path test (mocked `rest.executeCommand` throws an `ObsidianApiError`; tool propagates it). `registration.test.ts` pins the precondition substring in the tool's `description` (User Story 3). Tests live next to the source under the parallel `tests/tools/<name>/` path. |
| III | Boundary Input Validation with Zod | **PASS** (by design) | A single `RenameFileRequestSchema` in `schema.ts` validates `old_path: z.string().min(1)`, `new_path: z.string().min(1)`, optional `vaultId`. The same schema is fed through `zod-to-json-schema` to produce the MCP `inputSchema` (matches the `list-tags` pattern). Inner functions receive already-typed `RenameFileRequest`. No hand-rolled `typeof`/`instanceof` validation. |
| IV | Explicit Upstream Error Propagation | **PASS** (by design) | Handler does NOT wrap `rest.executeCommand` in a try/catch that swallows the error. Typed `ObsidianApiError`/`ObsidianTimeoutError`/`ObsidianNotFoundError` from `safeCall` propagate to the dispatcher's outer try/catch in `src/index.ts`, which converts them into the MCP `{content, isError: true}` shape. The Q1 clarification (pure delegation) makes this the *contractual* behaviour, not just an implementation detail. The only locally-caught exception is `z.ZodError` from boundary validation, which is rethrown as a plain `Error` with the field path inlined (matches the `list-tags` pattern). |

**Stack constraints**:

- TypeScript, `tsc --noEmit` clean: **PASS by design** (no `any`; `unknown` only inside the zod boundary).
- `zod` is the only validation lib: **PASS** (sole boundary validator).
- `@modelcontextprotocol/sdk`: **PASS** (registration through existing `Tool[]` aggregation; dispatcher uses `CallToolRequest`).
- `eslint` + `prettier`: **PASS by design** (matches existing module conventions verbatim).
- No new runtime dependencies: **PASS** (uses only `zod`, `zod-to-json-schema`, and the SDK — all already direct deps).

**Quality Gates 1–4** (lint, typecheck, build, tests): all addressed structurally; verification happens at PR time.

**Conclusion**: All four principles satisfied; no Complexity Tracking entry required.

## Project Structure

### Documentation (this feature)

```text
specs/012-safe-rename/
├── plan.md                       # This file (/speckit-plan output)
├── research.md                   # Phase 0 output (this run)
├── data-model.md                 # Phase 1 output (this run)
├── contracts/
│   └── rename_file.md            # Phase 1 output: tool input/output contract
├── quickstart.md                 # Phase 1 output: manual verification recipe
├── checklists/
│   └── requirements.md           # From /speckit-specify
├── spec.md                       # From /speckit-specify + /speckit-clarify
└── tasks.md                      # NOT created here; produced by /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── index.ts                      # +1 dispatcher branch: case 'rename_file' → handleRenameFile(args, rest)
├── tools/
│   ├── index.ts                  # +1 aggregation entry: ...RENAME_FILE_TOOLS
│   └── rename-file/              # NEW MODULE
│       ├── schema.ts             # zod RenameFileRequestSchema + assertValidRenameFileRequest
│       ├── tool.ts               # MCP Tool[] registration (description carries the FR-005 precondition)
│       └── handler.ts            # handleRenameFile(args, rest): validate → openFile → executeCommand → echo
└── services/
    └── obsidian-rest.ts          # UNCHANGED; the tool composes existing openFile + executeCommand methods

tests/
└── tools/
    └── rename-file/              # NEW
        ├── registration.test.ts  # Pin: description includes the precondition substring (User Story 3)
        └── handler.test.ts       # Happy path + failure-path propagation + folder-rejection (Q2 / FR-001a)
```

**Structure Decision**: Single-project TypeScript layout (Option 1 from the template), already established. The new module slots into the existing `src/tools/<name>/` convention used by `list-tags`, `delete-file`, `patch-content`, `surgical-reads`, etc. No new top-level directories. Composition happens at the service layer (`ObsidianRestService.executeCommand` + `ObsidianRestService.openFile`), not via the legacy MCP `execute_command` tool, because that tool currently swallows per-command errors into success text (see [src/index.ts:455-470](../../src/index.ts#L455-L470)) and would defeat the Q1 pure-delegation contract.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*N/A — no violations.* All four principles pass by design and the stack constraints are honoured by following the established module pattern. No table entries required.

## Phase 0 — Outline & Research

See [research.md](./research.md). Open items (resolved or scoped to implementation-time spike):

1. **Exact Obsidian command id for "Rename file"** — resolved as a spike at implementation time (per spec Assumption: "verifying the exact id is an implementation-time concern, not a spec-time one"). Spike procedure documented in research.md.
2. **Whether `POST /commands/{commandId}/` against the rename command actually performs a programmatic rename** vs. opens a UI modal — flagged as a **feasibility-verification spike**. The spec asserts the mechanism works; the spike confirms before substantial code is written. Mitigation paths documented if feasibility fails.
3. **Active-file requirement** — confirmed: Obsidian commands operate on the active editor, so the tool must call `rest.openFile(old_path)` before dispatching the rename command. Documented in research.md as a derived requirement, not a NEEDS CLARIFICATION.
4. **Folder-vs-file detection** for FR-001a (Q2 rejection of folder paths) — resolved by checking the existing `listFilesInDir` / `listFilesInVault` semantics; deferred to handler-internal check or to delegation if Obsidian's command itself rejects folder paths.
5. **`vaultId` parameter convention** — resolved by mirroring `list-tags` and other recent tools (optional `vaultId` for multi-vault setups).

## Phase 1 — Design & Contracts

Outputs:

- [data-model.md](./data-model.md) — entities (vault file, wikilink reference, Obsidian command) and the request/response shapes. Promotes the spec's Key Entities into the implementation-facing types.
- [contracts/rename_file.md](./contracts/rename_file.md) — the authoritative MCP tool contract: zod schema, `inputSchema`, response shape on success, error shape on failure, mapping from FRs to schema fields.
- [quickstart.md](./quickstart.md) — manual end-to-end verification recipe: set up vault state, run the spike, run the tool, assert link rewriting.
- Agent context update: `CLAUDE.md` SPECKIT marker is repointed at this `plan.md` so the next conversation discovers the active feature.

Re-evaluation of Constitution Check after Phase 1: **still PASS**. The contracts confirm a zod-only validation surface (Principle III), tests are scoped per registered tool (Principle II), the module remains single-purpose (Principle I), and the contract documents that errors propagate as the MCP-error shape produced by the dispatcher (Principle IV).

**Plan ends here.** Phase 2 (`tasks.md`) is produced by the next command, `/speckit-tasks`.
