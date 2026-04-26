# Implementation Plan: Surgical Reads — get_heading_contents + get_frontmatter_field

**Branch**: `003-surgical-reads` | **Date**: 2026-04-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-surgical-reads/spec.md`

## Summary

Add two new MCP read tools that fetch part of a vault note instead of the whole file:

- **`get_heading_contents`** — takes a filepath and a heading target; returns the
  raw markdown body content under that heading. Applies the same structural-only
  heading-path validator established for `patch_content` in feature 001 (ADR-001):
  the target must be `H1::H2[::H3...]` form (≥ 2 non-empty `::`-separated
  segments). Bare or otherwise non-conforming heading targets are rejected before
  any HTTP call is made, with the same actionable error message format used by
  `patch_content`. Top-level headings and headings whose literal text contains
  `::` remain unreachable through this tool; the documented fallback is
  `get_file_contents` followed by client-side slicing.
- **`get_frontmatter_field`** — takes a filepath and a single field name; returns
  just that field's value. The wrapper decodes the upstream's JSON response and
  surfaces the typed value (string, number, boolean, array, object, or `null`)
  on the MCP output. Missing fields surface as structured errors via the
  upstream's 4xx, distinct from a present-but-`null` value.

Both tools forward their validated requests verbatim to the upstream Local REST
API plugin's `GET /vault/{path}/heading/{path-segments}` and
`GET /vault/{path}/frontmatter/{field}` endpoints. No client-side parsing of
the target file is performed; the only "decoding" anywhere in this feature is
the JSON envelope the upstream already emits for the frontmatter endpoint.

This feature is purely additive. It builds entirely on the infrastructure
introduced by feature 001:

- `vitest` test runner, `nock` HTTP mock, and `zod-to-json-schema` are already
  installed and wired (`package.json`, `tests/tools/patch-content/`).
- Constitution gates Principles I–IV are already validated against
  `src/tools/patch-content/`; the new tools follow the same module shape.
- The structural heading-path predicate `isValidHeadingPath` is imported
  unchanged from `src/tools/patch-content/schema.ts` — single source of truth,
  no second copy of the rule.

## Technical Context

**Language/Version**: TypeScript 5.6 on Node.js ≥ 18 (matches `package.json` `engines`)
**Primary Dependencies**: `@modelcontextprotocol/sdk` (server transport), `axios` (HTTP), `zod` (input validation), `zod-to-json-schema` (renders zod schema as MCP `inputSchema`) — all already present in `dependencies` after feature 001
**New Dependencies**: **none**. Test runner (`vitest`), HTTP mock (`nock`), and zod↔JSON-Schema bridge (`zod-to-json-schema`) were all installed by feature 001 and are reused as-is.
**Storage**: N/A (stateless tool wrappers)
**Testing**: vitest with `nock` intercepting axios HTTP calls at the Node `http` module level. No real Obsidian instance required.
**Target Platform**: Node.js process running as an MCP stdio server, invoked by an LLM client (Claude Code, Inspector, etc.)
**Project Type**: TypeScript MCP server (single project, library-style; bundled with `tsup`)
**Performance Goals**: Match existing tool latency. Validation overhead must be O(length(target)) — a single string split — and must not exceed 1 ms per call on a typical input. Frontmatter response decoding is `JSON.parse` of a small payload (≤ a few KB); negligible.
**Constraints**: 10 s upstream HTTP timeout (existing `axios.create` config in [src/services/obsidian-rest.ts:27](../../src/services/obsidian-rest.ts#L27)); no retries (matches existing `safeCall` convention; both endpoints are GET so retries would be safe for transport errors but the project's convention is no retries — see research R5); no new configuration surface (auth, base URL, multi-vault routing reuse existing patterns).
**Scale/Scope**: Two new tools (`get_heading_contents`, `get_frontmatter_field`). One new module folder (`src/tools/surgical-reads/`) with three source files. Two new methods on `ObsidianRestService`. Approximately 14 test cases (8 for heading-contents, 6 for frontmatter-field) plus 4 registration tests. Net new TypeScript: ≤ ~400 lines including tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Disposition | Notes |
|---|---|---|
| I. Modular Code Organization | **PASS** | New code lives in `src/tools/surgical-reads/` (schema, tool, two handler files) and is dispatched from the existing `src/index.ts` switch. Two new methods are added to `ObsidianRestService` (the existing service module — adding methods is consistent with that module's single responsibility as the upstream HTTP client). Dependency direction is unchanged: tool → service → axios → upstream. The validator import `surgical-reads/schema.ts` → `patch-content/schema.ts` is a sibling tool→tool dependency that exists solely to enforce the single-source-of-truth requirement (FR-003 / spec Assumptions); without it, we would have a second copy of the same rule, which is a worse violation. No cycles introduced. |
| II. Public Tool Test Coverage (NON-NEGOTIABLE) | **PASS** | Both new tools have happy-path, validation-failure, and upstream-error tests. The existing vitest+nock harness from feature 001 is reused unchanged. New test files: `tests/tools/surgical-reads/{schema,heading-handler,frontmatter-handler,registration}.test.ts`. Test counts per the contract test matrices in [contracts/](./contracts/). |
| III. Boundary Input Validation with Zod | **PASS** | Each tool's input schema is a zod schema; `inputSchema` for MCP tool registration is derived from it via `zod-to-json-schema` (single source of truth for each tool, satisfies FR-012). For `get_heading_contents`, the target field's structural check additionally invokes `isValidHeadingPath` imported from feature 001's schema module — preserving Constitution III's "single point of validation at the wrapper boundary" while also satisfying FR-003's "no second source of truth" requirement. Validation runs once, before any service call. |
| IV. Explicit Upstream Error Propagation | **PASS** | Both new `ObsidianRestService` methods route through the existing `safeCall` helper at [src/services/obsidian-rest.ts:35](../../src/services/obsidian-rest.ts#L35), which rethrows axios errors as typed `Error("Obsidian API Error <code>: <message>")` preserving upstream status code and message. The handlers do not catch these; they propagate to the existing top-level catch in [src/index.ts:251-258](../../src/index.ts#L251-L258), which returns an MCP `isError: true` response. No silent fallbacks: missing-field surfaces as upstream 4xx (per spec FR-009 + clarification 2026-04-26 Q2), distinct from a present-but-`null` value which surfaces as `value: null` on the MCP output. |

**Result**: All four principles pass. No violations to justify in Complexity Tracking.

**Scope honesty**: Existing tools that are not `patch_content` (e.g., `append_content`, `get_file_contents`) still do not use zod and have no tests. The constitution does not require retroactive enforcement; new tools must comply. Refactoring existing tools is explicitly out of scope for this feature.

## Project Structure

### Documentation (this feature)

```text
specs/003-surgical-reads/
├── plan.md                              # This file
├── spec.md                              # Feature specification
├── research.md                          # Phase 0 output
├── data-model.md                        # Phase 1 output
├── quickstart.md                        # Phase 1 output (developer-facing how-to)
├── contracts/
│   ├── get_heading_contents.md          # MCP tool contract: name, inputSchema, response shape
│   └── get_frontmatter_field.md         # MCP tool contract: name, inputSchema, response shape
└── checklists/
    └── requirements.md                  # Spec quality checklist (from /speckit-specify)
