---
description: "Task list for Normalise Path Separators for Graph Tools (specs/006)"
---

# Tasks: Normalise Path Separators for Graph Tools

**Input**: Design documents from `/specs/006-normalise-graph-paths/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/get_note_connections.md](contracts/get_note_connections.md), [contracts/find_path_between_notes.md](contracts/find_path_between_notes.md), [contracts/find_similar_notes.md](contracts/find_similar_notes.md), [quickstart.md](quickstart.md)

**Tests**: REQUIRED — Constitution Principle II is non-negotiable for the three affected MCP tools. Spec FR-008 also explicitly mandates a regression test exercising both separator forms. Test tasks are included in this list, not optional.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested as an independent increment. The shared `path-normalisation` utility module lands in Phase 2 (Foundational) because every user story imports it. Each user story phase then adds its specific handler edit + regression tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks).
- **[Story]**: Which user story this task belongs to (US1, US2, US3).
- File paths are absolute from repo root.

## Path Conventions

Single TypeScript project — `src/` and `tests/` at repo root. New code lives in (a) one new utility module under `src/utils/path-normalisation.ts` (and its test under `tests/utils/`), (b) one new test directory `tests/tools/semantic-tools/` for the wired-and-normalised `find_similar_notes` tool. All other touchpoints are minimal edits to existing files: [src/tools/graph/handlers.ts](../../src/tools/graph/handlers.ts), [src/tools/semantic-tools.ts](../../src/tools/semantic-tools.ts), [src/index.ts](../../src/index.ts), and the existing graph handler test file.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new directories and confirm the toolchain baseline is green. The branch (`006-normalise-graph-paths`) and spec/plan/research/data-model/contracts/quickstart artefacts already exist.

- [ ] T001 Create directory `src/utils/` (will hold `path-normalisation.ts`). The directory does not exist today — it is the first cross-tool helper module in this codebase.
- [ ] T002 [P] Create directory `tests/utils/` (will hold `path-normalisation.test.ts`).
- [ ] T003 [P] Create directory `tests/tools/semantic-tools/` (will hold `registration.test.ts`, `schema.test.ts`, `find-similar-handler.test.ts`).
- [ ] T004 [P] Confirm `npm run lint`, `npm run typecheck`, and `npm run test` all pass on the current branch tip as a baseline. No work to do if green; investigate before proceeding if not.

**Checkpoint**: Three new directories exist; baseline is green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The path-normalisation utility module is the keystone — every user story imports it. Its unit tests live in this phase too so Phase 3+ test failures can be triaged against a known-good helper.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T005 Create `src/utils/path-normalisation.ts` per [data-model.md § PathNormaliser module](data-model.md#pathnormaliser-module--srcutilspath-normalisationts). Three exports:
  1. `toOsNativePath(p: string): string` — `return p.replace(/[\\/]/g, sep);` where `sep` is imported from `node:path`.
  2. `toForwardSlashPath(p: string): string` — `return p.replace(/[\\/]/g, '/');`.
  3. `isAbsolutePath(p: string): boolean` — `return isAbsolute(p);` where `isAbsolute` is imported from `node:path`. Re-exported for tests to assert separator transforms cannot change absoluteness.

  Top-of-file imports: `import { sep, isAbsolute } from 'node:path';`. No other imports. Module has no state and performs no I/O. Add file-header JSDoc explaining the per-tool target choice (cross-references R1 in research.md is fine).
- [ ] T006 [P] Create `tests/utils/path-normalisation.test.ts` covering the invariants in [data-model.md § PathNormaliser module § Test coverage](data-model.md#pathnormaliser-module--srcutilspath-normalisationts):
  1. **`toOsNativePath`**:
     - `'a/b/c'` → `\`a${sep}b${sep}c\`` (use `path.sep` so the assertion is platform-correct on both Windows and POSIX).
     - `'a\\b\\c'` → same as above.
     - `'a/b\\c'` → same (mixed input, single canonical output).
     - `''` → `''`.
     - `'README.md'` → `'README.md'` (no separator → unchanged).
     - `'/leading'` → `\`${sep}leading\`` (leading separator preserved, just transformed).
     - `'trailing/'` → `\`trailing${sep}\`` (trailing preserved).
     - Idempotence: `f(f('a/b\\c')) === f('a/b\\c')`.
     - Length-preserving: `f('a/b\\c').length === 'a/b\\c'.length`.
  2. **`toForwardSlashPath`**:
     - `'a\\b\\c'` → `'a/b/c'`.
     - `'a/b\\c'` → `'a/b/c'`.
     - `''` → `''`.
     - `'README.md'` → `'README.md'`.
     - `'\\leading'` → `'/leading'`.
     - `'trailing\\'` → `'trailing/'`.
     - Idempotence and length-preserving as above.
  3. **`isAbsolutePath` invariant**:
     - `isAbsolutePath('a/b')` returns `false`.
     - For input `'a/b\\c'`, all three of `isAbsolutePath(input)`, `isAbsolutePath(toOsNativePath(input))`, `isAbsolutePath(toForwardSlashPath(input))` are equal. (Documents that separator transforms cannot change absoluteness.)

  Use `vitest`'s `describe(...) / it(...)` per the established pattern in `tests/tools/patch-content/schema.test.ts`. Assertions use `expect(...).toBe(...)` and `expect(...).toEqual(...)`. No setup/teardown needed.

