---
description: "Task list for Fix Graph Tools (specs/004)"
---

# Tasks: Fix Graph Tools

**Input**: Design documents from `/specs/004-fix-graph-tools/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Resolution path** (from [research.md R2](research.md#r2--resolution-path-selection)): **Path A** — wire the existing implementations. FR-014 (Path C contract test) is therefore moot; FR-006 + FR-013 are the active test FRs.

**Tests**: REQUIRED — Constitution Principle II is non-negotiable, and FR-006 + FR-013 mandate specific test artifacts. Test tasks are included in this list, not optional.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested as an independent increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks).
- **[Story]**: Which user story this task belongs to (US1, US2, US3).
- File paths are absolute from repo root.

## Path Conventions

Single TypeScript project — `src/` and `tests/` at repo root. New code lives under `src/tools/graph/` and `tests/tools/graph/`, matching the layout used by `patch-content` and `surgical-reads`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new directories and confirm the toolchain is ready. The branch (`004-fix-graph-tools`) already exists.

- [ ] T001 Create directory `src/tools/graph/` (will hold `schemas.ts`, `handlers.ts`, `tool.ts`)
- [ ] T002 [P] Create directory `tests/tools/graph/` (will hold `registration.test.ts`, `schema.test.ts`, `handler-vault-stats.test.ts`, `handler-per-note.test.ts`, `smoke.test.ts`)
- [ ] T003 [P] Confirm `npm run lint`, `npm run typecheck`, `npm run test` all pass on the current `main` baseline as a sanity check before changes (no work to do if green; investigate if not)

**Checkpoint**: Directories exist; baseline is green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Service-layer + type changes that EVERY user story depends on. Without these, neither the wiring (US1) nor the tests (US2) can land.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Edit `src/types.ts` — add an exported `AggregationEnvelope<T>` type alias (shape: `T & { skipped: number; skippedPaths: string[] }`) for use by handlers. Existing types (`VaultStats`, `NoteConnections`) remain unchanged.
- [ ] T005 Edit `src/services/graph-service.ts` — add private instance fields `lastSkipped: number` (init 0) and `lastSkippedPaths: string[]` (init []). Reset both at the start of `buildGraph()`. Wrap the per-file `fs.readFile` + parse loop (lines 82-113) in `try/catch`; on any error, increment `lastSkipped` and push the relative path onto `lastSkippedPaths`. Add public getters `getLastSkipped()` and `getLastSkippedPaths()` returning the current values.
- [ ] T006 Edit `src/services/graph-service.ts` — align `getNoteConnections` not-found message (line 286) from `Note not found in graph: ${filepath}` to `note not found: ${filepath}`. Align `findPathBetweenNotes` source-missing (line 320) and target-missing (line 323) messages to `note not found: ${source}` and `note not found: ${target}` respectively. When BOTH endpoints are missing, throw a single `note not found: ${source}, ${target}` error after checking both — restructure the two checks into one combined check that reports both missing endpoints together. (Vault-id suffix is added by the handler, NOT by the service — see R5.)
- [ ] T007 Create `src/tools/graph/schemas.ts` — define seven zod schemas (`GetVaultStatsRequestSchema`, `GetVaultStructureRequestSchema`, `FindOrphanNotesRequestSchema`, `GetNoteConnectionsRequestSchema`, `FindPathBetweenNotesRequestSchema`, `GetMostConnectedNotesRequestSchema`, `DetectNoteClustersRequestSchema`) per [data-model.md](data-model.md) shapes. Export inferred types and `assertValid*Request(args)` functions for each — pattern: `return Schema.parse(args)`. No structural validators (no `assertValidPatchRequest`-style extra logic) needed for graph tools.

**Checkpoint**: `npm run typecheck` passes. Service tracks skipped data and uses the FR-012 error format. Zod schemas are ready for handlers and `tool.ts` to consume.

---

## Phase 3: User Story 1 - Eliminate the contract mismatch (Priority: P1) 🎯 MVP

**Goal**: Every advertised graph tool actually runs and returns a recognisable payload (Path A). No caller sees `Unknown tool: <name>` for a tool listed in the catalog.

**Independent Test**: With `OBSIDIAN_VAULT_PATH` set, call each of the seven tools through a live MCP client. Pass criterion: zero `Unknown tool` errors; each call returns a recognisable payload of the appropriate shape (per the contracts).

### Implementation for User Story 1

- [ ] T008 [US1] Create `src/tools/graph/handlers.ts` — define seven async handler functions (`handleGetVaultStats`, `handleGetVaultStructure`, `handleFindOrphanNotes`, `handleGetNoteConnections`, `handleFindPathBetweenNotes`, `handleGetMostConnectedNotes`, `handleDetectNoteClusters`). Each:
  1. Validates `args` via the corresponding `assertValid*Request` from `./schemas.js`.
  2. Calls the appropriate `service.method(...)` (where `service: GraphService` is passed in by the dispatcher).
  3. **For aggregation tools**: wraps the result in `AggregationEnvelope<T>` reading `service.getLastSkipped()` and `service.getLastSkippedPaths().slice(0, 50)`.
  4. **For per-note tools** (`handleGetNoteConnections`, `handleFindPathBetweenNotes`): catches `Error` thrown by the service, and IF the message starts with `note not found:` AND the validated args include an explicit `vaultId`, re-throws with ` (vault: <id>)` appended; otherwise lets the error propagate unchanged.
  5. Returns `{ content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] }`.
- [ ] T009 [P] [US1] Create `src/tools/graph/tool.ts` — import the seven zod schemas from `./schemas.js`, derive `inputSchema` for each via `zodToJsonSchema(Schema, { $refStrategy: 'none' })`, and export `GRAPH_TOOLS: Tool[]` containing the seven entries. Follow the pattern in [src/tools/patch-content/tool.ts](../../src/tools/patch-content/tool.ts).
- [ ] T010 [US1] Update each tool's `description` field in `src/tools/graph/tool.ts` to state the precondition explicitly (FR-008). Required text: `"Requires OBSIDIAN_VAULT_PATH to be set for the targeted vault."` MUST appear in each of the seven descriptions. For per-note tools (FR-012), the description MUST additionally state: `"Returns a precondition-style error 'note not found: <path>' when the target note is not present in the vault — distinct from 'found but no connections'/'no path between endpoints'."`
- [ ] T011 [US1] Update `src/tools/index.ts` — replace the import `import { GRAPH_TOOLS } from './graph-tools.js';` with `import { GRAPH_TOOLS } from './graph/tool.js';`. The `ALL_TOOLS` spread stays unchanged.
- [ ] T012 [US1] Delete `src/tools/graph-tools.ts` (the legacy hand-written JSON schema file). Confirm `npm run typecheck` and `npm run lint` still pass.
- [ ] T013 [US1] Edit `src/index.ts` — three changes in this single edit:
  1. **Export the class**: change `class ObsidianMCPServer` (line 48) to `export class ObsidianMCPServer` so the smoke test (T019) can `import { ObsidianMCPServer }` and instantiate it.
  2. **Make the dispatcher accessible**: change `private async handleToolCall(` (line 264) to `public async handleToolCall(` so the smoke test can invoke it directly. (Constitution Principle I's modularity rule isn't violated by exposing a single method that already serves as the public entry point for tool dispatch.)
  3. **Wire the seven graph dispatcher branches**: add seven new `case` branches to the `switch (name)` in `handleToolCall` (between `case 'pattern_search':` at line 462 and `default:` at line 475). Each case:
     - Calls `this.getGraphService(vaultId)` to obtain the `GraphService` instance (this enforces FR-009 — throws if `vault.vaultPath` is unset).
     - Calls the corresponding handler from `./tools/graph/handlers.js`, passing `args` and the service.
     - Returns the handler's result.

  Add the imports at the top:

  ```ts
  import {
    handleGetVaultStats,
    handleGetVaultStructure,
    handleFindOrphanNotes,
    handleGetNoteConnections,
    handleFindPathBetweenNotes,
    handleGetMostConnectedNotes,
    handleDetectNoteClusters,
  } from './tools/graph/handlers.js';
  ```

**Checkpoint**: User Story 1 is functionally complete. Manual verification (per [quickstart.md](quickstart.md) steps 1-2) succeeds: every graph tool returns a real payload through a live MCP client, no `Unknown tool` errors. Phase 4 tests are not yet in place but the FUNCTION is delivered.

---

## Phase 4: User Story 2 - Regression test guards `get_vault_stats` and the smoke net (Priority: P2)

**Goal**: A future contributor refactors the dispatcher (as the patch-content work likely did) and the regression suite catches the contract drift before it ships. FR-006 covers `get_vault_stats` deeply; FR-013 covers the other six with a parametrized smoke test.

**Independent Test**: Run `npm run test` on a clean checkout. The four new test files all pass. Then artificially comment out one of the seven `case` branches in `src/index.ts`; re-run tests — the deep test fails for `get_vault_stats`, or the corresponding smoke-test row fails (with the row identifier matching the affected tool name) for any of the other six.

### Tests for User Story 2 ⚠️

> **NOTE**: These tests are required by spec FRs (FR-006, FR-013) and Constitution Principle II. They are NOT optional.

- [ ] T014 [P] [US2] Create `tests/tools/graph/registration.test.ts` — for each of the seven tool names: assert it appears in `ALL_TOOLS`, has a derived `inputSchema` of `type: 'object'`, and its `description` contains the literal substring `OBSIDIAN_VAULT_PATH` (FR-008 verification). For the two per-note tools, additionally assert the description contains BOTH (a) the literal substring `note not found:` AND (b) the disambiguation phrase `distinct from 'found but no connections'` — together these guard the full FR-012 contract per analyze remediation I3. Pattern after [tests/tools/patch-content/registration.test.ts](../../tests/tools/patch-content/registration.test.ts).
- [ ] T015 [P] [US2] Create `tests/tools/graph/schema.test.ts` — for each of the seven `assertValid*Request` validators, assert one happy-path call returns the typed object AND one failure case throws (e.g. `assertValidGetNoteConnectionsRequest({})` throws `ZodError` whose message references `filepath`). All seven failure cases MUST be present (one per tool; constitution Principle II requires the validation-failure half for *every* registered tool):
  - `get_vault_stats` with `vaultId: 42` (type failure on optional `vaultId: string`)
  - `get_vault_structure` with `maxDepth: -1` (negative integer rejected by `.nonnegative()`)
  - `find_orphan_notes` with `includeBacklinks: 'yes'` (type failure on optional `includeBacklinks: boolean`)
  - `get_note_connections` with `{}` (missing required `filepath`)
  - `find_path_between_notes` with `{ target: 'b.md' }` (missing required `source`)
  - `find_path_between_notes` with `{ source: 'a.md' }` (missing required `target`)
  - `get_most_connected_notes` with `metric: 'centrality'` (invalid enum value)
  - `detect_note_clusters` with `minClusterSize: 0` (rejected by `.positive()`)
  Note: that's eight failure assertions across seven tools (`find_path_between_notes` gets two — one per required field). The "happy-path" half here tests the validator's typed-return contract, NOT the tool's end-to-end happy path; tool-level happy paths are covered by T016 + T017.
- [ ] T016 [P] [US2] Create `tests/tools/graph/handler-vault-stats.test.ts` — FR-006 deep test:
  1. Create a stub `GraphService` (or use `vi.spyOn`) whose `getVaultStats()` returns a fixed `{ totalNotes: 42, totalLinks: 100, orphanCount: 3, tagCount: 17, clusterCount: 5 }` and whose `getLastSkipped()` returns `2`, `getLastSkippedPaths()` returns `['bad1.md', 'bad2.md']`.
  2. Call `await handleGetVaultStats({}, stubService)`.
  3. Assert: `stubService.getVaultStats` was called exactly once with no arguments.
  4. Assert: `result.content[0].text` (parsed as JSON) equals `{ totalNotes: 42, totalLinks: 100, orphanCount: 3, tagCount: 17, clusterCount: 5, skipped: 2, skippedPaths: ['bad1.md', 'bad2.md'] }`.
  5. Add a second test case asserting truncation: when `getLastSkippedPaths()` returns 60 entries, the envelope's `skippedPaths` has exactly 50 entries while `skipped` reports 60.
- [ ] T017 [P] [US2] Create `tests/tools/graph/handler-per-note.test.ts` — happy-path coverage for the two per-note tools (constitution Principle II requires every registered tool to have a happy-path test; the FR-013 smoke deliberately fires error paths for these two and so does NOT satisfy Principle II for them).
  1. **`handleGetNoteConnections` happy path**: stub `GraphService.getNoteConnections('Daily/2026-04-26.md')` to return `{ filepath: 'Daily/2026-04-26.md', outgoingLinks: ['Projects/Inbox.md'], backlinks: ['Index.md'], tags: ['daily'] }`. Call the handler with `{ filepath: 'Daily/2026-04-26.md' }`. Assert: service called once with the supplied filepath; `result.content[0].text` (parsed as JSON) equals the stubbed return value (no envelope per FR-011 carve-out).
  2. **`handleGetNoteConnections` `vaultId` propagation**: stub the service's not-found throw to surface `note not found: missing.md`. Call the handler with `{ filepath: 'missing.md', vaultId: 'work' }`. Assert: the error message ends with `(vault: work)` (handler-side suffix per R5 / FR-012).
  3. **`handleFindPathBetweenNotes` happy path**: stub `GraphService.findPathBetweenNotes('a.md', 'c.md')` to return `['a.md', 'b.md', 'c.md']`. Call the handler with `{ source: 'a.md', target: 'c.md' }`. Assert: `result.content[0].text` parses to `{ path: ['a.md', 'b.md', 'c.md'] }`.
  4. **`handleFindPathBetweenNotes` no-path-found**: stub the service to return `null` (both endpoints exist, no walk connects them). Call the handler. Assert: `result.content[0].text` parses to `{ path: null }` (the FR-012 distinction between "not found" error and "no path" success).
- [ ] T018 [P] [US2] Create `tests/tools/graph/smoke.test.ts` — FR-013 parametrized smoke test PLUS payload-shape assertions for the four aggregation rows (constitution Principle II — happy-path code must be asserted, not just exercised):
  1. **Test setup** (per analyze remediations I1 + M1): vitest's `vi.mock(...)` factory is **hoisted** to the top of the module — above all imports and lifecycle hooks — so the tmp-dir variable it references must be created during the same hoisted phase. Use `vi.hoisted(...)` to share the tmp dir between mock factory and the rest of the file:

      ```ts
      import { describe, it, expect, afterAll, vi } from 'vitest';
      import * as fs from 'node:fs';

      const { TMP_DIR } = vi.hoisted(() => {
        const fsLocal = require('node:fs') as typeof import('node:fs');
        const pathLocal = require('node:path') as typeof import('node:path');
        const osLocal = require('node:os') as typeof import('node:os');
        return { TMP_DIR: fsLocal.mkdtempSync(pathLocal.join(osLocal.tmpdir(), 'graph-smoke-')) };
      });

      vi.mock('../../../src/config.js', () => ({
        getConfig: () => ({
          defaultVaultId: 'test',
          vaults: {
            test: {
              id: 'test',
              apiKey: 'unused',
              host: 'localhost',
              port: 27123,
              protocol: 'http' as const,
              vaultPath: TMP_DIR,
              verifySsl: false,
            },
          },
          graphCacheTtl: 300,
          verifySsl: false,
        }),
      }));

      afterAll(() => fs.rmSync(TMP_DIR, { recursive: true, force: true }));
      ```

      The directory stays empty for the whole test run — we only need a valid `vaultPath` so `getGraphService` doesn't throw the precondition error before dispatch is reached. Aggregation tools then aggregate over zero notes and return well-formed empty payloads; per-note tools fail with `note not found:` (acceptable per FR-013).
  2. `describe.each([...])` over the six tool rows from the contracts (one per non-`get_vault_stats` tool, with the minimal valid args specified in each contract's "Smoke-test row" section).
  3. For each row: instantiate `ObsidianMCPServer` (which T013 made exportable). Invoke the dispatcher via `await server.handleToolCall(name, args)` (T013 made `handleToolCall` public for this purpose).
  4. Assert (always): `result.content[0].text` does NOT contain the substring `Unknown tool`. This is the FR-013 dispatch-routing assertion.
  5. **Additional shape assertions per row** (closes constitution Principle II happy-path gap for the four aggregation tools — for the two per-note tools, only step 4 applies because the smoke args deliberately reference non-existent notes):
     - `get_vault_structure`: parsed JSON has top-level `tree` (object), `skipped` (number), `skippedPaths` (array).
     - `find_orphan_notes`: parsed JSON has top-level `orphans` (array), `skipped` (number), `skippedPaths` (array).
     - `get_most_connected_notes`: parsed JSON has top-level `notes` (array), `skipped` (number), `skippedPaths` (array).
     - `detect_note_clusters`: parsed JSON has top-level `clusters` (array), `skipped` (number), `skippedPaths` (array).
     - `get_note_connections`: NO shape assertion (smoke args force a `note not found:` error per the contract — happy path is covered by T017 instead).
     - `find_path_between_notes`: NO shape assertion (same reason — happy path covered by T017).
  6. The test name (visible in vitest output) MUST include the tool name so a failure identifies the affected dispatch branch immediately (SC-006).

**Checkpoint**: All five test files (registration, schema, handler-vault-stats, handler-per-note, smoke) pass. Reverse-validation (per [quickstart.md](quickstart.md) "Reverse-validation" section): commenting out one dispatcher case causes the corresponding test to fail with a clear, named error — proves SC-003 and SC-006 hold.

---

## Phase 5: User Story 3 - README reflects post-fix reality (Priority: P3)

**Goal**: A new user reads the README's "Available tools" section and what they read matches what the server delivers — under Path A, the seven graph tools are listed with the `OBSIDIAN_VAULT_PATH` precondition stated.

**Independent Test**: Diff the README's "Available tools" section against `ALL_TOOLS` (the live MCP catalog). Every graph tool in `ALL_TOOLS` should appear in the README; preconditions stated in the README should match those enforced at runtime.

### Implementation for User Story 3

- [ ] T019 [US3] Edit `README.md` — locate the "Available tools" section (or equivalent — verify exact heading wording). For each of the seven graph tools, add an entry that:
  1. States the tool name.
  2. Gives a one-line description matching the schema description.
  3. States the precondition: `Requires OBSIDIAN_VAULT_PATH to be set for the targeted vault.`
  4. For per-note tools, mentions the not-found contract: returns `note not found: <path>` for missing targets.
  5. References the contract file under `specs/004-fix-graph-tools/contracts/` for the full I/O shape.
- [ ] T020 [US3] If the README has a top-level features list or feature-flag table that previously omitted graph tools (or marked them as broken), update those locations to reflect that graph tools work and require `OBSIDIAN_VAULT_PATH`. (This task is conditional — verify the README structure first; if no such section exists, this task is a no-op and can be marked complete.)

**Checkpoint**: All three user stories are independently functional and documented.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Pre-merge quality gates. The constitution requires lint + typecheck + build + test all to pass before merge.

- [ ] T021 Run `npm run lint` — fix any new warnings introduced by Phases 2-5. Zero warnings required (constitution Section 2).
- [ ] T022 Run `npm run typecheck` — zero errors required (constitution Section 2). Pay particular attention to the new `AggregationEnvelope<T>` generic and the handler return types.
- [ ] T023 Run `npm run build` — confirm `tsup` produces a clean bundle with the new graph module included.
- [ ] T024 Run `npm run test` — full suite passes (existing patch-content + surgical-reads tests still green; new graph tests all pass).
- [ ] T025 [P] Reverse-validate per [quickstart.md "Reverse-validation"](quickstart.md#reverse-validation-optional-but-recommended): comment out one of the seven dispatcher cases, re-run tests, confirm the corresponding test fails with a named error, then restore.
- [ ] T026 [P] Manual verification per [quickstart.md "Manual verification"](quickstart.md#manual-verification-against-a-real-mcp-client) steps 1-5 against a real Obsidian vault: `list_vaults` shows `hasVaultPath: true`; all seven tools called and return non-error responses; `skipped`/`skippedPaths` contract works when a deliberately-corrupt file is added; precondition error fires when `OBSIDIAN_VAULT_PATH` is unset; `note not found:` error fires for missing per-note targets.
- [ ] T027 PR description includes the constitution one-liner: `Principles I–IV considered.` per Constitution Section 4 / Compliance review.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1. Blocks ALL user stories. T004-T007 can run in parallel where marked, but T005 and T006 both edit `src/services/graph-service.ts` and MUST be sequential.
- **Phase 3 (US1)**: Depends on Phase 2. T008 depends on T007 (handlers import schemas). T009 can run in parallel with T008. T010 depends on T009 (edits the same file). T011 depends on T009 (imports the new tool array). T012 depends on T011. T013 depends on T008 (imports the handlers).
- **Phase 4 (US2)**: Depends on Phase 3. All five test files (T014, T015, T016, T017, T018) are mutually parallel — they touch different files. They can all start as soon as Phase 3 is complete.
- **Phase 5 (US3)**: Depends on Phase 3 conceptually (the README documents what now works), but technically only depends on the final tool descriptions being settled (T010). Can run in parallel with Phase 4.
- **Phase 6 (Polish)**: Depends on all prior phases. T021-T024 are sequential gate checks. T025 and T026 can run in parallel with each other once T024 has passed.

### User Story Dependencies

- **US1 (P1)**: No dependencies on other stories. Delivers the core fix (MVP).
- **US2 (P2)**: Depends on US1's handlers existing (you can't test what isn't there). Per Constitution Principle II, US2 ships in the SAME PR as US1.
- **US3 (P3)**: Depends on US1's tool descriptions being final (T010), but conceptually independent. Can ship in the same PR or a follow-up PR.

### Parallel Opportunities

- T002 and T003 in parallel within Phase 1.
- T004 and T007 in parallel within Phase 2 (different files: `src/types.ts` vs `src/tools/graph/schemas.ts`).
- T008 and T009 in parallel within Phase 3 (different files: `handlers.ts` vs `tool.ts`).
- All five test files (T014, T015, T016, T017, T018) in parallel within Phase 4.
- T025 and T026 in parallel within Phase 6 (independent verification activities).

---

## Parallel Example: Phase 4 (User Story 2 tests)

```bash
# Once Phase 3 is complete, launch all five test files in parallel:
Task: "Create tests/tools/graph/registration.test.ts (T014)"
Task: "Create tests/tools/graph/schema.test.ts (T015)"
Task: "Create tests/tools/graph/handler-vault-stats.test.ts (T016)"
Task: "Create tests/tools/graph/handler-per-note.test.ts (T017)"
Task: "Create tests/tools/graph/smoke.test.ts (T018)"
```

---

## Implementation Strategy

### Single-PR delivery (recommended for this fix)

Constitution Principle II requires that a tool's tests land in the same change as the tool itself. So all of US1 + US2 land in one PR. US3 (README) can ride in the same PR or a follow-up.

1. Complete Phase 1 + 2 (Setup + Foundational).
2. Complete Phase 3 (US1) — wiring + handlers + tool registration + dispatcher cases.
3. Complete Phase 4 (US2) — four test files, all four pass.
4. Complete Phase 5 (US3) — README updates.
5. Complete Phase 6 (Polish) — lint/typecheck/build/test gates plus manual verification.
6. Open PR; reference `Principles I–IV considered` per constitution.

### MVP-first variant (if circumstances force splitting)

If the team wants to ship the fix urgently without README updates:

1. Phases 1 + 2 + 3 + 4 + 6 in one PR (US1 + US2 + gates).
2. Follow-up PR with Phase 5 (US3 README) only.

US3 alone changes no code, so it's safe to ship separately.

### Reverse-validation as continuous-integration check

Once the test suite (Phase 4) is in place, the reverse-validation activity (T025) becomes a useful manual check anyone can run before merging dispatcher refactors in the future. Consider adding it as an entry in [quickstart.md](quickstart.md) "Pre-merge checklist" for any change that touches `src/index.ts`.

---

## Notes

- **Auto mode** is active in this conversation, so subsequent `/speckit-implement` invocations will execute these tasks autonomously. Each task is scoped tightly enough that an implementing agent can complete it from this file alone — no hidden context required.
- **No new dependencies** are added by this feature. Every package the implementation needs (`graphology`, `graphology-*`, `zod`, `zod-to-json-schema`, `vitest`, `nock`) is already in `package.json`.
- **Path A is locked in**. If investigation later reveals something Hypothesis 1 missed (it shouldn't — the evidence in research.md R1 is comprehensive), the fallback is to revisit `/speckit-plan` rather than to continue executing these tasks against a wrong assumption.
- **FR-014** (Path C contract test) is intentionally NOT in this task list — Path A makes it moot. If the team ever ships Path C in the future, regenerate tasks from a fresh `/speckit-plan` invocation against a Path-C version of the spec.