```

### Source Code (repository root)

```text
src/
├── index.ts                             # MODIFIED: two new switch cases (get_heading_contents, get_frontmatter_field)
├── config.ts                            # unchanged
├── types.ts                             # unchanged
├── services/
│   ├── obsidian-rest.ts                 # MODIFIED: two new methods (getHeadingContents, getFrontmatterField)
│   ├── graph-service.ts                 # unchanged
│   └── smart-connections.ts             # unchanged
└── tools/
    ├── index.ts                         # MODIFIED: export and aggregate SURGICAL_READ_TOOLS
    ├── file-tools.ts                    # unchanged
    ├── search-tools.ts                  # unchanged
    ├── obsidian-tools.ts                # unchanged
    ├── periodic-tools.ts                # unchanged
    ├── vault-tools.ts                   # unchanged
    ├── graph-tools.ts                   # unchanged
    ├── semantic-tools.ts                # unchanged
    ├── write-tools.ts                   # unchanged
    ├── patch-content/                   # unchanged (validator imported by surgical-reads)
    │   ├── schema.ts
    │   ├── tool.ts
    │   └── handler.ts
    └── surgical-reads/                  # NEW
        ├── schema.ts                    # NEW: zod schemas for both tools; imports isValidHeadingPath
        ├── tool.ts                      # NEW: SURGICAL_READ_TOOLS: Tool[] (two entries)
        ├── handler-heading.ts           # NEW: handleGetHeadingContents
        └── handler-frontmatter.ts       # NEW: handleGetFrontmatterField

