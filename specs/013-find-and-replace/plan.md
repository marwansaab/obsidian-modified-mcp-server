# Implementation Plan: Vault-Wide Find and Replace (`find_and_replace`)

**Branch**: `013-find-and-replace` | **Date**: 2026-05-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/013-find-and-replace/spec.md`

## Summary

`find_and_replace` is a single MCP tool that performs vault-wide string replacement across every `.md` file in a targeted vault. The tool composes three layers: (LAYER 1) a per-note replacement primitive lifted with attribution from `cyanheads/obsidian-mcp-server`'s `obsidian_replace_in_note` algorithm, (LAYER 2) a vault-wide composition + dry-run pattern adapted from `blacksmithers/vaultforge`'s `grep-sub` tool, and (LAYER 3) the wrapper's existing `getRestService(vaultId)` plumbing for per-vault routing — which is the original-contribution layer not present in either upstream. The tool exposes a single zod-validated input surface (`search`, `replacement`, plus 10 optional flags), walks `.md` files via the existing `rest.listFilesInVault` / `rest.listFilesInDir` infrastructure, fetches each file via `rest.getFileContents`, applies single-pass-global replace semantics over the searchable spans (with code-block and HTML-comment regions carved out per FR-007/FR-008/FR-009), and writes back via `rest.putContent` — preserving CRLF/LF byte composition and trailing-newline state byte-for-byte.

The 18 clarifications resolved across four `/speckit-clarify` sessions (recorded in [spec.md §Clarifications](./spec.md#clarifications)) pin the contract precisely enough that the implementation work splits cleanly into nine concrete modules (boundary schema, region detection, pattern building, single-pass replacer, vault walker, response assembler, the public tool wrapper, the dispatcher hook, and the `rest.findAndReplace` helper). The design also unblocks a downstream consumer: the previously-scaffolded [`rename_file`](../012-safe-rename/) tool depends on `rest.findAndReplace` as a static module dependency (per [012 plan §Implementation order constraint](../012-safe-rename/plan.md#summary)), so this feature's `rest.findAndReplace` shape is a contract that 012 imports — not a private internal helper.

The feature ships with **two surface forms** in the same module: (a) the public MCP tool `find_and_replace` registered with the SDK, and (b) the internal `ObsidianRestService.findAndReplace(...)` method. Both call the same underlying composition; the public tool wraps the internal helper with zod validation, multi-vault dispatch, and a structured `CallToolResult`. This dual-surface pattern matches the brief's description of LAYER 3 wrapping LAYER 2, and avoids forcing 012's rename composer to go through MCP-layer JSON-stringification round-trips for an internal call.

## Technical Context

**Language/Version**: TypeScript, compiled via `tsc --noEmit` and bundled via `tsup` (existing toolchain; no version bump).
**Primary Dependencies**: `@modelcontextprotocol/sdk` (transport, `Tool[]` registration), `zod` (boundary validation, single source of truth for `inputSchema`), `zod-to-json-schema` (derives MCP JSON Schema from the zod schema), `axios` via the existing `ObsidianRestService` client. **No new runtime dependencies** — region detection (CommonMark-style line-anchored fences per FR-007; non-greedy `<!--…-->` per FR-008) is implemented as small in-tree regex-based scanners (~50–80 LOC total). A CommonMark-spec library would be heavyweight overkill for two well-bounded region types.
**Storage**: N/A. The tool is stateless; every operation goes through Obsidian's REST API.
**Testing**: `vitest` (per [vitest.config.ts](../../vitest.config.ts), already configured). Tests in `tests/tools/find-and-replace/`: `registration.test.ts` (description substrings — clean-git precondition, dry-run safety net, last-write-wins risk per FR-003), `schema.test.ts` (zod boundary cases — empty `search` rejection, regex compile errors, all defaults), `region-detection.test.ts` (hermetic CommonMark fence detection + HTML comment detection, including unclosed cases and overlap union per FR-009), `replacer.test.ts` (single-pass global semantics, capture-group `$1`/`$&` honoring, wholeWord `\b…\b` wrapping, flexibleWhitespace `\s+` substitution, byte-identical-no-op detection), `walker.test.ts` (dot-prefix exclusion per FR-024b, case-insensitive `.md` extension match per FR-024, `pathPrefix` directory-segment rule per FR-004), `handler.test.ts` (composition flow against mocked `ObsidianRestService` — happy path, dry-run zero-write, mid-sweep failure best-effort-continue per FR-021a, multi-vault routing). End-to-end verification against TestVault is captured in [quickstart.md](./quickstart.md).
**Target Platform**: Cross-platform Node.js process consumed as an MCP server by Claude Desktop / Claude Code / other MCP clients (per existing [README.md](../../README.md)). Cross-platform line-ending preservation (FR-016a) is explicitly tested on a CRLF-encoded fixture.
**Project Type**: TypeScript module library exposing a set of MCP tools. The new module joins the `src/tools/` directory using the established `{schema, tool, handler}.ts` pattern (mirrors [`patch-content`](../../src/tools/patch-content/), [`delete-file`](../../src/tools/delete-file/), [`list-tags`](../../src/tools/list-tags/)).
**Performance Goals**: Per SC-001, vaults of up to 1,000 notes complete in under 30 seconds (one prior dry-run + one commit). Latency dominated by sequential REST round-trips: one enumerate, then one fetch + (optionally) one PUT per modified file. Per-file size cap (5 MB input AND output, FR-024a) bounds worst-case per-file processing. Per SC-006, response stays under 500 bytes for a 5,000-note vault with no matches when `verbose: false`.
**Constraints**:
- Must add **zero new runtime dependencies** (Constitution: "new runtime dependencies MUST be justified"). Region detectors are in-tree (no `remark` / `markdown-it`).
- Must `lint` / `typecheck` / `build` clean (Quality Gates 1–3).
- Must include ≥1 happy-path test and ≥1 failure-path test for the registered tool (Principle II, NON-NEGOTIABLE). The handler tests cover both; the boundary-schema and region-detection tests provide structural correctness gates beyond the constitutional minimum.
- Must validate inputs at the boundary via a single zod schema reused for `inputSchema` (Principle III). All 12 input parameters live in one `FindAndReplaceRequestSchema`.
- Must propagate upstream errors verbatim — typed `ObsidianApiError` / `ObsidianTimeoutError` / `ObsidianNotFoundError` from per-file `safeCall` calls propagate to the dispatcher unchanged, EXCEPT that during a sweep with at least one prior successful write, per-file errors are caught, recorded in the `failures` array, and the sweep continues (FR-021a best-effort-continue) — this is the documented Principle IV deviation, justified by Q2's user choice.
- Per-file size cap MUST be enforced on BOTH the fetched input AND the post-replacement output (FR-024a). Files exceeding either cap appear in `skipped` with the appropriate reason; they are NOT counted in `filesModified` or `failures`.
- Replacement MUST be single-pass global (FR-006) — equivalent to JS `String.prototype.replaceAll` for literal mode and `String.prototype.replace(/.../g, ...)` for regex mode. The replacement output is NEVER re-scanned within the same call.
- Line endings MUST be preserved byte-for-byte on read, replace, and write (FR-016a). No CRLF/LF normalization.
- `caseSensitive: false` MUST use ECMAScript Unicode case-folding (regex `i + u` flags, FR-012, FR-013).
- The `rest.findAndReplace` helper MUST expose the parameters that 012's regex-passes module already calls with: `flags`-style call shape including `skipCodeBlocks: true` and `skipHtmlComments: true` (per [src/tools/rename-file/regex-passes.ts](../../src/tools/rename-file/regex-passes.ts) §header). The exact helper signature is documented in [contracts/find_and_replace.md](./contracts/find_and_replace.md) and 012's handler (when it ships) imports it as a static dependency.
- Attribution headers MUST appear in the per-note replacer (cyanheads, FR-025), the dry-run formatter (vaultforge, FR-026), and the multi-vault wrapper (project + original-contribution note, FR-027). README's attributions section gets a new entry for both upstreams plus the project's own LAYER 3 (FR-028).

**Scale/Scope**:
- 1 new tool registration (joins ~30+ existing tools, plus 012's deferred-but-scaffolded `rename_file`).
- 1 new method on `ObsidianRestService` (`findAndReplace`) — the helper that 012 and the public tool both consume.
- ~9 new source files in [src/tools/find-and-replace/](../../src/tools/find-and-replace/) and [src/services/find-and-replace/](../../src/services/find-and-replace/) (~600–800 LOC total): boundary schema, public tool registration, public handler, region detector, pattern builder, single-pass replacer, vault walker, response/preview assembler, README attribution updates.
- ~7 new test files (~600–800 LOC total) under [tests/tools/find-and-replace/](../../tests/tools/find-and-replace/) and [tests/services/find-and-replace/](../../tests/services/find-and-replace/).
- 1 dispatcher hook in [src/index.ts](../../src/index.ts) (one new `case 'find_and_replace'` branch).
- 1 aggregation entry in [src/tools/index.ts](../../src/tools/index.ts).
- 2 README updates: attributions section (FR-028), tool listing.
- **Downstream unblock**: 012's `RENAME_FILE_TOOLS` re-enters `ALL_TOOLS` and 012's handler ships; this is tracked in 012's tasks file and is OUT OF SCOPE for this feature.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution version: **1.0.0** ([.specify/memory/constitution.md](../../.specify/memory/constitution.md)).

| # | Principle | Status | How this plan satisfies it |
|---|---|---|---|
| I | Modular Code Organization | **PASS** | The implementation is split across small, single-purpose modules: `schema.ts` (zod boundary), `tool.ts` (MCP registration), `handler.ts` (public tool composition), `region-detector.ts` (CommonMark fences + HTML comments per FR-007/8/9), `pattern-builder.ts` (literal-vs-regex compilation, wholeWord, flexibleWhitespace per FR-010/11/13), `replacer.ts` (single-pass global replace per FR-006), `walker.ts` (vault enumeration + dot-prefix and `pathPrefix` filtering per FR-004/24/24b), `preview-formatter.ts` (dry-run structured-match assembly per FR-015), and the `rest.findAndReplace` helper on the service. Imports flow tool → handler → service → external SDK; no upward or cyclic dependencies. Each module has one responsibility and no module exceeds ~150 LOC. The split follows the same pattern as [`rename-file`'s schema/tool/regex-passes/handler decomposition](../../src/tools/rename-file/). |
| II | Public Tool Test Coverage (NON-NEGOTIABLE) | **PASS** (by design) | `tests/tools/find-and-replace/handler.test.ts` includes: (a) ≥1 happy-path test asserting `{ ok: true, filesScanned, filesModified, totalReplacements, totalMatchesInSkippedRegions, filesSkipped }` for a vault containing the search string in N notes; (b) ≥1 failure-path test asserting that mid-sweep `rest.putContent` rejection produces `{ ok: false, ..., failures: [...] }` per FR-021a; (c) ≥1 dry-run-zero-write test asserting no PUT calls when `dryRun: true`; (d) ≥1 multi-vault-routing test asserting the non-default `vaultId` is honored. `registration.test.ts` pins the FR-003 description substrings (clean git precondition, dry-run safety net, last-write-wins risk). The schema, region-detection, pattern-building, replacer, walker, and preview-formatter tests are additional structural correctness gates beyond the constitutional minimum. Tests live next to source under the parallel `tests/tools/find-and-replace/` and `tests/services/find-and-replace/` paths. |
| III | Boundary Input Validation with Zod | **PASS** (by design) | A single `FindAndReplaceRequestSchema` in `schema.ts` validates all 12 inputs (`search` non-empty per FR-022, `replacement`, the 8 optional booleans, `pathPrefix`, `vaultId`, `verbose`). The same schema is fed through `zod-to-json-schema` to produce the published MCP `inputSchema` (matches the [`list-tags`](../../src/tools/list-tags/schema.ts) and [`patch-content`](../../src/tools/patch-content/schema.ts) patterns). Inner functions receive an already-typed `FindAndReplaceRequest`. Regex compile errors (FR-023) are surfaced as a structured boundary error before any file is touched. No hand-rolled `typeof`/`instanceof` validation. |
| IV | Explicit Upstream Error Propagation | **PASS** (with one documented deviation, justified) | The default Principle IV behavior — let `ObsidianApiError` / `ObsidianTimeoutError` / `ObsidianNotFoundError` propagate from each `safeCall` to the dispatcher — applies to (a) pre-sweep failures (FR-021: invalid input, vault routing error, regex compile error, empty `search`), and (b) the initial enumerate call (`rest.listFilesInVault`). The single explicit deviation is FR-021a's best-effort-continue semantics: once at least one file has been successfully written, per-file errors during the sweep are caught and recorded in the `failures` array rather than aborting. This deviation was the user's explicit choice in Q2 / session 1 (recorded in [spec.md §Clarifications](./spec.md#clarifications)). The justification: rollback is impossible without a transaction layer (the tool doesn't own a snapshot), and aborting strands writes already committed; structured partial-result reporting matches what other multi-file MCP tools in this fork already do. The handler's catch block does NOT swallow the underlying typed error — it records it AND continues; the response includes the upstream message verbatim per FR-021a's `failures: [{ filename, error }]` shape. |

**Stack constraints**:

- TypeScript, `tsc --noEmit` clean: **PASS by design** (no `any`; `unknown` only inside the zod boundary).
- Node.js >= 18: **PASS** (uses only stable ECMAScript features; the regex `u` flag per FR-013 is widely available; no Node 20+ APIs required).
- `zod` is the only validation lib: **PASS** (sole boundary validator).
- `@modelcontextprotocol/sdk`: **PASS** (registration through existing `Tool[]` aggregation; dispatcher uses `CallToolRequest`).
- `eslint` + `prettier`: **PASS by design** (matches existing module conventions verbatim).
- No new runtime dependencies: **PASS** (uses only `zod`, `zod-to-json-schema`, the SDK, and the in-repo `ObsidianRestService`; region detectors are small in-tree regex scanners — explicitly not a new dep).

**Quality Gates 1–4** (lint, typecheck, build, tests): all addressed structurally; verification happens at PR time.

**Conclusion**: All four principles satisfied; the single Principle IV deviation (FR-021a best-effort-continue) is documented above and traces back to a recorded user decision in spec Clarifications. **No Complexity Tracking entry required.**

**Post-Phase-1 re-check (2026-05-03)**: The Phase 1 artifacts ([research.md](./research.md), [data-model.md](./data-model.md), [contracts/find_and_replace.md](./contracts/find_and_replace.md), [quickstart.md](./quickstart.md)) introduce no new violations. The decomposition into 9 modules (per [Project Structure](#project-structure)) reinforces Principle I; the test contract in `contracts/find_and_replace.md §"Test contract"` reinforces Principle II; the single zod schema and the helper's mirror-validation backstop reinforce Principle III; the per-file failure-recording mechanism (FR-021a) is the same documented Principle IV deviation, with no new exceptions. License-verification gates (R1, R2 in research.md) are tracked as merge-blocking prerequisites; they do not affect the constitution check itself. **Re-check PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/013-find-and-replace/
├── plan.md                       # This file (/speckit-plan output)
├── research.md                   # Phase 0 output (lifted-vs-original layer research, region-detection algorithm choice, JS replace semantics, attribution / licensing)
├── data-model.md                 # Phase 1 output (request/response schemas, region/match/preview record shapes)
├── contracts/
│   └── find_and_replace.md       # Phase 1 output (MCP tool contract + rest.findAndReplace helper signature for 012)
├── quickstart.md                 # Phase 1 output (manual E2E verification against TestVault)
├── checklists/
│   └── requirements.md           # From /speckit-specify
└── spec.md                       # From /speckit-specify + 4 rounds of /speckit-clarify (18 clarifications)
```

