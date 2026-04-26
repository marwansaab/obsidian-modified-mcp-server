# Implementation Plan: Re-enable patch_content with Heading-Path Validation

**Branch**: `001-reenable-patch-content` | **Date**: 2026-04-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-reenable-patch-content/spec.md`

## Summary

Re-enable the `patch_content` MCP tool with a structural heading-path
validator at the wrapper boundary. The validator requires `≥ 2` non-empty
`::`-separated segments; bare or otherwise non-conforming heading targets
are rejected before any HTTP call is made, with an actionable error
message. `block` and `frontmatter` target types pass through to the
upstream Local REST API plugin unchanged. The wrapper is a thin call into
the existing service method `ObsidianRestService.patchContent`, which is
already implemented but is currently unreached because the tool
declaration and handler case are commented out.

This is also the **first feature in this repository** to introduce two
project-level pieces of infrastructure that the constitution requires for
all future tool work: zod-based input validation at the wrapper boundary
(Principle III) and an automated test suite for public tools (Principle
II). Both are scoped narrowly to enable this feature without retroactively
refactoring existing tools.

## Technical Context

**Language/Version**: TypeScript 5.6 on Node.js ≥ 18 (matches `package.json` `engines`)
**Primary Dependencies**: `@modelcontextprotocol/sdk` (server transport), `axios` (HTTP), `zod` (input validation, already in `dependencies` but currently unused in `src/`)
**New Dependencies (dev)**: `vitest` (test runner), `nock` (HTTP mocking), `zod-to-json-schema` (renders zod schema as MCP `inputSchema`)
**Storage**: N/A (this is a stateless tool wrapper)
**Testing**: vitest, with `nock` intercepting axios HTTP calls at the Node `http` module level. No real Obsidian instance required.
**Target Platform**: Node.js process running as an MCP stdio server, invoked by an LLM client (Claude Code, Inspector, etc.)
**Project Type**: TypeScript MCP server (single project, library-style; bundled with `tsup`)
**Performance Goals**: Match existing tool latency. Validation overhead must be O(length(target)) — a single string split — and must not exceed 1 ms per call on a typical input.
**Constraints**: 10 s upstream HTTP timeout (existing `axios.create` config in `src/services/obsidian-rest.ts:27`); no retries (matches existing `safeCall` convention; PATCH is non-idempotent so retry would be unsafe); no new configuration surface (auth, base URL, multi-vault routing reuse existing patterns).
**Scale/Scope**: One new tool (`patch_content`). One new validator module. One new schema module. Approximately 5 test cases mandated by FR-009 plus 2 inferred (whitespace-only target, empty-segment in middle). Net new TypeScript: ≤ ~250 lines including tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Disposition | Notes |
|---|---|---|
| I. Modular Code Organization | **PASS** | New code lives in `src/tools/patch-content/` (schema, validator, handler) and is dispatched from the existing `src/index.ts` switch. Dependency direction is unchanged: tool → service → axios → upstream. No cycles introduced. |
| II. Public Tool Test Coverage (NON-NEGOTIABLE) | **PASS** | Test runner (vitest) is set up as part of this feature. New tests cover happy-path heading patch, bare-target rejection, empty-segment rejection, non-heading pass-through, and upstream-error propagation (FR-009), plus whitespace-only and middle-empty-segment edge cases. |
| III. Boundary Input Validation with Zod | **PASS** | The `patch_content` schema is a zod schema; `inputSchema` for MCP tool registration is derived from it via `zod-to-json-schema` (single source of truth, satisfies FR-010). Validation runs once at the wrapper before any service call. |
| IV. Explicit Upstream Error Propagation | **PASS** | Existing `safeCall` in `src/services/obsidian-rest.ts:35` rethrows axios errors as typed `Error("Obsidian API Error <code>: <message>")`, preserving upstream status code and message. The new handler does not catch this; it propagates to the existing top-level catch in `src/index.ts:250-257`, which returns an MCP `isError: true` response. No new silent fallbacks. |

**Result**: All four principles pass. No violations to justify in Complexity Tracking.

**Scope honesty**: Existing tools (e.g., `append_content`, `get_file_contents`)
do not currently use zod and have no tests. The constitution does not
require retroactive enforcement; new tools must comply. Refactoring
existing tools is explicitly out of scope for this feature.

## Project Structure

### Documentation (this feature)

```text
specs/001-reenable-patch-content/
├── plan.md                  # This file
├── spec.md                  # Feature specification
├── research.md              # Phase 0 output
├── data-model.md            # Phase 1 output
├── quickstart.md            # Phase 1 output (developer-facing how-to)
├── contracts/
│   └── patch_content.md     # MCP tool contract: name, inputSchema, response shape
├── checklists/
│   └── requirements.md      # Spec quality checklist (from /speckit-specify)
└── notes/
    └── plan-context.md      # Pre-staged notes from /speckit-specify