tests/
└── tools/
    ├── patch-content/                   # unchanged
    └── surgical-reads/                  # NEW
        ├── schema.test.ts               # NEW: zod + heading-path validator unit tests
        ├── heading-handler.test.ts      # NEW: get_heading_contents handler tests with nock
        ├── frontmatter-handler.test.ts  # NEW: get_frontmatter_field handler tests with nock
        └── registration.test.ts         # NEW: tools/list registration assertions for both
```

**Structure Decision**: Single TypeScript project, library-style. Both new tools share a single `src/tools/surgical-reads/` folder because they share the heading-path validator import and ship together as one feature. The handler split into two files (`handler-heading.ts`, `handler-frontmatter.ts`) keeps each tool's I/O semantics in one place; the schema split is unnecessary because both schemas are tiny. This matches the precedent set by `src/tools/patch-content/` (one folder per "feature unit") rather than the old flat-file precedent of `file-tools.ts`.

## Complexity Tracking

> *No constitution violations to justify; this section is intentionally empty.*

## Phase 0 — Research

See [research.md](./research.md). Topics resolved:

- **Module placement**: One folder for both tools (`src/tools/surgical-reads/`), not two folders. Rationale: shared validator import, shared spec, shared release.
- **Validator reuse**: Sibling import from `src/tools/patch-content/schema.ts` rather than hoisting to a `_shared/` module. Rationale: hoisting would refactor existing code outside this feature's scope; sibling import is a 5-line, low-risk way to enforce the FR-003 single-source-of-truth requirement.
- **Heading response Content-Type**: `Accept: text/markdown`, return raw body as a single text content (per spec Clarifications session 2026-04-26 Q1). The JSON envelope `application/vnd.olrapi.note+json` is explicitly NOT requested.
- **Frontmatter response shape**: The upstream returns the field's value as a JSON document. The wrapper does `JSON.parse` and surfaces the decoded value (any of: string, number, boolean, array, object, `null`) on the MCP output's `value` field, JSON-stringified into the standard `content[0].text` slot to match the existing project convention for object outputs (see `searchJson` etc.). Per spec Clarifications session 2026-04-26 Q2.
- **Error format for wrapper-side rejections**: Identical to `patch_content`'s error format (rule statement, `received: "<offending>"`, `e.g., "<corrected>"`) for the heading-path rule (FR-004 says "must match"). The frontmatter tool's wrapper rejection (empty-or-whitespace field name) uses zod's own field-path message, which is sufficient (no path-rule analogue exists for that tool).
- **Logging / observability**: Inherits the existing top-level `console.error` convention; no new instrumentation. Same disposition as feature 001.
- **Timeout / retry policy**: Inherits the existing 10 s axios timeout and the no-retry convention. GET is idempotent so retries would be safe in principle, but adding retries here would diverge from project convention and is out of scope.
- **No `NEEDS CLARIFICATION` items remain.**

## Phase 1 — Design & Contracts

See:

- [data-model.md](./data-model.md) — entities, validation rules, response shapes for both tools.
- [contracts/get_heading_contents.md](./contracts/get_heading_contents.md) — MCP tool contract (name, inputSchema, response shape, error shape, test matrix).
- [contracts/get_frontmatter_field.md](./contracts/get_frontmatter_field.md) — MCP tool contract (name, inputSchema, response shape, error shape, test matrix).
- [quickstart.md](./quickstart.md) — developer how-to: file layout, test patterns, smoke-test recipes.

Agent context update: the plan reference between the `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` markers in [CLAUDE.md](../../CLAUDE.md) is updated to point at this plan file.

**Post-Phase-1 Constitution re-check**: All four principles still pass.

- **I (Modular)**: Phase 1 introduces one new folder under `src/tools/`, two new methods on the existing `ObsidianRestService`, and two new switch cases in `src/index.ts`. The dependency graph remains acyclic; the only cross-tool import is the deliberate `surgical-reads/schema.ts → patch-content/schema.ts` for the validator (recorded under Constitution Check above).
- **II (Test Coverage)**: Phase 1 contracts mandate concrete test rows; quickstart shows the test harness pattern lifted from feature 001. Test files are explicit deliverables, not aspirational.
- **III (Zod at boundary)**: Both contracts name the zod schema as the single source of truth; the data model documents the schema shapes. `inputSchema` is derived via `zod-to-json-schema` at module-load time (same pattern as `patch_content`).
- **IV (Upstream errors)**: Both contracts specify that upstream non-2xx and transport errors propagate verbatim through `safeCall`; no path in the data-model permits a silent fallback. The frontmatter tool's typed-`null` output is explicitly distinguished from "missing field" (which surfaces as upstream 4xx).