### Source Code (repository root)

```text
src/
├── index.ts                      # +1 dispatcher branch: case 'find_and_replace' → handleFindAndReplace(args, this.getRestService(this.resolveVaultId(args)))
├── tools/
│   ├── index.ts                  # +1 entry: ...FIND_AND_REPLACE_TOOLS in ALL_TOOLS aggregation
│   └── find-and-replace/
│       ├── schema.ts             # Single zod schema for all 12 inputs; assertValidFindAndReplaceRequest helper
│       ├── tool.ts               # Tool[] registration; description includes FR-003 substrings (clean git, dry-run safety, last-write-wins)
│       ├── handler.ts            # Public tool: composes rest.listFilesInVault → walker → rest.findAndReplace; assembles CallToolResult
│       ├── region-detector.ts    # CommonMark line-anchored fence detector (FR-007); non-greedy <!--...--> detector (FR-008); union (FR-009); LAYER 2-attribution-header
│       ├── pattern-builder.ts    # Literal escape, wholeWord (\b...\b, FR-010), flexibleWhitespace (\s+, FR-011), regex flag set (gimu, no s, FR-013); LAYER 1-attribution-header
│       ├── replacer.ts           # Single-pass global replace over searchable spans; preserves skipped-region bytes (FR-007/8); empty-match handling (FR-013); LAYER 1-attribution-header
│       ├── walker.ts             # Enumerates .md files; case-insensitive extension (FR-024); dot-prefix exclusion (FR-024b); pathPrefix directory-segment match (FR-004)
│       ├── preview-formatter.ts  # Dry-run structured-match preview ({ matchIndex, lineNumber, columnStart, before, match, replacement, after }, FR-015); LAYER 2-attribution-header
│       └── response-builder.ts   # Assembles { ok, filesScanned, filesModified, totalReplacements, totalMatchesInSkippedRegions, filesSkipped, perFile?, failures?, skipped? }; sorts arrays (FR-020c); LAYER 3-attribution-header (project original)
└── services/
    └── obsidian-rest.ts          # +1 method: findAndReplace(opts) — internal helper consumed by both the public tool and 012's rename handler

tests/
├── services/
│   └── find-and-replace/
│       └── rest-find-and-replace.test.ts   # rest.findAndReplace contract tests (the surface 012 imports)
└── tools/
    └── find-and-replace/
        ├── registration.test.ts       # Description substrings (FR-003), Tool[] shape
        ├── schema.test.ts             # Zod cases: empty search rejected, regex compile error, defaults, type narrowing
        ├── region-detection.test.ts   # CommonMark fence + HTML comment detection; unclosed; overlap union (FR-009)
        ├── pattern-building.test.ts   # Literal escape, wholeWord, flexibleWhitespace, regex flag set
        ├── replacer.test.ts           # Single-pass global, capture groups, wholeWord at region edges (FR-009a), byte-identical no-op
        ├── walker.test.ts             # Dot-prefix exclusion, .md case-insensitive, pathPrefix segment match
        ├── preview-formatter.test.ts  # Structured-match preview shape; ≤40-char context truncation by Unicode code points; newlines preserved
        └── handler.test.ts            # Happy path, dry-run zero-write, mid-sweep failure (FR-021a), multi-vault routing, line-ending preservation on CRLF fixture

README.md                          # +1 attributions section entry (cyanheads + vaultforge + project original-contribution layer note, FR-028)
```

