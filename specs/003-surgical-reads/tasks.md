---
description: "Task list for adding surgical-read MCP tools (get_heading_contents and get_frontmatter_field)"
---

# Tasks: Surgical Reads — get_heading_contents + get_frontmatter_field

**Input**: Design documents from `/specs/003-surgical-reads/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/get_heading_contents.md](./contracts/get_heading_contents.md), [contracts/get_frontmatter_field.md](./contracts/get_frontmatter_field.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. FR-011 in [spec.md](./spec.md) mandates automated test coverage for both tools, and Constitution Principle II makes test coverage non-negotiable for any public tool. Test tasks below are not optional.

**Organization**: Tasks are grouped by user story so each can be implemented and tested as a discrete increment. Both schemas and both service-layer methods live in the Foundational phase because every user story depends on at least one of them, and the schemas share a single file. The user-story phases are ordered to mirror feature 001's TDD-style sequence: validator-rejection tests (US2) before happy-path wiring (US1) for the heading tool; then the independently-shippable frontmatter tool (US3); then explicit upstream-error coverage for both tools (US4).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4) — Setup/Foundational/Polish tasks have no story label
- File paths are absolute relative to the repo root (`c:/Github/obsidian-modified-mcp-server/`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new feature folders the rest of the work writes into.

This feature adds **no new dependencies**. The test runner (`vitest`), HTTP mock (`nock`), and zod↔JSON-Schema bridge (`zod-to-json-schema`) were all installed by feature 001 and are reused unchanged. The `npm test` script is already wired in `package.json`. No `package.json` changes here.

- [X] T001 Create the new feature directories: `src/tools/surgical-reads/` and `tests/tools/surgical-reads/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the shared schemas, the service-layer methods, the `Tool[]` registration entries, and the aggregation into `ALL_TOOLS`. Every user story depends on at least one of these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Add an `async getHeadingContents(filepath: string, headingPath: string): Promise<string>` method to `src/services/obsidian-rest.ts`. Implementation per [quickstart.md §1](./quickstart.md#1-add-the-upstream-service-layer-methods): wrap with the existing `safeCall`, build the URL as `` `/vault/${encodedPath}/heading/${segments}` `` where `encodedPath = filepath.split('/').map(encodeURIComponent).join('/')` and `segments = headingPath.split('::').map(encodeURIComponent).join('/')` — both pieces use per-segment encoding so `/` is preserved as the path-component boundary while spaces and special characters within each segment are properly escaped (per [research.md R8](./research.md)), send `Accept: text/markdown`, leave `responseType` at axios's default (`'json'`), and return `response.data` as `string`. Do NOT pass `responseType: 'text'` — that would also force axios to skip JSON decoding on the **error** path, leaving `error.response.data` as a raw string and preventing `safeCall` from extracting the upstream `errorCode` / `message` (per Constitution Principle IV). axios's `transitional.silentJSONParsing` (default `true` in axios 1.x) makes successful markdown bodies fall back to the raw string when `JSON.parse` throws, so the happy path still returns plain markdown. Must NOT request `application/vnd.olrapi.note+json` and must NOT modify the response body. The structural validator runs in the handler before this method is called, so by the time we get here we are guaranteed `≥ 2` non-empty `::`-separated segments. (Per [research.md R3](./research.md) and [research.md R8](./research.md).)
- [X] T003 Add an `async getFrontmatterField(filepath: string, field: string): Promise<unknown>` method to `src/services/obsidian-rest.ts`. Implementation per [quickstart.md §1](./quickstart.md#1-add-the-upstream-service-layer-methods): wrap with the existing `safeCall`, build the URL as `` `/vault/${encodedPath}/frontmatter/${encodeURIComponent(field)}` `` where `encodedPath = filepath.split('/').map(encodeURIComponent).join('/')` (per-segment encoding, same approach as T002), return `response.data` as `unknown` (axios automatically `JSON.parse`s the JSON-typed response body). Must NOT pass through `responseType: 'text'` for this method — we want axios's automatic JSON decoding. Must NOT coerce, stringify, or otherwise transform the value. (Per [research.md R4](./research.md) and [research.md R8](./research.md). Sequential after T002 — same file.)
- [X] T004 [P] Create `src/tools/surgical-reads/schema.ts` exporting **both** tool schemas and their asserters per [quickstart.md §2 schema.ts](./quickstart.md#schemats): (a) `GetHeadingContentsRequestSchema` (zod object: `filepath` string `min(1)`, `heading` string `min(1)`, `vaultId` optional string) and `assertValidGetHeadingContentsRequest(args)` which calls `.parse(args)`, then if `!isValidHeadingPath(req.heading)` throws an `Error` whose `message` contains the same three required substrings as `patch_content`'s heading rejection per [data-model.md §`WrapperValidationError` for `get_heading_contents`](./data-model.md#for-get_heading_contents): the rule name (`heading targets must use the full H1::H2[::H3...] path`), `received: "<offending value>"`, and `e.g., "<corrected example>"`. The predicate `isValidHeadingPath` MUST be imported from `'../patch-content/schema.js'` — there is no second copy of the rule (FR-003 / [research.md R2](./research.md)). (b) `GetFrontmatterFieldRequestSchema` (zod object: `filepath` string `min(1)`, `field` string `min(1)` plus `.refine((s) => s.trim().length > 0, { message: 'field must not be whitespace-only' })`, `vaultId` optional string) and `assertValidGetFrontmatterFieldRequest(args)` which simply returns `GetFrontmatterFieldRequestSchema.parse(args)` — zod's standard error message is the wrapper-side rejection format for this tool ([data-model.md §`For get_frontmatter_field`](./data-model.md#for-get_frontmatter_field)).
- [X] T005 Create `src/tools/surgical-reads/tool.ts` exporting `SURGICAL_READ_TOOLS: Tool[]` with **two** entries per [quickstart.md §2 tool.ts](./quickstart.md#toolts) and the description requirements in [contracts/get_heading_contents.md §1](./contracts/get_heading_contents.md#1-tool-registration) and [contracts/get_frontmatter_field.md §1](./contracts/get_frontmatter_field.md#1-tool-registration). Each entry's `inputSchema` is produced at module-load time by `zodToJsonSchema(<schema>, { $refStrategy: 'none' })` from the schemas in T004 (single source of truth — FR-012). The heading entry's `description` MUST contain the five testable phrases listed in the contract: `h1::h2`, `top-level`, `literal text contains`, `get_file_contents`, and `frontmatter, tags`. The frontmatter entry's `description` MUST contain the three testable phrases: `original type preserved`, `4xx`, and `get_file_contents`. The exact prose is at the implementer's discretion as long as those substrings appear (case-insensitive) somewhere in the description. (Depends on T004.)
- [X] T006 Modify `src/tools/index.ts`: add `import { SURGICAL_READ_TOOLS } from './surgical-reads/tool.js';`, spread `...SURGICAL_READ_TOOLS` into the `ALL_TOOLS` array (append after `SEMANTIC_TOOLS`), and add `SURGICAL_READ_TOOLS` to the named re-export block. (Depends on T005.)

**Checkpoint**: Foundation ready — both schemas exist, both service methods exist, both tools are registered in `ALL_TOOLS`. The handlers and test suites can now be added per user story. Until handler wiring lands in US1/US3, calls to either tool will fall through to the `default` case in `src/index.ts`'s switch and surface as `Unknown tool` — that is expected at this checkpoint.

---

## Phase 3: User Story 2 - Reject bare-heading targets up-front (Priority: P1)

**Goal**: Confirm the validator for `get_heading_contents` rejects every malformed heading target before any HTTP call is made, with an actionable error message that lets the caller correct the request on the first retry.

**Independent Test**: Run `npm test -- tests/tools/surgical-reads/schema.test.ts`; the suite passes with no network activity required (no `nock` setup needed for this phase). Each rejection assertion verifies the three required substrings are present in the error message — same three substrings the `patch_content` rejection test asserts (FR-004 "must match" requirement).

### Tests for User Story 2

- [X] T007 [US2] Create `tests/tools/surgical-reads/schema.test.ts` covering the heading-rule rejections from [contracts/get_heading_contents.md §7](./contracts/get_heading_contents.md#7-test-matrix-contract-level): rows H2 (bare `"Action Items"`), H3 (trailing-empty `"A::B::"`), H4 (leading-empty `"::A::B"`), H5 (middle-empty `"A::::B"`), H6 (empty string `""` — caught by zod `min(1)` first; assert message names `heading`), and H7 (whitespace-only `"   "`). Each calls `assertValidGetHeadingContentsRequest` from `src/tools/surgical-reads/schema.ts`, expects it to throw, and (for H2/H3/H4/H5/H7) asserts the thrown error's `message` contains: (i) the substring `H1::H2`, (ii) `received: "<that-test's-input>"`, and (iii) `e.g.,`. Also include zod field-path propagation tests: at least two cases that exercise the unchanged `ZodError` path — e.g., `filepath: 123` (wrong type) and `filepath: ''` (empty) — each asserting the thrown message names `filepath`. Run `npm test` and confirm all eight cases pass.

**Checkpoint**: User Story 2 is fully functional and independently verified — the heading-path validator rejects every malformed heading target with the same actionable message format used by `patch_content`. (Note: the handler-level "no HTTP call" verification — H2b — lives in US1 because it requires the handler to exist; the schema-level rejections covered here already satisfy SC-001's "zero requests reach the upstream" claim at the validator boundary.)

---

## Phase 4: User Story 1 - Read just the body under one heading (Priority: P1)

**Goal**: Allow agents to surgically fetch the body content under a fully-pathed heading without retrieving the whole note. End-to-end this means the tool is wired into the dispatcher, the handler validates and forwards a valid heading-path read, and the upstream success surfaces as an MCP success response with the raw markdown body in `content[0].text`.

**Independent Test**: With the implementation complete and the test suite mocked via `nock`, calling `handleGetHeadingContents` with a valid 2-segment heading target produces a success response whose `content[0].text` equals the upstream body verbatim, and `nock` confirms exactly one upstream `GET /vault/<filepath>/heading/<seg1>/<seg2>/...` was issued with `Accept: text/markdown`.

### Implementation for User Story 1

- [X] T008 [P] [US1] Create `src/tools/surgical-reads/handler-heading.ts` exporting `async function handleGetHeadingContents(args: Record<string, unknown>, rest: ObsidianRestService): Promise<CallToolResult>` per [quickstart.md §2 handler-heading.ts](./quickstart.md#handler-headingts). Implementation: (1) `const req = assertValidGetHeadingContentsRequest(args);` (2) `const body = await rest.getHeadingContents(req.filepath, req.heading);` (3) `return { content: [{ type: 'text', text: body }] };`. Do **NOT** wrap step 2 in `try/catch` — upstream errors must propagate per Constitution Principle IV. Do **NOT** trim, slice, or otherwise transform `body`.
- [X] T009 [US1] Modify `src/index.ts`: add `import { handleGetHeadingContents } from './tools/surgical-reads/handler-heading.js';` to the imports (next to the existing `handlePatchContent` import); in the `handleToolCall` switch, add a new case `case 'get_heading_contents': return handleGetHeadingContents(args, rest);` (place near the other read tools — after `get_file_contents` is a natural location; exact placement is at the implementer's discretion).

### Tests for User Story 1

- [X] T010 [P] [US1] Create `tests/tools/surgical-reads/heading-handler.test.ts` covering contract test rows H1, H1b, H1c, H1d, and H2b from [contracts/get_heading_contents.md §7](./contracts/get_heading_contents.md#7-test-matrix-contract-level). Use the harness pattern in [quickstart.md §4](./quickstart.md#4-write-the-tests): construct an `ObsidianRestService` pointing at `https://localhost:27123`, set up `nock('https://localhost:27123')` in `beforeEach`, `nock.cleanAll()` and `nock.enableNetConnect()` in `afterEach`. **H1: heading happy path — verify `Accept` header and URL path explicitly**: prime nock with `.get('/vault/note.md/heading/Weekly%20Review/Action%20Items').matchHeader('Accept', /text\/markdown/).reply(200, '- item one\n- item two\n')`; call `handleGetHeadingContents({ filepath: 'note.md', heading: 'Weekly Review::Action Items' })`; expect `result.isError` falsy, `result.content[0]` to equal `{ type: 'text', text: '- item one\n- item two\n' }` (verbatim, including trailing newline), and `scope.isDone()` true. The URL-path assertion is what verifies the segment-split-then-encode logic from [research.md R8](./research.md) — without it, the test would pass even if the wrapper joined segments with `::` instead of `/`. **H1b: empty body**: prime nock with `.get('/vault/note.md/heading/A/B').reply(200, '')`; expect `result.content[0].text === ''` and `result.isError` falsy (verifies the spec Edge Case "the wrapper does not synthesize a 'not found' error from an empty body"). **H1c: URL-encoding of segment with special characters**: prime nock with `.get('/vault/note.md/heading/Project/Q3%20%2F%20Plan').matchHeader('Accept', /text\/markdown/).reply(200, '- planned item')`; call with `heading: 'Project::Q3 / Plan'`; expect success and `scope.isDone()` true. The literal `/` inside the segment must be percent-encoded to `%2F` (otherwise it would be misinterpreted by the upstream as another path-segment boundary). **H1d: filepath URL-encoding** — prime nock with `.get('/vault/Folder%20With%20Spaces/note%20name.md/heading/A/B').matchHeader('Accept', /text\/markdown/).reply(200, '- nested item')`; call `handleGetHeadingContents({ filepath: 'Folder With Spaces/note name.md', heading: 'A::B' })`; expect `result.isError` falsy, `result.content[0].text === '- nested item'`, and `scope.isDone()` true. The `/` between folder and filename MUST be preserved as a path-segment separator (NOT encoded to `%2F`), while spaces inside each component MUST be encoded to `%20`. Verifies the per-component filepath encoding established in T002 (per [research.md R8](./research.md)). **H2b: handler-level bare-target rejection — verify SC-001 at the integration boundary**: do **not** prime any nock scope; call `nock.disableNetConnect()` so any unintended HTTP would throw `NetConnectNotAllowedError`; submit `{ filepath: 'note.md', heading: 'Action Items' }` to `handleGetHeadingContents`; expect rejection with the heading-rule error message (same three substrings as T007). The combination of "no scope primed" + `disableNetConnect()` means a buggy handler that omitted `assertValidGetHeadingContentsRequest` (or called it after `rest.getHeadingContents`) would surface a `NetConnectNotAllowedError` rather than the expected validation error — distinguishable in the assertion.
- [X] T011 [P] [US1] Create `tests/tools/surgical-reads/registration.test.ts` covering contract test row HR (and reserving room for FR added in T016). Import `ALL_TOOLS` from `src/tools/index.js`. Locate the entry whose `name === 'get_heading_contents'`; assert that `entry.description` contains, case-insensitively, all five required testable phrases: (i) `h1::h2`, (ii) `top-level`, (iii) `literal text contains`, (iv) `get_file_contents`, and (v) `frontmatter, tags`. Phrase (iv) verifies the documented fallback is named in the schema; phrase (v) verifies the metadata-exclusion clause from clarification Q1 is present (a generic "raw markdown body" mention without naming the excluded categories would not satisfy this). Also assert that `entry.inputSchema` is an object with `type: 'object'` and `properties` containing `filepath`, `heading`, and `vaultId` — confirming the zod→JSON-Schema generator ran and produced the expected shape. (Depends on T006 having wired `SURGICAL_READ_TOOLS` into `ALL_TOOLS`.)

**Checkpoint**: User Story 1 is fully functional — `tools/list` exposes `get_heading_contents` with the documented description; valid heading paths reach the upstream with the correct URL path and `Accept` header; and successful upstream responses surface as MCP success with the raw markdown body. With Phases 1 + 2 + 3 + 4 done, the heading tool is shippable as an MVP increment.

---

## Phase 5: User Story 3 - Read one frontmatter field (Priority: P1)

**Goal**: Allow agents to fetch the typed value of a single frontmatter field without retrieving the whole note. End-to-end this means the tool is wired into the dispatcher, the handler validates and forwards a valid field-name request, and the upstream success surfaces as an MCP success response whose `content[0].text` is `{"value":<typed-decoded-value>}` — preserving the original frontmatter type (string, number, boolean, array, object, or `null`).

**Independent Test**: With the implementation complete and the test suite mocked via `nock`, calling `handleGetFrontmatterField` with a valid request produces a success response whose `content[0].text` parses back to `{ value: <decoded> }` with the original JSON type preserved (a `count: 5` becomes `{"value":5}`, not `{"value":"5"}`).

### Implementation for User Story 3

- [X] T012 [P] [US3] Create `src/tools/surgical-reads/handler-frontmatter.ts` exporting `async function handleGetFrontmatterField(args: Record<string, unknown>, rest: ObsidianRestService): Promise<CallToolResult>` per [quickstart.md §2 handler-frontmatter.ts](./quickstart.md#handler-frontmatterts). Implementation: (1) `const req = assertValidGetFrontmatterFieldRequest(args);` (2) `const value = await rest.getFrontmatterField(req.filepath, req.field);` (3) `return { content: [{ type: 'text', text: JSON.stringify({ value }) }] };`. Do **NOT** wrap step 2 in `try/catch`. Do **NOT** coerce, stringify, or otherwise pre-transform `value` before placing it in the envelope — `JSON.stringify` is the only serialization step, and it preserves the JS type that axios already decoded (string stays string, number stays number, `null` stays `null`, array stays array, object stays object).
- [X] T013 [US3] Modify `src/index.ts`: add `import { handleGetFrontmatterField } from './tools/surgical-reads/handler-frontmatter.js';` to the imports; in the `handleToolCall` switch, add `case 'get_frontmatter_field': return handleGetFrontmatterField(args, rest);` (next to the case added by T009).

### Tests for User Story 3

- [X] T014 [P] [US3] Create `tests/tools/surgical-reads/frontmatter-handler.test.ts` covering contract test rows F1, F2, F3, F4, F5, F6, F9, and F9b from [contracts/get_frontmatter_field.md §7](./contracts/get_frontmatter_field.md#7-test-matrix-contract-level). Use the harness pattern from T010 (build `ObsidianRestService`, set up `nock` per-test). The load-bearing rows are F2–F6: a buggy implementation that stringified everything (Option A from clarification Q2) would still pass F1 (the source value is already a string) but would fail F2–F6. **F1 (string)**: prime `.get('/vault/note.md/frontmatter/status').reply(200, JSON.stringify('in-progress'), { 'Content-Type': 'application/json' })` — the JSON-encoded body is the 12-byte string `"in-progress"` (with quotes), and the explicit Content-Type ensures axios's default `responseType: 'json'` decodes via the production code path; call `handleGetFrontmatterField({ filepath: 'note.md', field: 'status' })`; expect `content[0].text === '{"value":"in-progress"}'` and `scope.isDone()` true. **F2 (number)**: `.reply(200, JSON.stringify(5), { 'Content-Type': 'application/json' })` — body is the 1-byte string `5`; expect `text === '{"value":5}'` (NOT `'{"value":"5"}'`). **F3 (boolean)**: `.reply(200, JSON.stringify(true), { 'Content-Type': 'application/json' })`; expect `text === '{"value":true}'`. **F4 (array)**: `.reply(200, ['a', 'b'])` — nock auto-JSON-encodes arrays AND auto-sets `Content-Type: application/json`, so no explicit headers needed for object-typed bodies; expect `text === '{"value":["a","b"]}'`. **F5 (object)**: `.reply(200, { x: 1 })` — same auto-encode path as F4; expect `text === '{"value":{"x":1}}'`. **F6 (null)** — verifies clarification Q2's present-but-null vs. missing distinction: `.reply(200, JSON.stringify(null), { 'Content-Type': 'application/json' })` — the JSON-encoded body is the 4-byte string `null`. Do NOT use `.reply(200, null)` — nock treats a `null` body argument as no body at all, axios then receives an empty string, and the test would fail (or pass for the wrong reason); the explicit `JSON.stringify(null)` + explicit Content-Type is what guarantees the production decode path is exercised. Expect `result.isError` falsy AND `text === '{"value":null}'`. This row is the most important one to get right; F10 in T018 is its negation (404 surfaces as `isError: true`, NOT `{"value":null}`). **F9 (URL-encoding)**: prime `.get('/vault/note.md/frontmatter/my%3Acustom').reply(200, JSON.stringify('hi'), { 'Content-Type': 'application/json' })`; call with `field: 'my:custom'`; expect success and `scope.isDone()` true. The literal `:` in the field name must be percent-encoded; without it the upstream would receive a malformed URL. **F9b (filepath URL-encoding)**: prime `.get('/vault/Folder%20With%20Spaces/note%20name.md/frontmatter/status').reply(200, JSON.stringify('in-progress'), { 'Content-Type': 'application/json' })`; call with `filepath: 'Folder With Spaces/note name.md', field: 'status'`; expect success and `scope.isDone()` true. Same per-component filepath encoding contract as H1d.
- [X] T015 [US3] Add to `tests/tools/surgical-reads/schema.test.ts` (the file created by T007) two new cases covering rows F7 and F8 from [contracts/get_frontmatter_field.md §7](./contracts/get_frontmatter_field.md#7-test-matrix-contract-level). **F7**: call `assertValidGetFrontmatterFieldRequest({ filepath: 'note.md', field: '' })`; expect throw whose message names `field` (caught by zod `min(1)`). **F8**: call with `field: '   '` (whitespace-only); expect throw whose message names `field` and contains the refinement text from T004 (`field must not be whitespace-only` or zod's standard refinement message wording). These two cases are the only schema-level rejections specific to the frontmatter tool; co-locating them in `schema.test.ts` keeps all wrapper-side validation tests in one file. (Sequential after T007 — same file.)
- [X] T016 [US3] Add to `tests/tools/surgical-reads/registration.test.ts` (the file created by T011) one new case covering row FR. Locate the entry whose `name === 'get_frontmatter_field'` in `ALL_TOOLS`; assert that `entry.description` contains, case-insensitively, all three required testable phrases: (i) `original type preserved`, (ii) `4xx`, and (iii) `get_file_contents`. Phrase (i) verifies the typed-value contract from clarification Q2 is named explicitly in the description; phrase (ii) verifies the missing-field-as-error contract; phrase (iii) verifies the all-frontmatter fallback is named. Also assert that `entry.inputSchema` is an object with `type: 'object'` and `properties` containing `filepath`, `field`, and `vaultId`. (Sequential after T011 — same file.)

**Checkpoint**: User Story 3 is fully functional — `tools/list` exposes `get_frontmatter_field` with the documented description; valid field reads reach the upstream with the correct URL path; and successful upstream responses surface as MCP success with the typed value preserved on the `value` envelope. The frontmatter tool is independently shippable from the heading tool — Phases 1 + 2 + 5 (skipping 3 + 4) would deliver only this tool, also a valid MVP increment per spec Story 3's "independently shippable" claim.

---

## Phase 6: User Story 4 - Surface upstream errors verbatim (Priority: P2)

**Goal**: Confirm that errors from the upstream Local REST API plugin propagate to the MCP caller for both new tools, with the upstream status code and message preserved (Constitution Principle IV).

**Independent Test**: Run `npm test -- tests/tools/surgical-reads/heading-handler.test.ts tests/tools/surgical-reads/frontmatter-handler.test.ts`; the H8/H9/H10 and F10/F11/F12 cases pass, demonstrating that for both tools, upstream non-2xx responses and transport-level failures surface as rejections containing the upstream status code and message. The behavior already works at this point — it is inherited from the existing `safeCall` + top-level handler — but these tests make the property regressable.

### Tests for User Story 4

- [X] T017 [US4] Add to `tests/tools/surgical-reads/heading-handler.test.ts` (created by T010) the contract test rows H8, H9, and H10 from [contracts/get_heading_contents.md §7](./contracts/get_heading_contents.md#7-test-matrix-contract-level). **H8 (404 not-found)**: valid request, `nock` returns `404` with body `{ errorCode: 40400, message: 'File or heading not found' }`; expect `handleGetHeadingContents` to reject with a message matching `/Obsidian API Error 40400.*File or heading not found/`. **H9 (401 auth failure)**: valid request, `nock` returns `401` with body `{ errorCode: 40100, message: 'Invalid API key' }`; expect rejection with message matching `/Obsidian API Error 40100.*Invalid API key/`. **H10 (transport error)**: valid request, `nock.disableNetConnect()` plus no primed scope so the call surfaces as a transport error; expect rejection with message containing `Obsidian API Error -1` and the underlying network error text. The handler **must not** catch any of these — verify by asserting `handleGetHeadingContents` itself rejects (rather than returning a structured success). (Sequential after T010 — same file.)
- [X] T018 [US4] Add to `tests/tools/surgical-reads/frontmatter-handler.test.ts` (created by T014) the contract test rows F10, F11, and F12 from [contracts/get_frontmatter_field.md §7](./contracts/get_frontmatter_field.md#7-test-matrix-contract-level). **F10 (field-not-found 404 — distinct from F6's present-but-null)**: valid request, `nock` returns `404` with body `{ errorCode: 40400, message: 'Frontmatter field not found' }`; expect rejection matching `/Obsidian API Error 40400.*Frontmatter field not found/`. The distinctness of F10 from F6 is the load-bearing assertion: a regression that collapsed `null` into "missing" (or vice versa) would either fail F10 (returning `{"value":null}` instead of an error) or fail F6 (rejecting `null` as if it were an error). **F11 (401 auth failure)**: same as H9 but for the frontmatter handler; expect rejection matching `/Obsidian API Error 40100.*Invalid API key/`. **F12 (transport error)**: same harness as H10 but for the frontmatter handler; expect rejection matching `/Obsidian API Error -1/`. (Sequential after T014 — same file. May be parallel with T017 — different files.)

**Checkpoint**: All four user stories are independently verified. Both tools propagate upstream errors verbatim with status code and message preserved; the typed-`null` vs. missing-field distinction is exercised by F6 + F10 in tandem.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verify the constitution gates pass and the feature is shippable.

- [X] T019 [P] Run `npm run lint` from the repo root; resolve any reported issues so it exits with code 0.
- [X] T020 [P] Run `npm run typecheck` from the repo root; resolve any type errors so it exits with code 0.
- [X] T021 [P] Run `npm run build` from the repo root; verify `dist/` is produced without errors.
- [X] T022 Run `npm test` from the repo root; verify all 29 new contract tests pass, organized by test file:
  - `tests/tools/surgical-reads/heading-handler.test.ts` (8): H1, H1b, H1c, H1d, H2b, H8, H9, H10
  - `tests/tools/surgical-reads/frontmatter-handler.test.ts` (11): F1, F2, F3, F4, F5, F6, F9, F9b, F10, F11, F12
  - `tests/tools/surgical-reads/schema.test.ts` (8): H2, H3, H4, H5, H6, H7, F7, F8
  - `tests/tools/surgical-reads/registration.test.ts` (2): HR, FR
  
  This must be in addition to the existing `patch-content` tests still passing (no regression). The total test suite count should be 14 (patch-content) + 29 (surgical-reads) = 43 named contract tests, plus the zod-error-propagation cases each suite adds.
- [ ] T023 Smoke-test against a real Obsidian instance per [quickstart.md §7](./quickstart.md#7-smoke-test-against-a-real-obsidian-optional). At minimum exercise: (1) `get_heading_contents` happy path against a known heading path, verifying the response is just the body under that heading (no frontmatter, no tags, no metadata); (2) `get_heading_contents` bare-target rejection — confirm the response is a validation error and the Obsidian Local REST API plugin's request log shows **no** GET to that path (proving the validator runs before the HTTP call); (3) `get_frontmatter_field` happy path against a known field, verifying the response is `{"value":<typed>}` and the type matches the source frontmatter; (4) `get_frontmatter_field` against a non-existent field, verifying the response is `isError: true` with the upstream 4xx status code and message preserved (NOT `{"value":null}`); (5) **SC-007 payload-size check** — for the same note used in (1) and (3), also call `get_file_contents` for the whole note; record the response payload size (`content[0].text.length`) for all three calls and verify that both surgical reads return strictly fewer bytes than `get_file_contents`. Use a note that has at least one heading section that is shorter than the whole note (most real notes qualify) and at least one frontmatter field whose serialized value is shorter than the whole note. Record the three byte counts in the PR description as evidence that SC-007 is satisfied. If a real Obsidian instance is not available in the contributor's environment, document this in the PR and request a reviewer with access to perform it.
- [ ] T024 Author the PR description per the Constitution Governance section: include a one-line statement confirming Principles I–IV were considered, link to [plan.md](./plan.md), and explicitly call out that this feature adds **no new dependencies** (reuses the test infrastructure introduced by feature 001). Note the deliberate sibling import `surgical-reads/schema.ts → patch-content/schema.ts` and reference [research.md R2](./research.md) for why hoisting to a shared module was deferred.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 — no dependencies; can start immediately.
- **Foundational (Phase 2)**: T002 → T003 (same file, sequential); T004 [P] with T002/T003 (different file); T005 needs T004; T006 needs T005. Blocks every user story.
- **User Story 2 (Phase 3)**: T007 only. Depends on T004 (the schema module must exist for the test to import from). **Can run in parallel with all of Phase 4 and Phase 5** if staffed across multiple contributors.
- **User Story 1 (Phase 4)**: depends on Foundational. Internal graph below.
- **User Story 3 (Phase 5)**: depends on Foundational. T015 sequential after T007 (same `schema.test.ts` file). T016 sequential after T011 (same `registration.test.ts` file). Otherwise independent of Phase 4.
- **User Story 4 (Phase 6)**: T017 sequential after T010 (same `heading-handler.test.ts` file). T018 sequential after T014 (same `frontmatter-handler.test.ts` file). T017 and T018 can be parallel relative to each other.
- **Polish (Phase 7)**: depends on all preceding phases.

### User Story Dependencies

- **User Story 1 (P1)**, **User Story 2 (P1)**, and **User Story 3 (P1)** all depend on Foundational (Phase 2) and are otherwise independent of each other. Three contributors could work each story in parallel after Phase 2 completes.
- **User Story 4 (P2)** depends on US1 (T010 — heading-handler.test.ts) and US3 (T014 — frontmatter-handler.test.ts) because the new test rows are added to those existing files.

### Within User Story 1 (Phase 4)

```text
T004 (Foundational schema) ─┐
T002 (Foundational service) ─┼─ T008 (handler-heading.ts) ──┐
                              │                               ├─ T010 (heading-handler.test.ts: H1, H1b, H1c, H2b)
                              │                               │
                              └─ T009 (index.ts wiring)       │
                                                              │
T006 (Foundational registry) ────────────────────────────────┴─ T011 (registration.test.ts: HR)
```

T008 is `[P]` because it creates a new file; T009 is sequential because it modifies the shared `index.ts` file. T010 needs T008 (handler exists). T011 needs T006 (registry wired).

### Within User Story 3 (Phase 5)

```text
T004 (Foundational schema) ─┐
T003 (Foundational service) ─┼─ T012 (handler-frontmatter.ts) ─┐
                              │                                  ├─ T014 (frontmatter-handler.test.ts: F1-F6, F9)
                              │                                  │
                              └─ T013 (index.ts wiring)          │
                                                                 │
T007 (US2 schema.test.ts) ────────────── T015 (extend schema.test.ts: F7, F8)
T011 (US1 registration.test.ts) ──────── T016 (extend registration.test.ts: FR)
```

### Parallel Opportunities

- T002 and T003 must be sequential (same file `obsidian-rest.ts`).
- T002, T003, and T004 can interleave if staffed (different concerns) but T004 is `[P]` only relative to whichever of T002/T003 runs first.
- T008 and T012 in parallel (different new files; both depend only on Phase 2).
- T009 and T013 cannot be parallel relative to each other (same `src/index.ts`).
- T010 and T014 in parallel (different new files; both depend on their respective handlers).
- T011 in parallel with T010 once T006 lands (different files).
- T015 must wait for T007 (same `schema.test.ts`).
- T016 must wait for T011 (same `registration.test.ts`).
- T017 and T018 can be parallel (different files), but each is sequential after its respective handler-test file (T010, T014).
- T019, T020, T021 in parallel (independent gate checks).

---

## Parallel Example: Foundational + Stories kickoff

Once T001 lands, several streams can begin:

```text
Stream A: T002 → T003 (sequential, same file)
Stream B: T004 (parallel with A)
After T002/T003/T004 land:
Stream A: T005 → T006
Stream B: T007 (US2 schema tests — needs T004)
After T005/T006 land, three contributors can pick up:
Stream A (US1): T008 → T010, T011 (T009 in between, sequential with index.ts)
Stream B (US3): T012 → T014, T016 (T013 in between, sequential with index.ts)
Stream C (US2): already in T007
```

After both T010 and T014 land:

```text
T017 (US4: heading errors, extends T010's file)
T018 (US4: frontmatter errors, extends T014's file) — parallel with T017
```

---

## Implementation Strategy

### MVP scope

This feature has three valid MVP shapes, each shippable independently:

1. **Heading-only MVP**: Phases 1 + 2 + 3 + 4. Ships `get_heading_contents` with full validator coverage (US2) and happy-path coverage (US1). The frontmatter tool's tool entry is in `SURGICAL_READ_TOOLS` from T005 but its handler/dispatcher case from T012/T013 are not yet present, so calls to `get_frontmatter_field` would surface as `Unknown tool`. Acceptable if the team wants to ship in halves.
2. **Frontmatter-only MVP**: Phases 1 + 2 + 5. Ships `get_frontmatter_field` independently. Spec Story 3 explicitly calls out independent shippability.
3. **Combined MVP**: Phases 1 + 2 + 3 + 4 + 5. Ships both tools together. Recommended since both stories are P1 and the feature was specified as a unit.

**Phase 6** (US4) adds explicit upstream-error coverage. The behavior already works at that point — it is inherited from `safeCall` + the top-level handler, which feature 001 also relied on — but the tests make the property regressable for the new endpoints specifically.

### Incremental delivery

Single-PR strategy is the most natural for a feature this small (no new deps, all changes additive). For a staged delivery:

1. Land Phases 1 + 2 + 3 in one PR — establishes both schemas, both service methods, both registration entries, and the validator-rejection test coverage. Neither tool is yet wired to the dispatcher; the two new tools appear in `tools/list` but calls fall through to the `default` switch case.
2. Land Phase 4 in a second PR — wires `get_heading_contents` end-to-end with happy-path tests. Heading tool MVP shippable.
3. Land Phase 5 in a third PR — wires `get_frontmatter_field` end-to-end with happy-path tests. Frontmatter tool MVP shippable. Both tools are now functional.
4. Land Phase 6 + Phase 7 in a fourth PR — error-propagation tests + gates + smoke test + constitution-aligned PR description.

### Parallel team strategy

With multiple developers:

1. Team completes Phase 1 + Phase 2 together (small; one contributor in a single sitting).
2. Once Phase 2 is done, three contributors can pick up:
   - Contributor A: User Story 2 (T007 — pure schema tests, no handler dependency)
   - Contributor B: User Story 1 (T008 → T009 → T010, T011)
   - Contributor C: User Story 3 (T012 → T013 → T014, T015, T016)
3. After both T010 and T014 land, one contributor handles Phase 6 (T017 + T018, parallel).
4. Polish phase: any contributor.

---

## Notes

- `[P]` tasks operate on different files with no incomplete-task dependencies.
- `[Story]` labels exist only on Phase 3, 4, 5, 6 tasks (per template).
- Every test task asserts properties from [contracts/get_heading_contents.md §7](./contracts/get_heading_contents.md#7-test-matrix-contract-level) or [contracts/get_frontmatter_field.md §7](./contracts/get_frontmatter_field.md#7-test-matrix-contract-level); contract IDs (H1–H10, F1–F12, HR, FR) are referenced inline so traceability is bidirectional.
- Tests are **not** optional in this feature — FR-011 mandates them and Constitution Principle II makes them non-negotiable for any public tool.
- Per the constitution's Quality Gates section, T019–T022 are **all** required to pass before merge. T023 (smoke test) is required by the quickstart's Definition of Done.
- This feature deliberately does **not** hoist the heading-path validator to a shared module — see [research.md R2](./research.md). The sibling import from `patch-content/schema.ts` is the chosen mechanism for satisfying FR-003's single-source-of-truth requirement.
- Avoid: changing the existing service-layer methods (`patchContent`, `getFileContents`, etc.), refactoring `patch-content/schema.ts` to extract shared modules, refactoring sibling tools to use zod, or introducing a new error taxonomy — all out of scope.
