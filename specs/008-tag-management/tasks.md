---

description: "Task list for feature 008-tag-management (`list_tags`)"
---

# Tasks: Tag Management — `list_tags`

**Input**: Design documents from `/specs/008-tag-management/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/list_tags.md](contracts/list_tags.md), [quickstart.md](quickstart.md)

**Tests**: Tests are REQUIRED for this feature. The repository's
constitution (Principle II — *Public Tool Test Coverage*) is
NON-NEGOTIABLE: every public tool MUST ship with at least one
happy-path test and one input-validation-or-upstream-error test in
the same change. The plan therefore lists test tasks alongside
implementation tasks; do not skip them.

**Organization**: Only one user story remains in this feature
(US1 — `list_tags`) following the Phase 0 scope reduction documented
in [research.md](research.md) §R1. All implementation tasks live in
the US1 phase; there is no Phase 2 foundational work distinct from
US1, and no Phase 4/5 user stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g., US1)
- File paths are absolute relative to the repository root

## Path Conventions

Single project. Source under `src/`, tests under `tests/`. Per-tool
directories follow the existing convention used by `delete-file`,
`patch-content`, `surgical-reads`, `graph`. See
[plan.md](plan.md) §"Project Structure".

---

## Phase 1: Setup

**Purpose**: Confirm the baseline is clean before edits begin. No
new project scaffolding is required — vitest, eslint, tsup, and the
per-tool directory pattern are already in place.

- [ ] T001 Run `npm install`, `npm run lint`, `npm run typecheck`, and `npm test` from repo root and confirm all four pass on the current branch (`008-tag-management`) before any source edits

**Checkpoint**: Baseline clean — implementation can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None for this feature. The single user story (US1)
contains all implementation work; there are no shared modules or
infrastructure pieces that block other stories because there are no
other stories. The service-method addition that other stories
*would* depend on (`ObsidianRestService.listTags()`) lives inside
US1 and is exercised only by US1, so it is sequenced as a US1
implementation task.

(Phase deliberately empty.)

---

## Phase 3: User Story 1 — Read the authoritative tag index (Priority: P1) 🎯 MVP

**Goal**: Expose a new MCP tool `list_tags` that calls the upstream
`GET /tags/` and forwards the body verbatim to the caller. Errors
flow through the existing typed-error surface unchanged.

**Independent Test**: Per [spec.md](spec.md) "Independent Test"
under Story 1 and the six-step recipe in
[quickstart.md](quickstart.md). After this phase completes, the
tool is fully functional and shippable as the feature MVP.

### Tests for User Story 1 (REQUIRED — Constitution Principle II)

- [ ] T002 [P] [US1] Write `tests/tools/list-tags/schema.test.ts` covering: accepts `{}`, accepts `{ vaultId: 'work' }`, trims surrounding whitespace from `vaultId`, rejects non-string `vaultId` with a `ZodError` whose first issue path includes `vaultId` (per [data-model.md](data-model.md) "Entity: ListTagsRequest" validation rules; mirror the structure of `tests/tools/delete-file/schema.test.ts`)
- [ ] T003 [P] [US1] Write `tests/tools/list-tags/registration.test.ts` covering: `list_tags` appears in `ALL_TOOLS` exactly once, `inputSchema` equals `zodToJsonSchema(ListTagsRequestSchema, { $refStrategy: 'none' })`, and the tool description contains all three FR-008 clauses — the inline+frontmatter inclusion phrase, the code-block exclusion phrase, and the hierarchical-tag parent-prefix roll-up phrase (per [contracts/list_tags.md](contracts/list_tags.md) "Tool description"; mirror `tests/tools/delete-file/registration.test.ts`)
- [ ] T004 [P] [US1] Write `tests/tools/list-tags/handler.test.ts` covering two happy-path cases against a nocked upstream `GET /tags/`: (a) **populated index** — fixture body includes a hierarchical example (`{ tags: [{ name: 'project', count: 3 }, { name: 'work/tasks', count: 5 }, { name: 'work', count: 5 }] }`); call `handleListTags({}, rest)` and assert the returned `CallToolResult.content[0].text` parses back to the exact same object (FR-012 verbatim pass-through), with the parent-prefix roll-up rows preserved; (b) **empty vault** — fixture body is `{ "tags": [] }`; call `handleListTags({}, rest)` and assert the returned text parses back to `{ tags: [] }` and the result is **not** marked `isError` (spec edge case "Empty vault / no tags"). For both cases, pin the HTTP method (`GET`), URL path (`/tags/`), and `Authorization: Bearer <key>` header on the nock interceptor (FR-010)
- [ ] T005 [P] [US1] Write `tests/tools/list-tags/upstream-error.test.ts` covering the upstream-error path: nock `GET /tags/` to return 401 with body `{ "errorCode": 401, "message": "Authentication required" }`; assert `handleListTags({}, rest)` rejects with a plain `Error` whose `.message` contains the literal substring `Obsidian API Error 401:` and the upstream `message` text verbatim (FR-007, SC-005). Add a second case: nock the upstream to abort/timeout and assert the error message format matches the existing `ObsidianTimeoutError` shape

### Implementation for User Story 1

- [ ] T006 [P] [US1] Create `src/tools/list-tags/schema.ts` exporting `ListTagsRequestSchema` (zod object with optional `vaultId: z.string().trim().optional().describe(...)`), inferred type `ListTagsRequest = z.infer<typeof ListTagsRequestSchema>`, and `assertValidListTagsRequest(args: unknown): ListTagsRequest`. Mirror the structure of `src/tools/delete-file/schema.ts` exactly; description text: "Optional vault ID (defaults to configured default vault)."
- [ ] T007 [P] [US1] Add a `listTags(): Promise<unknown>` method to `src/services/obsidian-rest.ts` that calls `this.client.get('/tags/')` inside a `safeCall` wrapper and returns `response.data` as `unknown`. Place the method after `listFilesInDir` and before any mutation methods to keep read methods grouped. The `unknown` return type is intentional per [research.md](research.md) §R3 — the caller forwards the body verbatim
- [ ] T008 [US1] Create `src/tools/list-tags/tool.ts` that derives `inputSchema` via `zodToJsonSchema(ListTagsRequestSchema, { $refStrategy: 'none' })` and exports `LIST_TAGS_TOOLS: Tool[]` containing exactly one entry (name `list_tags`, the description block from [contracts/list_tags.md](contracts/list_tags.md) "Tool description", and the derived inputSchema). Mirror `src/tools/delete-file/tool.ts` structure (depends on T006)
- [ ] T009 [US1] Create `src/tools/list-tags/handler.ts` exporting `handleListTags(args: unknown, rest: ObsidianRestService): Promise<CallToolResult>`. Inside: call `assertValidListTagsRequest(args)`, then `await rest.listTags()`, then return `{ content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] }`. Wrap in a try/catch that converts `z.ZodError` to `throw new Error('Invalid input — <path>: <message>')` matching the precedent in `src/tools/delete-file/handler.ts`; let typed `ObsidianApiError`/`ObsidianTimeoutError`/`ObsidianNotFoundError` propagate unchanged (the dispatcher's outer try/catch in `src/index.ts` will format them) (depends on T006, T007)
- [ ] T010 [US1] Wire `LIST_TAGS_TOOLS` into `src/tools/index.ts` — import it, spread it into `ALL_TOOLS`, and add it to the named re-export block — and add a new `case 'list_tags':` arm to the dispatcher in `src/index.ts:handleToolCall` that calls `handleListTags(args, rest)`. Place the case alongside other read-style cases (e.g., right after `case 'list_files_in_vault'` or grouped with file-listing tools). Import `handleListTags` from `./tools/list-tags/handler.js` at the top of `src/index.ts` (depends on T008, T009)

**Checkpoint**: User Story 1 fully functional. The tool is
discoverable via `tools/list`, the input validates correctly, the
HTTP call goes out, and both happy-path and upstream-error tests
pass. Run `npm test -- list-tags` to verify the four test files
pass before moving to Polish.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [ ] T011 Run `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test` from repo root and confirm zero warnings, zero errors, and a green test suite (Constitution §"Development Workflow & Quality Gates" gates 1–4)
- [ ] T012 [P] Audit the `list_tags` tool description by visually inspecting `src/tools/list-tags/tool.ts` against [contracts/list_tags.md](contracts/list_tags.md) "Tool description"; confirm all three FR-008 clauses are present verbatim (inline+frontmatter inclusion, code-block exclusion, hierarchical-tag parent-prefix roll-up) so SC-006 holds against the actual published surface, not just the test fixture
- [ ] T013 Execute the manual smoke test in [quickstart.md](quickstart.md) (steps 1–6) against a real Obsidian vault running Local REST API plugin v3.5.0+ and confirm: tool discovery shows `list_tags` exactly once, happy-path returns the expected tag index including hierarchical roll-ups, `vaultId` selection works, 401 produces the upstream-error format verbatim, transport unreachable produces an axios-message error, and an empty vault returns `{ "tags": [] }` without an error

**Checkpoint**: Feature ready to merge. PR description must include
the one-line Constitution Principles I–IV statement (Constitution
§"Governance — Compliance review").

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** — no dependencies; T001 must complete before any source edits
- **Foundational (Phase 2)** — empty for this feature
- **User Story 1 (Phase 3)** — starts after T001
- **Polish (Phase 4)** — starts after Phase 3 completes

### Within User Story 1

The dependency graph inside US1:

```text
T002 (schema test)        ──depends on──▶ T006 (schema source)
T003 (registration test)  ──depends on──▶ T010 (wiring; T010 depends on T008+T009)
T004 (handler test)       ──depends on──▶ T009 (handler source)
T005 (error-path test)    ──depends on──▶ T009 (handler source)
T006 (schema source)      ──independent──
T007 (service method)     ──independent──
T008 (tool registration)  ──depends on──▶ T006
T009 (handler source)     ──depends on──▶ T006, T007
T010 (wiring)             ──depends on──▶ T008, T009
```

Tests in this feature are written *after* the modules they exercise
exist (the schema test imports `assertValidListTagsRequest`, the
registration test imports `ALL_TOOLS`, the handler tests import
`handleListTags`). They MUST still be written and run inside the
same change set per Constitution Principle II — the principle
mandates same-PR test ship, not strict test-first ordering. If a
test-first workflow is preferred, write the test bodies against
the still-empty `src/tools/list-tags/*` modules first; they will
fail to compile, then go green as each [P]-marked source task
completes.

### Parallel opportunities

The following pairs can run concurrently because they touch
different files and have no dependency between them:

- **Wave A (after T001)**: T006 ‖ T007
- **Wave B (after T006)**: T008 ‖ T002 (schema test)
- **Wave C (after T009)**: T004 ‖ T005 (handler tests)
- **Wave D (after T010)**: T003 (registration test) — single task; nothing to pair with

T010 itself is sequential (it touches the same `src/index.ts`
dispatcher every other tool also touches; concurrent edits invite
merge friction). T011 in Polish runs after every prior task.

---

## Parallel Example: User Story 1

```bash
# Wave A — start the two independent modules:
Task: "Create src/tools/list-tags/schema.ts (T006)"
Task: "Add ObsidianRestService.listTags() in src/services/obsidian-rest.ts (T007)"

# Wave B — once schema.ts compiles:
Task: "Create src/tools/list-tags/tool.ts (T008)"
Task: "Write tests/tools/list-tags/schema.test.ts (T002)"

# Wave C — once handler.ts compiles:
Task: "Write tests/tools/list-tags/handler.test.ts (T004)"
Task: "Write tests/tools/list-tags/upstream-error.test.ts (T005)"
```

---

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1 (T001) — confirm clean baseline.
2. Phase 3 (T002–T010) — implement and test US1 in dependency order.
3. **STOP and VALIDATE** — run `npm test -- list-tags`; all four
   test files pass.
4. Phase 4 (T011–T013) — full lint/typecheck/build/test sweep,
   description audit, manual smoke against a real vault.
5. Open the PR.

### Single-developer suggested order

If you're executing solo and not parallelising, a sensible serial
order that respects every dependency is:

```text
T001 → T006 → T002 → T007 → T009 → T004 → T005 → T008 → T003 → T010 → T011 → T012 → T013
```

That sequence keeps each completed task self-validating: T002 runs
green as soon as T006 is in; T004/T005 run green as soon as T009
is in; T003 runs green as soon as T010 is in; the final two run
green only with the full pipeline.

---

## Notes

- **[P]** tasks touch different files and have no incomplete-task
  dependencies at their starting wave.
- The **[US1]** label appears on every Phase 3 task as the format
  rules require; Phase 1 and Phase 4 tasks deliberately omit it.
- File paths are repository-root-relative; the absolute paths used
  by the build are formed by prefixing
  `C:\Github\obsidian-modified-mcp-server\` (or the equivalent on
  your machine).
- Do **not** introduce a manual `inputSchema` JSON literal anywhere;
  the schema is generated from the zod source per Constitution
  Principle III. Any drift between the published JSON Schema and
  the runtime parser is a constitution violation.
- Do **not** add caching, retry, or response reshaping inside
  `handleListTags` or `ObsidianRestService.listTags()`. Those
  behaviors are explicitly out of contract per
  [contracts/list_tags.md](contracts/list_tags.md) "Non-contract".
