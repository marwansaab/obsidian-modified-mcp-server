# Implementation Plan: Tag Management (`list_tags`)

**Branch**: `008-tag-management` | **Date**: 2026-05-01 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-tag-management/spec.md`

## Summary

Expose a single new MCP tool, `list_tags`, that wraps the upstream
Obsidian Local REST API plugin's `GET /tags/` endpoint and forwards the
authoritative tag-with-usage-count index to MCP callers. The tool takes
zero required arguments and an optional `vaultId` selector matching the
existing tool family's convention. Successful responses are forwarded
verbatim (no reshaping); upstream and transport errors flow through the
existing `ObsidianApiError` / `ObsidianTimeoutError` /
`ObsidianNotFoundError` surface unchanged.

The originally-scoped Stories 2 (`get_files_with_tag`) and 3
(`tag_mutation`) were dropped after Phase 0 verification confirmed that
their underlying upstream endpoints are not implemented; see
[research.md](research.md) §R1.

## Technical Context

**Language/Version**: TypeScript 5.6+ targeting Node.js >= 18 (per
`package.json` `engines`). Compiled with `tsc --noEmit` clean and
bundled with `tsup`.
**Primary Dependencies**: `@modelcontextprotocol/sdk` (transport),
`axios` (upstream HTTP — already wired through
`src/services/obsidian-rest.ts`), `zod` (boundary validation),
`zod-to-json-schema` (MCP `inputSchema` derivation).
**Storage**: N/A — this tool issues a single read against the upstream
Local REST API plugin and forwards the response. No local state, no
cache.
**Testing**: `vitest` 4.x (already in devDependencies, `npm test`
script exists). HTTP mocking via `nock` (also already a devDependency
and used by every existing tool test).
**Target Platform**: Node.js stdio MCP server (existing transport;
no new platform).
**Project Type**: Single project. Source under `src/`, tests under
`tests/` mirroring the source layout.
**Performance Goals**: SC-001 — no perceptible regression vs. existing
read tools (`list_files_in_vault`, `search`). The wrapper adds at most
one axios `get()` plus JSON serialization; latency is dominated by the
upstream call.
**Constraints**: FR-012 forbids reshaping the success body — handler
returns the raw upstream JSON serialized verbatim into a
`CallToolResult` text content block. No additive fields are dropped.
**Scale/Scope**: One tool, one zod schema (with one optional field),
one new method on `ObsidianRestService`, one new dispatcher arm in
`src/index.ts`. Reuses the entire existing transport, error, config,
and validation stack.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1
design.*

The four constitutional principles map to this feature as follows:

### Principle I — Modular Code Organization

**Status**: PASS (pre-design and post-design).

The new tool lives in its own directory `src/tools/list-tags/` with
`schema.ts`, `tool.ts`, and `handler.ts`. Imports flow tool → service
→ client (the handler imports from `obsidian-rest.ts`, which already
imports axios). No upward or cyclic dependencies are introduced. The
dispatcher in `src/index.ts` gains one new `case 'list_tags':` arm
that delegates to `handleListTags` — matching the
`case 'delete_file':` precedent and not adding inline business logic.

### Principle II — Public Tool Test Coverage (NON-NEGOTIABLE)

**Status**: PASS (test plan included in Phase 1 contracts).

`list_tags` is a public tool and so MUST ship with at least one
happy-path test and one input-validation-or-upstream-error test
(Constitution Principle II). Test plan:

- `tests/tools/list-tags/schema.test.ts` — validates the zod schema
  accepts no-args, accepts `{ vaultId: 'work' }`, trims whitespace
  from `vaultId`, and rejects non-string `vaultId`.
- `tests/tools/list-tags/registration.test.ts` — asserts `list_tags`
  appears in `ALL_TOOLS` exactly once, that its `inputSchema` is the
  `zod-to-json-schema` derivative of the schema, and that the tool
  description mentions both the inline+frontmatter inclusion rule
  and the code-block exclusion rule (FR-008, SC-006).
- `tests/tools/list-tags/handler.test.ts` — two happy-path cases.
  (a) Populated index: nock the upstream `GET /tags/` to return a
  fixture body containing a hierarchical tag with parent-prefix
  roll-up; assert the wrapper forwards the body verbatim
  (FR-010, FR-012, SC-002, SC-006). (b) Empty vault: nock the
  upstream to return `{ "tags": [] }`; assert the wrapper returns
  the empty index verbatim and does NOT raise (spec edge case
  "Empty vault / no tags").
- `tests/tools/list-tags/upstream-error.test.ts` — error path: nock
  the upstream to return 401; assert the wrapper raises an
  `ObsidianApiError` whose serialized text contains the upstream
  status code and message verbatim (FR-007, SC-005, satisfies the
  Principle II "input-validation OR upstream-error" requirement
  via the upstream-error path).

`list_tags` has no required input fields, so a "missing required
input" test is not meaningful; the upstream-error test fulfills the
non-happy-path requirement, and the schema test covers the optional
`vaultId` validation.

### Principle III — Boundary Input Validation with Zod

**Status**: PASS.

`src/tools/list-tags/schema.ts` defines a `ListTagsRequestSchema`
zod object with exactly one field — optional `vaultId: z.string()
.trim().optional()`. The same schema feeds both the runtime parser
(`assertValidListTagsRequest`) and the published MCP `inputSchema`
(via `zod-to-json-schema` in `tool.ts`). The handler calls the
parser before any HTTP call; internal helpers receive the
already-typed request. No hand-rolled `typeof` checks exist
anywhere in the new code.

### Principle IV — Explicit Upstream Error Propagation

**Status**: PASS.

`ObsidianRestService.listTags()` goes through the existing
`safeCall` wrapper, which converts axios errors to typed
`ObsidianApiError` / `ObsidianNotFoundError` /
`ObsidianTimeoutError`. The handler does not swallow these — it
re-throws plain `Error`s (matching the `delete-file/handler.ts`
shape) which the dispatcher's existing `try/catch` in
`src/index.ts` converts to `{ content, isError: true }`. No `catch`
returns empty results, defaults, or `null`. Status code and
upstream message text reach the caller in the
`Obsidian API Error <code>: <message>` shape that
`safeCall` already produces — i.e., verbatim from the upstream's
own error body when present (FR-007, SC-005).

### Post-design re-check

Re-evaluated after Phase 1 (data-model + contracts + quickstart):
all four principles still PASS. No Complexity Tracking entries
required.

## Project Structure

### Documentation (this feature)

```text
specs/008-tag-management/
├── plan.md                  # This file
├── research.md              # Phase 0 — upstream verification + design rationale
├── data-model.md            # Phase 1 — Tag, Tag Index entities
├── contracts/
│   └── list_tags.md         # Phase 1 — public-facing tool contract
├── quickstart.md            # Phase 1 — manual smoke-test recipe
├── spec.md                  # Feature spec (reduced scope, post-Phase-0)
├── checklists/
│   └── requirements.md      # Spec-quality checklist
└── tasks.md                 # Phase 2 output (NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── index.ts                 # MCP server entry — gains one new dispatcher arm
├── services/
│   ├── obsidian-rest.ts     # Existing — gains new listTags() method
│   └── obsidian-rest-errors.ts  # Existing — no change
├── tools/
│   ├── index.ts             # Existing — re-exports new LIST_TAGS_TOOLS
│   └── list-tags/           # NEW
│       ├── schema.ts        # zod schema + assertValid* helper
│       ├── tool.ts          # MCP Tool[] registration (description, inputSchema)
│       └── handler.ts       # handleListTags(args, rest) → CallToolResult
└── (other existing modules untouched)

tests/
└── tools/
    └── list-tags/           # NEW
        ├── schema.test.ts
        ├── registration.test.ts
        ├── handler.test.ts
        └── upstream-error.test.ts
```

**Structure Decision**: Single project, per-tool directory under
`src/tools/list-tags/` mirrored by `tests/tools/list-tags/`. This is
the established convention used by `delete-file`, `surgical-reads`,
`patch-content`, and `graph`, and is the shape Constitution
Principle I prescribes for any tool with both a zod schema and
orchestration logic.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. The reduced-scope feature ships exactly one tool that follows
the existing per-tool-directory convention, the existing zod
boundary-validation pattern, and the existing typed-error
propagation pattern. No principle is violated, so no justification
entries are required.
