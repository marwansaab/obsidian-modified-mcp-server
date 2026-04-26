---
description: "Task list for re-enabling the patch_content MCP tool with heading-path validation"
---

# Tasks: Re-enable patch_content with Heading-Path Validation

**Input**: Design documents from `/specs/001-reenable-patch-content/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/patch_content.md](./contracts/patch_content.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. FR-009 in [spec.md](./spec.md) mandates automated test coverage for this tool, and Constitution Principle II makes test coverage non-negotiable for any public tool. Test tasks below are not optional.

**Organization**: Tasks are grouped by user story so each can be implemented and tested as a discrete increment. The validator code itself lives in the Foundational phase because both P1 stories depend on it; US2's user-visible value is verified by the negative tests against that validator.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3) — Setup/Foundational/Polish tasks have no story label
- File paths are absolute relative to the repo root (`c:/Github/obsidian-modified-mcp-server/`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the dependencies and the test script the rest of the work needs.

- [X] T001 Install runtime dependency `zod-to-json-schema` by running `npm install --save-exact zod-to-json-schema` from the repo root; verify it appears under `dependencies` in `package.json`.
- [X] T002 Install dev dependencies `vitest` and `nock` by running `npm install --save-dev --save-exact vitest nock` from the repo root; verify both appear under `devDependencies` in `package.json`.
- [X] T003 Add `"test": "vitest run"` and `"test:watch": "vitest"` to the `scripts` block in `package.json`; run `npm test` and confirm it exits successfully (it will report "no test files found" — that is expected at this point).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the validator that both P1 user stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Create the new feature directories: `src/tools/patch-content/` and `tests/tools/patch-content/`.
- [X] T005 Create `src/tools/patch-content/schema.ts` exporting (a) `PatchRequestSchema` — a `zod` object schema for `{ filepath, operation, targetType, target, content, vaultId? }` matching the field types and enums defined in [data-model.md](./data-model.md#entity-patchrequest) and [contracts/patch_content.md §2](./contracts/patch_content.md#2-input-schema-equivalent-json-schema); and (b) `isValidHeadingPath(target: string): boolean` implementing the predicate in [data-model.md](./data-model.md#value-object-headingpath-validation-rule) (split on `::`, require ≥ 2 segments, every segment length ≥ 1, no trim, no escape).
- [X] T006 Add to `src/tools/patch-content/schema.ts` an `assertValidPatchRequest(args: unknown): PatchRequest` function that: (1) calls `PatchRequestSchema.parse(args)` and **lets any `ZodError` propagate unchanged** — its message already contains the offending field paths, satisfying Constitution Principle III ("structured MCP error with the field paths reported by zod"); do **NOT** rewrite zod errors into the heading-rule format. (2) When `targetType === "heading"`, runs `isValidHeadingPath` on the parsed `target`; on failure throws an `Error` whose `message` contains all three required substrings per [data-model.md](./data-model.md#entity-wrappervalidationerror): the rule name (`heading targets must use the full H1::H2[::H3...] path`), `received: "<offending value>"`, and `e.g., "<corrected example>"`. (3) Returns the parsed value typed as `PatchRequest`.

**Checkpoint**: Foundation ready — both P1 stories can now proceed in parallel.

---

## Phase 3: User Story 2 - Reject bare-heading targets up-front (Priority: P1)

**Goal**: Confirm the validator rejects every malformed heading target before any HTTP call is made, with an actionable error message that lets the caller correct the request on the first retry.

**Independent Test**: Run `npm test -- schema.test.ts`; the suite passes with no network activity required (no `nock` setup needed for this phase). Each rejection assertion verifies the three required substrings are present in the error message.

### Tests for User Story 2

- [X] T007 [US2] Create `tests/tools/patch-content/schema.test.ts` covering: (a) **heading-rule rejections** — contract test rows C2–C7 from [contracts/patch_content.md §7](./contracts/patch_content.md#7-test-matrix-contract-level): bare heading (`"Action Items"`), trailing-empty (`"A::B::"`), leading-empty (`"::A::B"`), middle-empty (`"A::::B"`), empty string (`""`), and whitespace-only (`"   "`). Each calls `assertValidPatchRequest` from `src/tools/patch-content/schema.ts`, expects it to throw, and asserts the thrown error's `message` contains: (i) the substring `H1::H2`, (ii) `received: "<that-test's-input>"`, and (iii) `e.g.,`. (b) **zod type-mismatch propagation** — at least two cases that exercise the unchanged `ZodError` path: e.g., `operation: "delete"` (invalid enum) and `filepath: 123` (wrong type). Each asserts that `assertValidPatchRequest` throws and that the error message names the offending field (`operation` and `filepath` respectively), confirming Constitution Principle III's field-path requirement is actually verified. Run `npm test` and confirm all eight cases pass.

**Checkpoint**: User Story 2 is fully functional and independently verified — the validator rejects every malformed heading target with an actionable message.

---

## Phase 4: User Story 1 - Patch under a uniquely-pathed heading (Priority: P1)

**Goal**: Allow agents to surgically modify content beneath a fully-pathed heading without rewriting the whole note. End-to-end this means the tool is registered, the wrapper validates and forwards a valid heading-path patch, and the upstream success surfaces as an MCP success response.

**Independent Test**: With the implementation complete and the test suite mocked via `nock`, calling `handlePatchContent` with a valid 2-segment heading target produces a success response and `nock` confirms exactly one upstream `PATCH /vault/<filepath>` was issued with the expected `Operation`, `Target-Type`, and `Target` headers.

### Implementation for User Story 1

- [X] T008 [P] [US1] Create `src/tools/patch-content/tool.ts` exporting `PATCH_CONTENT_TOOLS: Tool[]` (single entry). Build the entry with `name: 'patch_content'`, an `inputSchema` produced at module-load time by `zodToJsonSchema(PatchRequestSchema, { name: 'PatchRequest' })` (or equivalent — match the JSON Schema shape in [contracts/patch_content.md §2](./contracts/patch_content.md#2-input-schema-equivalent-json-schema)), and a `description` string that contains the three testable phrases listed in [contracts/patch_content.md §1](./contracts/patch_content.md#1-tool-registration): (i) `H1::H2` (the full-path requirement), (ii) `top-level` (the top-level-heading-unreachable note), and (iii) the phrase `literal text contains` (which denotes the literal-`::` unreachable note). The exact prose is at the implementer's discretion as long as those three substrings appear, in any order, somewhere in the description.
- [X] T009 [P] [US1] Create `src/tools/patch-content/handler.ts` exporting `async function handlePatchContent(args: Record<string, unknown>, rest: ObsidianRestService): Promise<CallToolResult>`. Implementation: (1) `const req = assertValidPatchRequest(args);` (2) `await rest.patchContent(req.filepath, req.operation, req.targetType, req.target, req.content);` (3) `return { content: [{ type: 'text', text: 'Content patched successfully' }] };`. Do **NOT** wrap step 2 in `try/catch` — upstream errors must propagate per Constitution Principle IV.
- [X] T010 [US1] Modify `src/tools/write-tools.ts`: import `PATCH_CONTENT_TOOLS` from `./patch-content/tool.js`; spread it into the `WRITE_TOOLS` array; **delete the entire `// DISABLED: patch_content...` commented block** (find by the `// DISABLED:` comment marker — line numbers omitted intentionally because they may drift) including the workaround comment.
- [X] T011 [P] [US1] Modify `src/index.ts`: add `import { handlePatchContent } from './tools/patch-content/handler.js';` to the imports; in the `handleToolCall` switch, **delete the entire `// DISABLED: patch_content handler...` commented block** (find by the `// DISABLED:` comment marker — line numbers omitted intentionally because they may drift) and replace it with an active case: `case 'patch_content': return handlePatchContent(args, rest);`. (Parallel with T010 — different files, no mutual dependency.)
- [X] T012 [P] [US1] Create `tests/tools/patch-content/handler.test.ts` covering contract test rows C1, C2b, C8, C9 from [contracts/patch_content.md §7](./contracts/patch_content.md#7-test-matrix-contract-level). Use the test harness pattern in [quickstart.md §4](./quickstart.md#4-write-the-tests): construct an `ObsidianRestService` pointing at `https://localhost:27123`, set up `nock('https://localhost:27123')` in `beforeEach`, `nock.cleanAll()` and `nock.enableNetConnect()` in `afterEach`. **C1: heading patch — verify FR-005 headers explicitly**: prime nock with `.patch('/vault/note.md').matchHeader('Operation', 'append').matchHeader('Target-Type', 'heading').matchHeader('Target', encodeURIComponent('Weekly Review::Action Items')).matchHeader('Content-Type', /text\/markdown/).reply(200, '')`; call `handlePatchContent` with `target: 'Weekly Review::Action Items'`; expect `result.isError` falsy, response text `Content patched successfully`, and `scope.isDone()` true. The `matchHeader` chain is what verifies FR-005 — without it, the test would pass even if `rest.patchContent` stopped sending one of the documented headers. **C2b: handler-level bare-target rejection — verify FR-003 / SC-001 at the integration boundary**: do **not** prime any nock scope; call `nock.disableNetConnect()` so any unintended HTTP would throw `NetConnectNotAllowedError`; submit `targetType: 'heading', target: 'Action Items'` to `handlePatchContent`; expect rejection with the heading-rule error message (same three substrings as T007). The combination of "no scope primed" + `disableNetConnect()` means a buggy handler that omitted `assertValidPatchRequest` (or called it after `rest.patchContent`) would surface a `NetConnectNotAllowedError` rather than the expected validation error — distinguishable in the assertion. **C8: block pass-through**: `targetType: 'block'`, `target: 'whatever'`, prime nock with the full header set: `.patch('/vault/note.md').matchHeader('Operation', 'append').matchHeader('Target-Type', 'block').matchHeader('Target', encodeURIComponent('whatever')).matchHeader('Content-Type', /text\/markdown/).reply(200, '')`; expect success and `scope.isDone()` true (no heading-path validator exercised). **C9: frontmatter pass-through**: `targetType: 'frontmatter'`, `target: 'somefield'`, prime nock with the full header set as in C8 but with `Target-Type: 'frontmatter'`; expect success. Asserting the full header set on C8 and C9 is defensive: it would catch a hypothetical regression in `rest.patchContent` that conditionally omitted a header for non-heading target types.
- [X] T013 [P] [US1] Create `tests/tools/patch-content/registration.test.ts` covering contract test row C12. Import `ALL_TOOLS` from `src/tools/index.ts`. Locate the entry whose `name === 'patch_content'`; assert that `entry.description` contains, case-insensitively, all three required testable phrases: (i) `H1::H2`, (ii) `top-level`, and (iii) `literal text contains`. The third phrase is the only thing that distinguishes a description that mentions the literal-`::` unreachable case from one that does not — checking for the bare substring `::` would be trivially satisfied by `H1::H2` and would not actually verify FR-001's third constraint. (Depends on T010 wiring `PATCH_CONTENT_TOOLS` into `WRITE_TOOLS`.)

**Checkpoint**: User Story 1 is fully functional — `tools/list` exposes `patch_content`, valid heading paths reach the upstream, and successful upstream responses surface as MCP success. With Phase 3 + Phase 4 done, the MVP is shippable.

---

## Phase 5: User Story 3 - Surface upstream errors verbatim (Priority: P2)

**Goal**: Confirm that errors from the upstream Local REST API plugin propagate to the MCP caller with their status code and message preserved (Constitution Principle IV).

**Independent Test**: Run `npm test -- handler.test.ts`; the C10 and C11 cases pass, demonstrating that upstream non-2xx responses and transport-level failures both surface as `isError: true` MCP responses with the upstream status code and message in the text payload.

### Tests for User Story 3

- [X] T014 [US3] Add to `tests/tools/patch-content/handler.test.ts` the contract test rows C10, C10b, and C11 from [contracts/patch_content.md §7](./contracts/patch_content.md#7-test-matrix-contract-level). **C10 (404 not-found)**: valid request, `nock` returns `404` with body `{ errorCode: 40400, message: "File or heading not found" }`; expect `handlePatchContent` to reject with a message matching `/Obsidian API Error 40400.*File or heading not found/`. **C10b (401 auth failure)**: valid request, `nock` returns `401` with body `{ errorCode: 40100, message: "Invalid API key" }`; expect rejection with a message matching `/Obsidian API Error 40100.*Invalid API key/`. (C10b is structurally identical to C10 but explicitly exercises spec User Story 3's "authentication failure" scenario.) **C11 (transport error)**: valid request, `nock.disableNetConnect()` plus a deliberately unrouted scope so the call surfaces as a transport error; expect the rejection's message to contain `Obsidian API Error -1` and the underlying network error text. The handler **must not** catch any of these — verify by asserting `handlePatchContent` itself rejects (rather than returning a structured success).

**Checkpoint**: All three user stories are independently verified. The upstream-error chain of custody is demonstrated.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the constitution gates pass and the feature is shippable.

- [X] T015 [P] Run `npm run lint` from the repo root; resolve any reported issues so it exits with code 0.
- [X] T016 [P] Run `npm run typecheck` from the repo root; resolve any type errors so it exits with code 0.
- [X] T017 [P] Run `npm run build` from the repo root; verify `dist/` is produced without errors.
- [X] T018 Run `npm test` from the repo root; verify all 14 contract tests (C1–C12 plus C10b and C2b) pass, in addition to the two zod-error-propagation cases added by T007.
- [X] T019 Smoke-tested against a real Obsidian instance via `scripts/smoke-patch-content.ts`. All 4 checks passed: (1) setup PUT, (2) valid heading patch — bullet landed under `## Action Items` as expected, (3) bare-target rejection with all 3 message components AND file unchanged (proving validator runs before HTTP), (4) upstream-error propagation — non-existent heading produced `Obsidian API Error 40080: The patch you provided could not be applied to the target content` (status code + upstream message preserved per Constitution IV).
- [X] T020 Author the PR description per the Constitution Governance section: include a one-line statement confirming Principles I–IV were considered, link to [plan.md](./plan.md), and call out the new dev-tooling additions (vitest, nock, zod-to-json-schema) as the first test infrastructure in the repo. *(Draft delivered in implementation handoff.)*

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 → T002 → T003 (all touch `package.json`; cannot parallelize).
- **Foundational (Phase 2)**: T004 → T005 → T006. Blocks every user story.
- **User Story 2 (Phase 3)**: depends on Foundational. T007 only.
- **User Story 1 (Phase 4)**: depends on Foundational. Internal graph below. **Can run in parallel with Phase 3** if staffed across two contributors.
- **User Story 3 (Phase 5)**: depends on Phase 4 (uses the same `handler.test.ts` file created in T012; reasonable to write together but tracked as separate task for traceability).
- **Polish (Phase 6)**: depends on all preceding phases.

### User Story Dependencies

- **User Story 1 (P1)** and **User Story 2 (P1)** can be implemented in parallel after Phase 2; they share `schema.ts` (foundational) but otherwise touch disjoint files.
- **User Story 3 (P2)** depends on Phase 4 (specifically T012) because both add cases to the same `handler.test.ts` file.

### Within User Story 1 (Phase 4)

```text
T005 ─┬─ T008 (tool.ts)         ─── T010 (write-tools.ts edit) ─┐
      │                                                          ├─ T013 (registration test)
      └─ T009 (handler.ts) ─────┬─ T011 (index.ts edit)
                                └─ T012 (handler tests C1, C8, C9)
```

T008 and T009 run in parallel after T005/T006. T010, T011, T012 run in parallel after their respective deps. T013 waits on T010.

### Parallel Opportunities

- T008 and T009 in parallel (different new files; both depend only on Phase 2).
- T010 and T011 in parallel (different existing files; T010 needs T008, T011 needs T009).
- T010, T011, T012 can all run in parallel once T008 and T009 are done (different files; T012 needs T009 only).
- T013 can run in parallel with T012 once T010 lands.
- Phase 3 (T007) can run in parallel with all of Phase 4 if two people are working — both depend only on Phase 2.
- T015, T016, T017 in parallel (independent gate checks).

---

## Parallel Example: User Story 1 implementation kickoff

Once T005 and T006 land, two contributors can pick up:

```text
Contributor A: T008 — Create src/tools/patch-content/tool.ts
Contributor B: T009 — Create src/tools/patch-content/handler.ts
```

After both land:

```text
Contributor A: T010 — Edit src/tools/write-tools.ts
Contributor B: T011 — Edit src/index.ts
Contributor C: T012 — Create tests/tools/patch-content/handler.test.ts (handler-only tests)
```

After T010 lands: T013 (registration test) can begin.

---

## Implementation Strategy

### MVP scope

**Phases 1 + 2 + 3 + 4** = MVP. Once these phases are complete, the tool is registered, validates inputs strictly, and successfully patches notes whose heading paths are well-formed. Both P1 stories are satisfied.

**Phase 5** adds explicit test coverage of the upstream-error path (US3, P2). The behavior already works at that point — it is inherited from the existing `safeCall` + top-level handler — but the tests make the property regressable.

### Incremental delivery

1. Land Phases 1 + 2 + 3 in one PR — establishes test infrastructure and the validator with negative-path coverage. The tool is **not yet registered** at this point; only `schema.test.ts` exists.
2. Land Phase 4 in a second PR — registers the tool, wires the handler, adds happy-path and pass-through tests. MVP shippable.
3. Land Phase 5 + Phase 6 in a third PR — error-propagation tests + gates + smoke test + constitution-aligned PR description.

Single-PR strategy is also valid for a feature this small; the staged option exists for reviewers who prefer narrower diffs.

---

## Notes

- `[P]` tasks operate on different files with no incomplete-task dependencies.
- `[Story]` labels exist only on Phase 3, 4, 5 tasks (per template).
- Every test task asserts properties from [contracts/patch_content.md §7](./contracts/patch_content.md#7-test-matrix-contract-level); contract IDs (C1–C12) are referenced inline so traceability is bidirectional.
- Tests are **not** optional in this feature — FR-009 mandates them and Constitution Principle II makes them non-negotiable for any public tool.
- Per the constitution's Quality Gates section, T015–T018 are **all** required to pass before merge. T019 (smoke test) is required by the quickstart's Definition of Done; if a real Obsidian instance is not available in the contributor's environment, document this in the PR and request a reviewer with access to perform it.
- Avoid: changing the existing service-layer `patchContent` method, refactoring sibling tools to use zod, or introducing a new error taxonomy — all out of scope.