**Checkpoint**: `npm run typecheck` passes (the new module typechecks). The unit tests in T006 are all green. The two helpers can now be imported by Phases 3–5.

---

## Phase 3: User Story 1 - Forward-slash path works for note connections (Priority: P1) 🎯 MVP

**Goal**: A caller invoking `get_note_connections` against a Windows vault with a forward-slash filepath gets the connections payload (outgoingLinks, backlinks, tags) instead of "note not found". The reproduction case from the spec — `filepath: "000-Meta/Vault Identity.md"` against a vault where that file exists — returns the expected payload, not a misleading error.

**Independent Test**: Per [quickstart.md § 1.2](quickstart.md): on Windows, call `get_note_connections` with `filepath: "000-Meta/Vault Identity.md"` and confirm the response is the same connections payload as the equivalent backslash form. Genuinely missing files (`does-not-exist.md`) still return `note not found:`. Mixed-separator inputs (`000-Meta\subdir/file.md`) resolve when the file exists.

### Implementation for User Story 1

- [ ] T007 [US1] Edit [src/tools/graph/handlers.ts](../../src/tools/graph/handlers.ts) — modify `handleGetNoteConnections` (currently lines 85–96):

  1. **Add the import** at the top of the file (group with the existing imports near lines 14–22):
     ```ts
     import { toOsNativePath } from '../../utils/path-normalisation.js';
     ```
  2. **Insert the normalisation call** between the `assertValid...` line and the `service.getNoteConnections(...)` call. The current body:
     ```ts
     const req = assertValidGetNoteConnectionsRequest(args);
     try {
       const connections = await service.getNoteConnections(req.filepath);
       return asJson(connections);
     } catch (err) {
       rethrowWithVaultSuffix(err, req.vaultId);
     }
     ```
     becomes:
     ```ts
     const req = assertValidGetNoteConnectionsRequest(args);
     const filepath = toOsNativePath(req.filepath);
     try {
       const connections = await service.getNoteConnections(filepath);
       return asJson(connections);
     } catch (err) {
       rethrowWithVaultSuffix(err, req.vaultId);
     }
     ```
  3. **Do NOT modify `handleFindPathBetweenNotes`** in this task — that is T009 (Phase 4) and stays scoped to US2 for traceability.
  4. **Do NOT modify `GraphService`** ([src/services/graph-service.ts](../../src/services/graph-service.ts)) — separator handling is a wrapper-boundary concern only ([research.md § R2](research.md#r2--where-normalisation-runs-in-the-call-chain)).

  Run `npm run typecheck` after this edit and confirm the file still typechecks.

### Tests for User Story 1 ⚠️

> **NOTE**: These tests are required by spec FR-001, FR-005, FR-006, FR-008 and Constitution Principle II. They are NOT optional.

- [ ] T008 [US1] Extend [tests/tools/graph/handler-per-note.test.ts](../../tests/tools/graph/handler-per-note.test.ts) — add a new `describe('handleGetNoteConnections separator regression', ...)` block at the end of the file (after the existing test blocks). The block contains the following `it(...)` cases. Setup: each case sets up a mock `GraphService` whose internal graph is keyed in OS-native form (matching the production `path.relative()` output) by stubbing `service.getNoteConnections(nodePath)` to return a payload when `nodePath` matches the OS-native form and to throw `note not found: <nodePath>` otherwise.

  **Case 1: forward-slash input on a nested existing file** (FR-001 / Story 1 Acceptance Scenario 1):
  1. Stub the service so `getNoteConnections('000-Meta' + path.sep + 'Vault Identity.md')` returns `{ filepath: '000-Meta\\Vault Identity.md', outgoingLinks: ['x'], backlinks: ['y'], tags: ['z'] }` (or the equivalent OS-native form on POSIX). Other inputs throw `note not found:`.
  2. Call `await handleGetNoteConnections({ filepath: '000-Meta/Vault Identity.md' }, service)`.
  3. Assert: `result.content[0].text` parses to the stubbed payload — proving the handler normalised the forward-slash input to the OS-native form before delegating.

  **Case 2: backslash input returns equivalent result** (FR-004 / Story 1 Acceptance Scenario 2):
  1. Same stub as Case 1.
  2. Call `await handleGetNoteConnections({ filepath: '000-Meta\\Vault Identity.md' }, service)`.
  3. Assert: identical `result.content[0].text` payload as Case 1. **This is the FR-008 regression-test mandate — both separator forms must produce equivalent results.** Document this in a comment above the `it(...)` block.

  **Case 3: mixed separators resolve** (FR-005 / spec Edge Cases):
  1. Same stub as Case 1.
  2. Call `await handleGetNoteConnections({ filepath: '000-Meta\\subdir/file.md' }, service)` where the stub also resolves the OS-native form of `'000-Meta/subdir/file.md'`.
  3. Assert: the stub was called with the fully-normalised OS-native form. Adjust the stub setup to match.

  **Case 4: genuinely missing file → clear error** (FR-006 / Story 1 Acceptance Scenario 3):
  1. Stub: `getNoteConnections` always throws `note not found: <whatever>`.
  2. Call `await handleGetNoteConnections({ filepath: 'does-not-exist.md' }, service)`.
  3. Assert: a `note not found:` error is thrown (use `await expect(...).rejects.toThrow(/note not found:/)`). The exact form (forward-slash vs backslash in the error message) is not asserted — per [research.md § R4](research.md#r4--error-message-form-when-the-lookup-misses), the post-normalisation form is acceptable.

  **Case 5: top-level file unchanged** (Edge case "Top-level file with no separator"):
  1. Stub: `getNoteConnections('README.md')` returns a payload.
  2. Call `await handleGetNoteConnections({ filepath: 'README.md' }, service)`.
  3. Assert: payload returned. Confirms the no-separator case is unaffected by normalisation.

  **Case 6: vault-suffix decoration preserved** (regression-safe — the existing `rethrowWithVaultSuffix` behaviour must still fire on `note not found:` errors when `vaultId` is present):
  1. Stub: `getNoteConnections` always throws `note not found: <input>`.
  2. Call with `{ filepath: 'missing.md', vaultId: 'work' }`.
  3. Assert: thrown error message contains both `note not found:` and ` (vault: work)`.

  Pattern after the existing per-note test cases in the same file. Use the file's existing service-mock setup (extend it if needed). Mock construction: a small helper that returns an object of shape `{ getNoteConnections: vi.fn(...), findPathBetweenNotes: vi.fn(...), getLastSkipped: () => 0, getLastSkippedPaths: () => [] }` — only the methods the handler actually calls need real stubs. **Mock granularity**: keep the mocks thin (vi.fn-backed) rather than introducing a real in-memory `Graph` fixture; the handler's contract with the service is what's under test, not graphology behaviour.

**Checkpoint**: User Story 1 is complete. The MVP behaviour from the bug report — forward-slash nested filepath returning a connections payload on Windows — now holds. The regression test exercises both separator forms (FR-008 satisfied for `get_note_connections`).

---

## Phase 4: User Story 2 - Forward-slash paths work for path-between queries (Priority: P2)

**Goal**: A caller invoking `find_path_between_notes` with both `source` and `target` in forward-slash form gets either a path payload or an explicit "no path" result. Never `note not found:` when both files exist. Both arguments are independently separator-tolerant — either can be in any form.

**Independent Test**: Per [quickstart.md § 1.2](quickstart.md): against a vault with two nested notes, call `find_path_between_notes` with both arguments forward-slash. Verify the response is either `{path: [...]}` or `{path: null}`. Verify that with a missing source or target, the error names the missing one only — not both.

### Implementation for User Story 2

- [ ] T009 [US2] Edit [src/tools/graph/handlers.ts](../../src/tools/graph/handlers.ts) — modify `handleFindPathBetweenNotes` (currently lines 98–109). The import added in T007 is already present; this task only adds the two normalisation calls. Current body:
  ```ts
  const req = assertValidFindPathBetweenNotesRequest(args);
  try {
    const path = await service.findPathBetweenNotes(req.source, req.target, req.maxDepth);
    return asJson({ path });
  } catch (err) {
    rethrowWithVaultSuffix(err, req.vaultId);
  }
  ```
  becomes:
  ```ts
  const req = assertValidFindPathBetweenNotesRequest(args);
  const source = toOsNativePath(req.source);
  const target = toOsNativePath(req.target);
  try {
    const path = await service.findPathBetweenNotes(source, target, req.maxDepth);
    return asJson({ path });
  } catch (err) {
    rethrowWithVaultSuffix(err, req.vaultId);
  }
  ```
  Run `npm run typecheck` afterwards.

### Tests for User Story 2 ⚠️

> **NOTE**: These tests are required by spec FR-002, FR-005, FR-006 and Constitution Principle II.

- [ ] T010 [US2] Extend [tests/tools/graph/handler-per-note.test.ts](../../tests/tools/graph/handler-per-note.test.ts) — add a `describe('handleFindPathBetweenNotes separator regression', ...)` block. Reuse the same mock-service helper from T008 (extend if needed to back `findPathBetweenNotes`). The block contains:

  **Case 1: forward-slash on both args, path exists** (FR-002 / Story 2 Acceptance Scenario 1):
  1. Stub `service.findPathBetweenNotes(<os-native source>, <os-native target>, ...)` to return `['000-Meta\\A.md', '000-Meta\\Bridge.md', '010-Notes\\B.md']` (OS-native node IDs).
  2. Call with `{ source: '000-Meta/A.md', target: '010-Notes/B.md' }`.
  3. Assert: `result.content[0].text` parses to `{ path: [...] }` with the stubbed array.

  **Case 2: forward-slash on both args, no path between** (FR-002 / Story 2 Acceptance Scenario 2):
  1. Stub returns `null`.
  2. Call with forward-slash source and target.
  3. Assert: `result.content[0].text` parses to `{ path: null }`. **Crucially: NOT a `note not found:` error.**

  **Case 3: backslash on both args returns equivalent** (FR-004):
  1. Same stub as Case 1.
  2. Call with backslash source and target.
  3. Assert: identical payload to Case 1.

  **Case 4: mixed-separator inputs resolve** (FR-005):
  1. Same stub.
  2. Call with `{ source: '000-Meta\\A.md', target: '010-Notes/B.md' }` (different separators on each arg).
  3. Assert: identical payload — both arguments are independently normalised.

  **Case 5: source missing → error names source, not both** (Story 2 Acceptance Scenario 3):
  1. Stub throws `note not found: <os-native source>` when called with the OS-native source.
  2. Call with forward-slash `source` (missing) and forward-slash `target` (existing).
  3. Assert: thrown error message contains `note not found:` and references the source. Does NOT reference the target.

  **Case 6: target missing → error names target only**:
  1. Stub throws `note not found: <os-native target>` when called with the OS-native target.
  2. Call with both forward-slash, where target is the missing one.
  3. Assert: error references target only.

  **Case 7: both missing → "notes not found:"** (existing service contract for the both-missing case):
  1. Stub throws `notes not found: <os-native source>, <os-native target>`.
  2. Call with both forward-slash.
  3. Assert: error message contains `notes not found:` and references both.

**Checkpoint**: User Story 2 complete. Both arguments of `find_path_between_notes` are independently separator-tolerant. The four positive cases (1–4) and three error cases (5–7) lock in FR-002 and FR-006.

---

## Phase 5: User Story 3 - Forward-slash paths work for similarity queries (Priority: P3)

**Goal**: A caller invoking `find_similar_notes` with a forward-slash filepath gets a similarity payload (when Smart Connections is configured) or a clear "Smart Connections not configured" error. The tool is callable end-to-end (no longer `Unknown tool: find_similar_notes`). Backslash and mixed-separator inputs continue to work.

This phase delivers the largest implementation surface of the three user stories because the tool was both (a) using a hand-written JSON schema (Constitution Principle III non-compliance) and (b) entirely missing from the dispatcher (per [research.md § R5](research.md#r5--dispatcher-gap-for-find_similar_notes)). Both must be addressed to satisfy FR-003.

**Independent Test**: Per [quickstart.md § 1.2](quickstart.md): on Windows, call `find_similar_notes` with `filepath: "000-Meta/Vault Identity.md"` against a vault with Smart Connections configured. Confirm the response is a Smart Connections payload, not `Unknown tool` and not `note not found:`. Without Smart Connections configured, confirm the response is `Smart Connections not configured for vault "<id>"`. Either way, never `Unknown tool`.

### Implementation for User Story 3

- [ ] T011 [US3] Edit [src/tools/semantic-tools.ts](../../src/tools/semantic-tools.ts) — replace the hand-written JSON schema for `find_similar_notes` (currently lines 49–74 — the second object in the `SEMANTIC_TOOLS` array) with a zod-derived schema. Steps:

  1. **Add imports** at the top of the file:
     ```ts
     import { z } from 'zod';
     import { zodToJsonSchema } from 'zod-to-json-schema';
     import type { ZodTypeAny } from 'zod';
     ```
  2. **Add the schema definition** before the `SEMANTIC_TOOLS` array, matching the shape in [data-model.md § FindSimilarNotesRequest](data-model.md#findsimilarnotesrequest-zod--srctoolssemantic-toolsts):
     ```ts
     export const FindSimilarNotesRequestSchema = z.object({
       filepath: z
         .string()
         .min(1, 'filepath must be a non-empty string')
         .describe('Path to the source note (relative to vault root). Forward-slash or backslash separators both accepted.'),
       limit: z.number().int().positive().optional().describe('Maximum similar notes to return (default: 10).'),
       threshold: z.number().min(0).max(1).optional().describe('Similarity threshold 0-1 (default: 0.5).'),
       vaultId: z.string().optional().describe('Optional vault ID (defaults to configured default vault).'),
     });

     export type FindSimilarNotesRequest = z.infer<typeof FindSimilarNotesRequestSchema>;

     export function assertValidFindSimilarNotesRequest(args: unknown): FindSimilarNotesRequest {
       return FindSimilarNotesRequestSchema.parse(args);
     }

     function toJsonSchema(schema: ZodTypeAny): Tool['inputSchema'] {
       return zodToJsonSchema(schema, { $refStrategy: 'none' }) as Tool['inputSchema'];
     }
     ```
  3. **Replace the `find_similar_notes` registration entry** (the second array element in `SEMANTIC_TOOLS`) so its `inputSchema` is `toJsonSchema(FindSimilarNotesRequestSchema)`. The `name` and `description` stay verbatim. The hand-written `inputSchema` JSON literal is removed.
  4. **DO NOT modify the `semantic_search` registration entry** (the first array element). It is also unwired in the dispatcher and uses a hand-written JSON schema, but it is OUT OF SCOPE for this feature ([research.md § R5](research.md#r5--dispatcher-gap-for-find_similar_notes)). Leave it untouched.
  5. Run `npm run typecheck` to confirm everything compiles.
- [ ] T012 [US3] Edit [src/index.ts](../../src/index.ts) — wire the `find_similar_notes` dispatcher case. Three changes in this single edit:

  1. **Add imports** at the top of the file (group with the other handler/schema imports near lines 20–33):
     ```ts
     import { assertValidFindSimilarNotesRequest } from './tools/semantic-tools.js';
     import { toForwardSlashPath } from './utils/path-normalisation.js';
     ```
  2. **Add the dispatcher case** in the `switch (name)` block (group with the graph tool cases at lines 479–498 for locality with the other index-based tools, even though `find_similar_notes` is not graph-backed — they share the per-note shape):
     ```ts
     case 'find_similar_notes': {
       const req = assertValidFindSimilarNotesRequest(args);
       const path = toForwardSlashPath(req.filepath);
       const results = await this.getSemanticService(vaultId).findSimilar(path, {
         limit: req.limit,
         threshold: req.threshold,
       });
       return {
         content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
       };
     }
     ```
  3. **DO NOT add a case for `semantic_search`** — out of scope ([research.md § R5](research.md#r5--dispatcher-gap-for-find_similar_notes)).

  Run `npm run typecheck` afterwards. The new case must typecheck against `SmartConnectionsService.findSimilar`'s existing signature ([smart-connections.ts:125](../../src/services/smart-connections.ts#L125)) — `findSimilar(filepath: string, options?: { limit?: number; threshold?: number; ... })`.

### Tests for User Story 3 ⚠️

> **NOTE**: These tests are required by spec FR-003, FR-004, FR-005 and Constitution Principle II.

- [ ] T013 [P] [US3] Create `tests/tools/semantic-tools/registration.test.ts` — assertions:
  1. `find_similar_notes` appears in `ALL_TOOLS` exactly once (catches accidental duplicate registration).
  2. Its `inputSchema` is the `zodToJsonSchema` derivative of `FindSimilarNotesRequestSchema` — re-derive in the test and deep-compare via `expect(tool.inputSchema).toEqual(zodToJsonSchema(FindSimilarNotesRequestSchema, { $refStrategy: 'none' }))`. Pattern from [tests/tools/patch-content/registration.test.ts](../../tests/tools/patch-content/registration.test.ts).
  3. Its `description` is unchanged from the pre-fix value (`'Find notes semantically similar to a given note.'`) — this feature does not change the tool's description text.
  4. The `inputSchema.properties.filepath.description` (post-zodToJsonSchema) contains the literal substring `"Forward-slash or backslash separators both accepted"` — locks in the documentation half of FR-007.
  5. `semantic_search` also appears in `ALL_TOOLS` (regression safety — we did not accidentally remove it while editing the file).
- [ ] T014 [P] [US3] Create `tests/tools/semantic-tools/schema.test.ts` — assertions for `FindSimilarNotesRequestSchema`:
  1. `assertValidFindSimilarNotesRequest({ filepath: 'foo.md' })` returns `{ filepath: 'foo.md' }` — minimal valid input.
  2. `assertValidFindSimilarNotesRequest({ filepath: 'foo.md', limit: 5, threshold: 0.7, vaultId: 'work' })` returns the full typed object.
  3. `assertValidFindSimilarNotesRequest({})` throws `ZodError` whose error path includes `filepath`.
  4. `assertValidFindSimilarNotesRequest({ filepath: '' })` throws `ZodError` (the `.min(1)` constraint).
  5. `assertValidFindSimilarNotesRequest({ filepath: 'foo.md', limit: 0 })` throws `ZodError` (`.positive()` constraint).
  6. `assertValidFindSimilarNotesRequest({ filepath: 'foo.md', limit: -1 })` throws `ZodError`.
  7. `assertValidFindSimilarNotesRequest({ filepath: 'foo.md', limit: 1.5 })` throws `ZodError` (`.int()` constraint).
  8. `assertValidFindSimilarNotesRequest({ filepath: 'foo.md', threshold: 1.5 })` throws `ZodError` (`.max(1)` constraint).
  9. `assertValidFindSimilarNotesRequest({ filepath: 'foo.md', threshold: -0.1 })` throws `ZodError` (`.min(0)` constraint).
- [ ] T015 [P] [US3] Create `tests/tools/semantic-tools/find-similar-handler.test.ts` — end-to-end dispatch via `server.handleToolCall('find_similar_notes', args)` with `nock`-mocked Smart Connections backend. Pattern after [tests/tools/patch-content/handler.test.ts](../../tests/tools/patch-content/handler.test.ts) for the nock setup. Test cases:

  **Setup**: each test instantiates `ObsidianMCPServer` and configures one vault with `smartConnectionsPort` set so `getSemanticService` succeeds. The vault config also has the matching `host`, `port`, `apiKey` so the axios client routes mocked traffic correctly. Use `vi.spyOn` or environment-variable seeding to inject the test vault config — pattern from the existing patch-content handler test.

  **Case 1: forward-slash input → POST body `path` is forward-slash, response is returned** (FR-003 happy path):
  1. Mock `POST /search/similar` with a `nock` interceptor that captures the request body and replies with `{ results: [{ path: '000-Meta/Other.md', score: 0.87 }] }`.
  2. Call `await server.handleToolCall('find_similar_notes', { filepath: '000-Meta/Vault Identity.md', limit: 5, threshold: 0.7 })`.
  3. Assert: the captured body's `path` field is exactly `'000-Meta/Vault Identity.md'` (forward-slash, unchanged — the helper is a no-op on already-forward-slash input).
  4. Assert: the captured body's `limit` is `5` and `threshold` is `0.7`.
  5. Assert: `result.content[0].text` parses to the array `[{ path: '000-Meta/Other.md', score: 0.87 }]`.
  6. Assert: `nock.isDone()`.

  **Case 2: backslash input → POST body `path` is forward-slash** (FR-004 + the wrapper-canonical contract):
  1. Same mock as Case 1.
  2. Call with `{ filepath: '000-Meta\\Vault Identity.md' }`.
  3. Assert: the captured body's `path` is `'000-Meta/Vault Identity.md'` — the wrapper normalised backslash to forward-slash.
  4. Assert: response payload returned correctly.

  **Case 3: mixed-separator input → forward-slash on the wire** (FR-005):
  1. Same mock.
  2. Call with `{ filepath: '000-Meta\\subdir/file.md' }`.
  3. Assert: captured `path` is `'000-Meta/subdir/file.md'`.

  **Case 4: vault not configured for Smart Connections → clear error**:
  1. Configure a second vault WITHOUT `smartConnectionsPort` set.
  2. Call `await server.handleToolCall('find_similar_notes', { filepath: 'foo.md', vaultId: 'no-smart-connections' })`.
  3. Assert: the dispatcher's outer try/catch returns `{ content: [...], isError: true }` with text matching `Smart Connections not configured for vault "no-smart-connections". Set smartConnectionsPort.` (the message format from [smart-connections.ts:127](../../src/services/smart-connections.ts#L127)).
  4. **Crucially: assert the text is NOT `Unknown tool: find_similar_notes`** — locks in the dispatcher-gap fix from R5.

  **Case 5: upstream 404 → fallback message preserved**:
  1. Mock `POST /search/similar` → `reply(404, { errorCode: 404, message: 'not found' });`.
  2. Call with valid forward-slash input.
  3. Assert: `result.isError === true`, text contains `Similar notes endpoint not available. Use semantic_search with note content instead.` (existing fallback at [smart-connections.ts:142](../../src/services/smart-connections.ts#L142)).

  **Case 6: zod validation failure surfaces the field path**:
  1. Call `await server.handleToolCall('find_similar_notes', {})` (missing `filepath`).
  2. Assert: `result.isError === true`, text matches `/filepath.*non-empty/i`. Confirms the schema fires before the dispatcher does any other work.

**Checkpoint**: User Story 3 complete. The `find_similar_notes` tool is now callable end-to-end (R5 dispatcher gap closed), takes a zod-validated input shape (Principle III compliance), and normalises any caller-supplied separator form to forward-slash on the wire (FR-003 / FR-004 / FR-005). All six test cases pass.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Pre-merge quality gates. The constitution requires lint + typecheck + build + test all to pass before merge.

- [ ] T016 Run `npm run lint` — fix any new warnings introduced by Phases 2–5. Zero warnings required (constitution Section 2). Pay particular attention to unused imports in `handlers.ts` (the new `toOsNativePath` import is used twice — confirm) and `semantic-tools.ts` (the new `z`, `zodToJsonSchema`, `ZodTypeAny` imports must all be used).
- [ ] T017 Run `npm run typecheck` — zero errors required. The newly-typed `req` from `assertValidFindSimilarNotesRequest` should narrow correctly through the dispatcher case; the `findSimilar(path, { limit, threshold })` call must satisfy `SmartConnectionsService.findSimilar`'s parameter types.
- [ ] T018 Run `npm run build` — confirm `tsup` produces a clean bundle that includes `dist/utils/path-normalisation.js` and the modified `dist/tools/semantic-tools.js`.
- [ ] T019 Run `npm run test` — full suite passes: existing patch-content + surgical-reads + graph + delete-file tests still green; the new path-normalisation, graph regression, and semantic-tools tests all pass. Specifically check that the existing `tests/tools/graph/handler-per-note.test.ts` cases (pre-existing ones, not the new separator regression cases from T008/T010) still pass after the handler edits.
- [ ] T020 [P] Reverse-validation against the bug report: against a real Obsidian vault on Windows, run all three reproduction flows from [quickstart.md § 1.2](quickstart.md). Assert the "expected (post-fix)" outcomes hold: forward-slash input returns a payload, backslash returns the same payload, the originally-failing reproduction (`get_note_connections` with `filepath: "000-Meta/Vault Identity.md"`) now succeeds. **DEFER to user — requires a real Obsidian vault.**
- [ ] T021 [P] PR description includes the constitution one-liner: `Principles I–IV considered.` per Constitution Section 4 / Compliance review. **DEFER to PR-creation time.**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately. T001 must run first (parent-most directory). T002, T003, T004 are mutually parallel.
- **Phase 2 (Foundational)**: Depends on Phase 1. T005 (helper module) and T006 (its tests) are sequential — the test file imports from the module, so T005 must compile before T006 can run. T006 can also run in parallel with T005 if both are written together (the test author can write the test file against the module's signature) but typecheck/test execution of T006 requires T005 to exist.
- **Phase 3 (US1)**: Depends on Phase 2. T007 (handler edit) imports from T005 (`toOsNativePath`). T008 (regression test) depends on T007 because the test is written against the post-edit handler behaviour.
- **Phase 4 (US2)**: Depends on Phase 2 (for `toOsNativePath`). The handler edit T009 is in the *same file* as T007 but in a different function — T009 can be done before, after, or alongside T007. Listed under US2 for traceability. T010 (regression test) depends on T009.
- **Phase 5 (US3)**: Depends on Phase 2 (for `toForwardSlashPath`). T011 (schema rewrite) is a prerequisite for T012 (dispatcher case imports `assertValidFindSimilarNotesRequest`). T013, T014, T015 depend on T011 + T012 (the tests exercise the wired dispatcher and the new schema).
- **Phase 6 (Polish)**: Depends on all prior phases. T016–T019 are sequential gate checks. T020 + T021 are deferred to user/PR time.

### User Story Dependencies

- **US1 (P1)**: No dependencies on other stories. Delivers the MVP — `get_note_connections` accepts forward-slash on Windows.
- **US2 (P2)**: No dependencies on other stories. Touches the same file as US1 (`handlers.ts`) but a different function. Independently testable from US1: a separate `describe(...)` block targeting `handleFindPathBetweenNotes`.
- **US3 (P3)**: No dependencies on US1 or US2. Its surface area (semantic-tools.ts schema rewrite + new dispatcher case + new test directory) is disjoint from US1/US2.

### Within Each User Story

- Implementation tasks before test tasks (the tests assert post-fix behaviour and would always pass against a stub-only implementation; running them first against the real edits ensures the edits are exercised).
- For US1 and US2, since both touch `handlers.ts`, they can land in the same edit if delivered together — but task-level traceability is maintained by separate task IDs.

### Parallel Opportunities

- **Phase 1**: T002, T003, T004 in parallel after T001.
- **Phase 2**: T005 and T006 — author both files together, run `npm run typecheck && npm run test` after both exist.
- **Phase 3 vs Phase 4**: US1 and US2 are independent stories. If two developers are available, T007+T008 (US1) and T009+T010 (US2) can run in parallel — same source file, different functions, with care to avoid merge conflicts in `handlers.ts`. Most efficient: one developer applies both T007 and T009 in a single edit, then T008 and T010 run truly in parallel.
- **Phase 5**: T011 is sequential before T012; T013, T014, T015 are mutually parallel after T012.
- **Phase 6**: T016 → T017 → T018 → T019 are strictly sequential (each gate depends on its predecessor passing). T020 and T021 can run in parallel with each other.

---

## Parallel Example: Phase 5 test files (after dispatcher wired)

```bash
# Once T012 (dispatcher wiring) is done, launch all three test files in parallel:
Task: "Create tests/tools/semantic-tools/registration.test.ts (T013)"
Task: "Create tests/tools/semantic-tools/schema.test.ts (T014)"
Task: "Create tests/tools/semantic-tools/find-similar-handler.test.ts (T015)"
```

## Parallel Example: combined US1 + US2 implementation

```bash
# Most efficient when one developer can author both function edits in a single pass:
Step 1: Apply T007 + T009 together as one edit to src/tools/graph/handlers.ts
        (one import added at top, one normalisation call added in each of two functions)
Step 2: Author T008 (US1 describe block) and T010 (US2 describe block) in parallel
        — same test file, different describe blocks, mutually parallelizable as long
        as both authors stage their additions to disjoint ends of the file.
```

---

## Implementation Strategy

### Single-PR delivery (recommended for this fix)

Constitution Principle II requires a tool's tests to land in the same change as the tool itself. All three user stories' tests must therefore land in one PR alongside the handler/dispatcher edits.

1. Complete Phase 1 (Setup) + Phase 2 (Foundational helper + its tests).
2. Complete Phase 3 (US1) — handler edit + 6 regression-test cases extending the existing per-note test file.
3. Complete Phase 4 (US2) — handler edit + 7 regression-test cases extending the same per-note test file.
4. Complete Phase 5 (US3) — schema rewrite + dispatcher case + 3 new test files (registration, schema, handler with 6 cases).
5. Complete Phase 6 (Polish) — lint/typecheck/build/test gates plus reverse-validation.
6. Open PR; reference `Principles I–IV considered` per constitution.

### MVP-first variant (if circumstances force splitting)

If the team wants to ship the most-visible fix (US1) without the rest:

1. Phases 1 + 2 + 3 + 6 in one PR (US1 implementation + 6 US1 test cases + helper module + gates). This delivers `get_note_connections` forward-slash support — the headline bug — and locks it in.
2. Follow-up PR with Phases 4 (US2) + 5 (US3).

This split is **acceptable** because the three user stories are genuinely independent (different functions / different dispatcher cases). The trade-off: SC-001 / SC-002 are only verified for one tool until Phase 4 + 5 ship. Given the small total surface (~150 LOC across all three phases), bundling is still recommended.

### Reverse-validation as continuous-integration check

Once the test suite is in place, the manual reproduction flow from [quickstart.md § 1.2](quickstart.md) doubles as a smoke check anyone can run before merging changes that touch the graph handlers, the path normaliser, or the Smart Connections dispatcher case. Document this expectation in T020.

---

## Notes

- **Auto mode** is active in this conversation, so a subsequent `/speckit-implement` invocation will execute these tasks autonomously. Each task is scoped tightly enough that an implementing agent can complete it from this file alone — no hidden context required.
- **No new dependencies** are added by this feature. The `node:path` `sep` and `isAbsolute` helpers are part of Node's standard library; `zod`, `zod-to-json-schema`, `nock`, `vitest` are all already in `package.json`.
- **Behavioural compatibility** of the helper module is critical — both `toOsNativePath` and `toForwardSlashPath` must be no-ops on already-canonical input on the matching platform (forward-slash input on POSIX through `toForwardSlashPath`; backslash input on Windows through `toOsNativePath`). T006 verifies this directly.
- **`GraphService` and `SmartConnectionsService` are NOT modified** — separator handling is a wrapper-boundary concern. This keeps the services oblivious to platform separator concerns and preserves Constitution Principle I.
- **Out of scope** (per [research.md § R5](research.md#r5--dispatcher-gap-for-find_similar_notes)): the `semantic_search` tool's dispatcher gap. It is registered but unwired and uses a hand-written JSON schema, but it does not take a filepath argument and is unrelated to separator normalisation. Fix it in a separate feature.
- **Error message form** ([research.md § R4](research.md#r4--error-message-form-when-the-lookup-misses)): when `note not found:` fires after normalisation, the path in the error message uses the post-normalisation form. T008 Case 4 deliberately does NOT assert the exact form of the error message — only that the error fires and contains `note not found:`.
