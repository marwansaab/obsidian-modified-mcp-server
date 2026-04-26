<!--
SYNC IMPACT REPORT
==================
Version change: (template, unversioned) → 1.0.0
Bump rationale: Initial ratification — first concrete fill of the constitution
template. MAJOR per semver since prior state was placeholder-only.

Principles defined (4, replacing 5 template slots):
  - I. Modular Code Organization
  - II. Public Tool Test Coverage (NON-NEGOTIABLE)
  - III. Boundary Input Validation with Zod
  - IV. Explicit Upstream Error Propagation

Added sections:
  - Technical Standards & Stack Constraints (Section 2)
  - Development Workflow & Quality Gates (Section 3)
  - Governance

Removed sections:
  - Fifth principle slot (intentionally omitted; user requested four principles)

Templates / docs reviewed for consistency:
  - .specify/templates/plan-template.md  ✅ no change required
      (Constitution Check section is generic: "Gates determined based on
       constitution file" — pulls from this file at /speckit-plan time)
  - .specify/templates/spec-template.md  ✅ no change required
      (does not reference specific principles by name)
  - .specify/templates/tasks-template.md ✅ no change required
      (test tasks already optional; principle II will be enforced at plan
       gate, not template level)
  - CLAUDE.md                            ✅ no change required
      (currently a SPECKIT marker only)

Follow-up TODOs:
  - None. RATIFICATION_DATE set to today (2026-04-26) since this is the
    initial adoption.
  - Test runner is not yet configured in package.json. Principle II
    creates an implicit dependency: a test runner (e.g., vitest) MUST be
    added before the next public tool is shipped or amended. Track via
    /speckit-plan when relevant work begins.
-->

# Obsidian MCP Server Constitution

## Core Principles

### I. Modular Code Organization

Code MUST be organized into small, single-purpose modules with explicit boundaries.
Each MCP tool, transport adapter, analytics routine, and Obsidian client wrapper
lives in its own module and exposes a narrow, typed interface. Cross-module
imports MUST flow in one direction (tool → service → client → external SDK); no
upward or cyclic dependencies. A module that grows beyond a single clear
responsibility MUST be split before new functionality is added to it.

**Rationale**: This server bundles three distinct concerns (core tools, graph
analytics, semantic search) plus an MCP transport. Without strict modularity,
changes to one concern leak into others, tests grow brittle, and the surface
area for prompt-injection-style misuse expands.

### II. Public Tool Test Coverage (NON-NEGOTIABLE)

Every tool registered with the MCP server (i.e., every entry returned by the
server's `tools/list` handler) MUST have at least one automated test exercising
its happy path and at least one test exercising an input-validation failure or
upstream-error path. A tool MUST NOT be merged, exposed, or renamed without its
tests being added or updated in the same change. Tests for a tool MUST live next
to the tool's module or under a parallel `tests/` path that mirrors `src/`.

**Rationale**: Public tools are the contract this server offers to LLM clients.
A regression in any tool is observable to every downstream agent immediately and
silently — there is no UI layer to catch it. Tests are the only enforcement.

### III. Boundary Input Validation with Zod

Every public tool wrapper MUST validate its incoming arguments through a `zod`
schema before any business logic, network call, or file access runs. The schema
MUST be the single source of truth for both the tool's MCP `inputSchema` (via
`zod-to-json-schema` or equivalent) and the runtime parse. Validation failures
MUST return a structured MCP error with the field paths reported by zod;
validated values MUST be passed to inner functions as already-typed objects, not
re-validated downstream. Internal helpers MAY trust their inputs.

**Rationale**: A single validation point at the wrapper boundary keeps internal
code free of defensive checks, ensures the published schema and the runtime
behavior cannot drift apart, and gives LLM clients precise, actionable error
messages instead of stack traces.

### IV. Explicit Upstream Error Propagation

Errors raised by upstream systems (the Obsidian Local REST API, the filesystem,
the embedding provider, graphology) MUST be either (a) handled with a documented
recovery path or (b) surfaced to the MCP client as a structured error that
preserves the upstream status code, message, and — where safe — the underlying
cause. `catch` blocks MUST NOT return empty results, default values, or `null`
to mask a failure. Logging an error and continuing is NOT handling it. If a
fallback is intentional, it MUST be accompanied by a comment explaining the
recovery path and why silent success is correct in that case.

**Rationale**: Silent failures in an MCP server present as "the LLM got an empty
answer" — indistinguishable from a legitimately empty result, and impossible to
debug from the client side. Explicit propagation preserves the chain of custody
for failures all the way to the agent that invoked the tool.

## Technical Standards & Stack Constraints

The following constraints are normative and MUST hold for any change merged to
`main`:

- **Language**: TypeScript, compiled with `tsc --noEmit` clean and bundled with
  `tsup`. No `any` in tool wrapper signatures; `unknown` is acceptable when
  immediately narrowed via zod.
- **Runtime**: Node.js >= 18 (per `package.json` `engines`). No APIs that
  require a newer minimum.
- **Validation**: `zod` is the only permitted runtime input-validation library
  for tool wrappers. Hand-rolled `typeof` / `instanceof` chains at the boundary
  are a constitution violation.
- **MCP SDK**: `@modelcontextprotocol/sdk` is the sole transport. Tool
  registration MUST go through the SDK's `Server` API; ad-hoc JSON-RPC handling
  is forbidden.
- **Lint & format**: `eslint` (flat config) MUST pass with zero warnings before
  merge. `eslint-config-prettier` is in effect — formatting disagreements are
  resolved by prettier, not by review comments.
- **Dependencies**: New runtime dependencies MUST be justified in the PR
  description against the alternative of a small in-tree implementation.

## Development Workflow & Quality Gates

The following gates apply to every change before it can be merged:

1. `npm run lint` passes.
2. `npm run typecheck` passes.
3. `npm run build` succeeds.
4. The test suite covering all public tools passes (see Principle II). If the
   change adds, renames, or modifies a public tool, the diff MUST include the
   corresponding test additions.
5. The Sync Impact Report at the top of this file is updated whenever the
   constitution itself is amended (see Governance).
6. Spec-driven changes (those produced via `/speckit-plan` and `/speckit-tasks`)
   MUST pass the Constitution Check gate documented in
   `.specify/templates/plan-template.md` before implementation begins.

Code review MUST verify each of these gates explicitly; "CI is green" is
necessary but not sufficient — reviewers also confirm Principles I–IV by
inspection.

## Governance

This constitution supersedes all other contributor guidance, including
`README.md`, agent prompts, and prior conventions. Where this document and
another guide disagree, this document wins; the other guide MUST be updated to
match within the same change set.

**Amendment procedure**: Amendments are proposed by editing this file via
`/speckit-constitution`, which regenerates the Sync Impact Report, bumps the
version per the rules below, and updates the `Last Amended` date. Amendments
MUST be reviewed in a dedicated PR — not bundled with feature work.

**Versioning policy** (semantic versioning of the constitution itself):

- **MAJOR**: A principle is removed, redefined in a backward-incompatible way,
  or a governance rule is reversed.
- **MINOR**: A new principle or normative section is added, or existing guidance
  is materially expanded.
- **PATCH**: Wording clarifications, typo fixes, rationale rewrites that do not
  change the rule.

**Compliance review**: Every PR description MUST include a one-line statement
confirming Principles I–IV were considered, or explicitly call out and justify
any deviation under a "Complexity Tracking" entry in the corresponding plan.

**Runtime guidance**: Day-to-day development guidance lives in `CLAUDE.md` and
in feature-specific plans under `specs/`. Those documents MUST defer to this
constitution; if they imply a contradiction, treat it as a bug in the guidance
document and fix it.

**Version**: 1.0.0 | **Ratified**: 2026-04-26 | **Last Amended**: 2026-04-26