**Structure Decision**: Single-project TypeScript module library. The new tool follows the canonical four-file layout (`schema.ts`, `tool.ts`, `handler.ts` + module-specific helpers under the same directory) used by [`rename-file`](../../src/tools/rename-file/), [`patch-content`](../../src/tools/patch-content/), [`list-tags`](../../src/tools/list-tags/), and [`delete-file`](../../src/tools/delete-file/). The non-trivial helpers (region detection, pattern building, single-pass replacement, vault walking, preview formatting, response assembly) each get their own sibling file because each is independently testable and corresponds to a distinct part of the layered composition (LAYER 1 — pattern + replacer; LAYER 2 — region detection + preview formatter; LAYER 3 — walker + response builder + the `rest.findAndReplace` helper itself). The decomposition is informed by 012's working pattern (`regex-passes.ts` ships separately from `handler.ts` so it can be tested hermetically) and by the brief's explicit three-layer attribution structure.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. The single Principle IV deviation (FR-021a best-effort-continue mid-sweep) is documented in the Constitution Check table above and traces back to a recorded user decision in [spec.md §Clarifications Q2 (Session 2026-05-03)](./spec.md#clarifications). It is a *justified deviation*, not a violation — the alternative (abort + rollback) is impossible without a transaction layer the tool does not own.