```

### Source Code (repository root)

```text
src/
├── index.ts                          # MODIFIED: uncomment & rewrite the patch_content case
├── config.ts                         # unchanged
├── types.ts                          # unchanged
├── services/
│   ├── obsidian-rest.ts              # unchanged (patchContent already present)
│   ├── graph-service.ts              # unchanged
│   └── smart-connections.ts          # unchanged
└── tools/
    ├── index.ts                      # unchanged (WRITE_TOOLS already exported)
    ├── write-tools.ts                # MODIFIED: replace the commented patch_content
    │                                 #   block with `...PATCH_CONTENT_TOOLS` re-export
    ├── file-tools.ts                 # unchanged
    ├── search-tools.ts               # unchanged
    ├── obsidian-tools.ts             # unchanged
    ├── periodic-tools.ts             # unchanged
    ├── vault-tools.ts                # unchanged
    ├── graph-tools.ts                # unchanged
    ├── semantic-tools.ts             # unchanged
    └── patch-content/                # NEW
        ├── schema.ts                 # NEW: zod schema + heading-path validator
        ├── tool.ts                   # NEW: Tool[] export with inputSchema derived from zod
        └── handler.ts                # NEW: thin handler invoked from src/index.ts switch

tests/
└── tools/
    └── patch-content/                # NEW
        ├── schema.test.ts            # NEW: validator unit tests (no HTTP)
        └── handler.test.ts           # NEW: handler integration tests with nock
```

**Structure Decision**: Single TypeScript project, library-style. New tool
isolated under `src/tools/patch-content/` (a sub-folder rather than a flat
file) to keep the schema/validator/handler split visible and to give the
tests a parallel mirror. This sets the precedent that any future tool with
non-trivial validation gets its own folder. Existing tools that are
single-file (e.g., `write-tools.ts`) are not refactored; they stay as
they are.

## Complexity Tracking

> *No constitution violations to justify; this section is intentionally empty.*

## Phase 0 — Research

See [research.md](./research.md). Topics resolved:

- Test runner choice: **vitest** (rationale: native ESM, native TS, fast, jest-compatible API; project is `"type": "module"` so jest is awkward).
- HTTP mock library: **nock** (rationale: axios uses Node `http` underneath, which nock intercepts cleanly; `undici/MockAgent` only intercepts undici's fetch and would not catch axios calls; `msw` adds a service-worker-style abstraction we do not need for a Node-only project).
- Single source of truth for tool `inputSchema`: **`zod-to-json-schema`** (rationale: avoids drift between MCP-published schema and runtime validator; satisfies Constitution FR-010).
- Heading-path validator algorithm: pure structural — split on `::`, require `≥ 2` segments, every segment non-empty after no transformation. Confirmed in spec Edge Cases.
- Error format for validation rejections: throw a typed `Error` whose message contains the rule name, the offending value, and a corrected example; the existing top-level handler in `src/index.ts:250-257` converts thrown errors into MCP `isError: true` responses.
- No clarifications were left unresolved at end of `/speckit-clarify`.

## Phase 1 — Design & Contracts

See:

- [data-model.md](./data-model.md) — entities and validation rules.
- [contracts/patch_content.md](./contracts/patch_content.md) — MCP tool contract (name, inputSchema, response shape, error shape).
- [quickstart.md](./quickstart.md) — developer how-to: install new dev deps, run tests, smoke-test via Inspector.

Agent context update: the plan reference between the `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` markers in [CLAUDE.md](../../CLAUDE.md) is updated to point at this plan file.

**Post-Phase-1 Constitution re-check**: All four principles still pass.
The Phase 1 artifacts do not introduce any module that violates I (only
the new `src/tools/patch-content/` folder is added, with one-way
dependencies inward), II (test files are explicit deliverables in
quickstart and tasks), III (the contract and data-model both name the
zod schema as the single source of truth), or IV (the contract specifies
that upstream non-2xx must surface; no path in data-model permits a
silent fallback).
