---
description: "Task list for Fix Directory Delete (specs/005)"
---

# Tasks: Fix Directory Delete

**Input**: Design documents from `/specs/005-fix-directory-delete/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/delete_file.md](contracts/delete_file.md), [quickstart.md](quickstart.md)

**Tests**: REQUIRED — Constitution Principle II is non-negotiable, and FR-012 + FR-013 explicitly mandate two specific regression tests. Test tasks are included in this list, not optional.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested as an independent increment. Note that User Stories 1, 2, 3, and 4 share the same handler implementation — the foundation in Phase 2 plus the handler in Phase 3 (US1) collectively *delivers* the behaviour for all four stories. The phases for US2, US3, US4 are therefore primarily about regression-test coverage and the documentation surface that proves each story's contract holds.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks).
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4).
- File paths are absolute from repo root.

## Path Conventions

Single TypeScript project — `src/` and `tests/` at repo root. New code lives under `src/tools/delete-file/` and `tests/tools/delete-file/`, matching the layout used by `patch-content` and `surgical-reads`. One new file lands in `src/services/` (`obsidian-rest-errors.ts`) for the typed-error layer.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new directories and confirm the toolchain baseline is green. The branch (`005-fix-directory-delete`) and spec/plan/research artefacts already exist.

- [X] T001 Create directory `src/tools/delete-file/` (will hold `schema.ts`, `tool.ts`, `handler.ts`, `recursive-delete.ts`, `verify-then-report.ts`)
- [X] T002 [P] Create directory `tests/tools/delete-file/` (will hold `registration.test.ts`, `schema.test.ts`, `single-file.test.ts`, `recursive.test.ts`, `partial-failure.test.ts`, `timeout-verify.test.ts`, `not-found.test.ts`)
- [X] T003 [P] Confirm `npm run lint`, `npm run typecheck`, and `npm run test` all pass on the current branch tip as a sanity baseline. No work to do if green; investigate before proceeding if not.

**Checkpoint**: Directories exist; baseline is green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Service-layer + utility modules that EVERY user story depends on. The typed-error layer is the keystone — without it the handler cannot discriminate timeouts from 404s without fragile message-string matching.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Create `src/services/obsidian-rest-errors.ts` — three error classes (`ObsidianTimeoutError`, `ObsidianNotFoundError`, `ObsidianApiError`) all extending `Error`, each preserving the existing `Obsidian API Error <code>: <message>` text on `.message` for behavioural compatibility, plus type guards `isObsidianTimeoutError(e)` and `isObsidianNotFoundError(e)`. Match the field shapes documented in [data-model.md § ObsidianTimeoutError / ObsidianNotFoundError / ObsidianApiError](data-model.md). The original `AxiosError` is preserved on `.cause`.
- [X] T005 Edit `src/services/obsidian-rest.ts` — replace the `safeCall` body's `catch` block (lines 38–46) so that when `error instanceof AxiosError`:
  1. Compute `formatted = \`Obsidian API Error ${code}: ${message}\`` exactly as today (preserving the message text every other tool sees).
  2. If `error.code === 'ECONNABORTED'` → throw `new ObsidianTimeoutError(this.client.defaults.timeout ?? 0, formatted, error)`.
  3. Else if `error.response?.status === 404` → throw `new ObsidianNotFoundError(formatted, error)`.
  4. Else → throw `new ObsidianApiError(typeof code === 'number' ? code : -1, formatted, error)`.
  Add the import for the three classes at the top of the file. **Behavioural compatibility check**: every existing tool's tests should still pass unchanged after this edit, because each subclass extends `Error` with the same `.message`. Run `npm run test` before moving on.
- [X] T006 [P] Create `src/tools/delete-file/schema.ts` — define `DeleteFileRequestSchema` (`z.object({ filepath: z.string().trim().min(1, 'filepath is required'), vaultId: z.string().trim().optional() })`), export the inferred type `DeleteFileRequest`, and export `assertValidDeleteFileRequest(args: unknown): DeleteFileRequest` that calls `DeleteFileRequestSchema.parse(args)`. Pattern after [src/tools/patch-content/schema.ts](../../src/tools/patch-content/schema.ts).
- [X] T007 [P] Create `src/tools/delete-file/verify-then-report.ts` — export `attemptWithVerification<T>(operation: () => Promise<T>, verify: () => Promise<'absent' | 'present'>): Promise<{ outcome: 'success' } | { outcome: 'failure'; cause: ObsidianTimeoutError }>`. Behaviour per [data-model.md § TimeoutVerificationOutcome](data-model.md) and [research.md § R4](research.md#r4--timeout-then-verify-mechanics):
  1. `try { await operation(); return { outcome: 'success' }; }` for the happy path.
  2. In `catch (err)`: if `isObsidianTimeoutError(err)` → call `verify()` inside a try/catch; if verify resolves to `'absent'` return `{ outcome: 'success' }`; if `'present'` return `{ outcome: 'failure', cause: err }`. If `verify()` throws → throw `new OutcomeUndeterminedError(targetPath, err)` (define `OutcomeUndeterminedError` here as a local exported class).
  3. If err is anything else → rethrow unchanged.
  The `targetPath` argument needs to flow in — extend the signature: `attemptWithVerification(targetPath: string, operation, verify)`. Also export the `OutcomeUndeterminedError` class.
- [X] T008 [P] Create `src/tools/delete-file/recursive-delete.ts` — export an async function `recursiveDeleteDirectory(rest: ObsidianRestService, dirpath: string, walkState: WalkState): Promise<void>`, a `WalkState` interface, and a `PartialDeleteError` class (extends Error; carries `failedPath: string` and `deletedPaths: string[]`). Behaviour per [research.md § R3](research.md#r3--recursive-walk-algorithm):
  1. Define `interface WalkState { deletedPaths: string[]; filesRemoved: number; subdirectoriesRemoved: number; }`. The handler in T009 owns the single mutable instance and reads the counters after the walk returns. Counters are incremented inline as deletions complete — never derived from `deletedPaths` post-hoc (the path strings carry no trailing-slash marker that distinguishes file vs directory; the counters are the source of truth).
  2. List children via `rest.listFilesInDir(dirpath)`. The returned array's order is the iteration order — no in-wrapper sorting (FR-014).
  3. For each child entry in order:
     - If the entry ends with `'/'` → compute `childDir = joinPath(dirpath, child.replace(/\/$/, ''))` and call `recursiveDeleteDirectory(rest, childDir, walkState)`. After it returns, call `attemptWithVerification(childDir, () => rest.deleteFile(childDir), () => listingHasName(rest, parentOf(childDir), basename(childDir)) ? 'present' : 'absent')`. On `{outcome:'success'}` push `childDir` onto `walkState.deletedPaths` AND increment `walkState.subdirectoriesRemoved`. On `{outcome:'failure'}` throw `new PartialDeleteError(childDir, [...walkState.deletedPaths])`.
     - Otherwise → compute `childFile = joinPath(dirpath, child)` and call `attemptWithVerification(childFile, () => rest.deleteFile(childFile), () => listingHasName(rest, dirpath, child) ? 'present' : 'absent')`. On success push `childFile` AND increment `walkState.filesRemoved`. On failure throw `new PartialDeleteError(childFile, [...walkState.deletedPaths])`.
  4. After all children succeed, return — the *outer* directory delete is the caller's (handler's) responsibility, not this function's.
  Include small helpers `joinPath`, `parentOf`, `basename`, and `listingHasName(rest, parentDir, name)` (returns `'present' | 'absent'` based on whether `parentDir`'s listing contains `name` or `name + '/'`). For the root case (empty `parentDir`), use `rest.listFilesInVault()` instead of `rest.listFilesInDir(parentDir)`.

**Checkpoint**: `npm run typecheck` passes. `obsidian-rest.ts` throws typed errors (existing tests still green). The three new modules under `src/tools/delete-file/` are ready to be composed by the handler in Phase 3.

---

## Phase 3: User Story 1 - Recursive directory delete returns a clear outcome (Priority: P1) 🎯 MVP

**Goal**: A caller invoking `delete_file` on a non-empty directory path gets a clear success indicator (with file/subdirectory counts) and the directory is gone afterwards. Mid-walk failures abort cleanly with an error naming the offender plus the flat list of paths already deleted.

**Independent Test**: Per [quickstart.md § 1 "Reproduce non-empty directory"](quickstart.md): create `1000- Testing-to-be-deleted/test.md` via `append_content`, call `delete_file` with `1000- Testing-to-be-deleted`, expect `{"ok":true,"deletedPath":"1000- Testing-to-be-deleted","filesRemoved":1,"subdirectoriesRemoved":0}`, confirm via `list_files_in_vault` that the directory is gone. Bug-report reproduction ("Error: Obsidian API Error -1: timeout of 10000ms exceeded" with directory unchanged) must NOT recur.

### Implementation for User Story 1

- [X] T009 [US1] Create `src/tools/delete-file/handler.ts` — export `handleDeleteFile(args: unknown, rest: ObsidianRestService): Promise<CallToolResult>`. The orchestrator per [contracts/delete_file.md](contracts/delete_file.md). Steps:
  1. Validate input: `const req = assertValidDeleteFileRequest(args);`
  2. Normalise trailing slash: `const target = req.filepath.replace(/\/$/, '');`
  3. Detect file-vs-directory-vs-missing by listing the parent (per [research.md § R2](research.md#r2--how-to-detect-whether-a-path-resolves-to-a-file-or-a-directory)): compute `parent = parentOf(target)`, `name = basename(target)`. If `parent` is empty, call `rest.listFilesInVault()`; otherwise `rest.listFilesInDir(parent)`. If the listing contains `name + '/'` → directory branch. If it contains `name` → file branch. Otherwise → `throw new ObsidianNotFoundError(\`Obsidian API Error 404: not found: ${target}\`);` (so the handler's outer error mapping treats it as not-found).
  4. **Directory branch** (recursive):
     a. Initialise `const walkState: WalkState = { deletedPaths: [], filesRemoved: 0, subdirectoriesRemoved: 0 };`. The walk maintains counters inline (see T008 step 1) — do NOT attempt to derive `filesRemoved` / `subdirectoriesRemoved` from `walkState.deletedPaths` after the fact, because the pushed paths do not carry a trailing-slash marker.
     b. Call `await recursiveDeleteDirectory(rest, target, walkState);`. Any `PartialDeleteError` thrown propagates to the handler's outer catch.
     c. Read `walkState.filesRemoved` and `walkState.subdirectoriesRemoved` directly — they are already the correct totals.
     d. Issue the final outer-directory delete via `attemptWithVerification(target, () => rest.deleteFile(target), () => listingHasName(rest, parent, name) ? 'present' : 'absent')`. On `{outcome:'success'}` continue; on `{outcome:'failure'}` throw a partial-failure-style error naming the outer directory; `OutcomeUndeterminedError` propagates as-is.
     e. Return `{ content: [{ type: 'text', text: JSON.stringify({ ok: true, deletedPath: target, filesRemoved: walkState.filesRemoved, subdirectoriesRemoved: walkState.subdirectoriesRemoved }) }] }`.
  5. **File branch** (single delete):
     a. Call `attemptWithVerification(target, () => rest.deleteFile(target), () => listingHasName(rest, parent, name) ? 'present' : 'absent')`.
     b. On success return `{ content: [{ type: 'text', text: JSON.stringify({ ok: true, deletedPath: target, filesRemoved: 0, subdirectoriesRemoved: 0 }) }] }`.
     c. On failure throw `new ObsidianApiError(-1, \`Obsidian API Error -1: delete failed for ${target}\`)` (verification confirmed the file is still present — explicit failure rather than ambiguous timeout).
  6. **Outer error mapping** (single try/catch wrapping steps 1–5): translate caught errors to the contract's five error categories per [contracts/delete_file.md § Error responses](contracts/delete_file.md):
     - `ZodError` → `throw new Error(\`Invalid input — ${err.errors[0]?.path.join('.')}: ${err.errors[0]?.message}\`);`
     - `ObsidianNotFoundError` → `throw new Error(\`not found: ${target}\`);`
     - `PartialDeleteError` → `throw new Error(\`child failed: ${err.failedPath} — already deleted: [${err.deletedPaths.join(', ')}]\`);`
     - `OutcomeUndeterminedError` → `throw new Error(\`outcome undetermined for ${target}\`);`
     - Any other error → rethrow unchanged (the dispatcher's existing catch will format it as `Error: <message>`).
  Imports needed at the top: `assertValidDeleteFileRequest` from `./schema.js`, `attemptWithVerification, OutcomeUndeterminedError` from `./verify-then-report.js`, `recursiveDeleteDirectory, PartialDeleteError` from `./recursive-delete.js`, and the three error classes from `../../services/obsidian-rest-errors.js`. Also `ObsidianRestService` and `CallToolResult` types.
- [X] T010 [P] [US1] Create `src/tools/delete-file/tool.ts` — import `DeleteFileRequestSchema` from `./schema.js`, derive `inputSchema` via `zodToJsonSchema(DeleteFileRequestSchema, { $refStrategy: 'none' })`, and export `DELETE_FILE_TOOLS: Tool[]` containing one entry. The `description` field MUST be the exact wording from [contracts/delete_file.md § Tool description](contracts/delete_file.md#tool-description-advertised-in-mcp-toolslist) — explicitly state recursive directory deletion (FR-011) and timeout coherence (secondary context). The description text *also* delivers the schema-side half of US4 (which is verified by T014's registration test); the README half of US4 is T021. Pattern after [src/tools/patch-content/tool.ts](../../src/tools/patch-content/tool.ts).
- [X] T011 [P] [US1] Edit `src/tools/file-tools.ts` — remove the `delete_file` entry (lines 77–94 in the current file, the trailing object in the `FILE_TOOLS` array). The other four entries (`list_files_in_vault`, `list_files_in_dir`, `get_file_contents`, `batch_get_file_contents`) stay untouched. Confirm the array still parses as valid TypeScript and `npm run typecheck` is green afterwards.
- [X] T012 [US1] Edit `src/tools/index.ts` — add `import { DELETE_FILE_TOOLS } from './delete-file/tool.js';` near the existing imports, and spread `...DELETE_FILE_TOOLS` into the `ALL_TOOLS` array (place it adjacent to `...FILE_TOOLS` for grouping). Also export `DELETE_FILE_TOOLS` from the `export { ... }` block at the bottom for symmetry with the other tool modules.
- [X] T013 [US1] Edit `src/index.ts` — three changes in this single edit:
  1. **Add the import** at the top of the file (group with the other handler imports — see lines 30–32 for the existing pattern):
     ```ts
     import { handleDeleteFile } from './tools/delete-file/handler.js';
     ```
  2. **Replace the `case 'delete_file'` body** (currently lines 374–381 — `const filepath = ...; if (!filepath) throw ...; await rest.deleteFile(filepath); return { ... };`) with:
     ```ts
     case 'delete_file':
       return handleDeleteFile(args, rest);
     ```
  3. **Make `ObsidianMCPServer` and `handleToolCall` public** (matching the change already made on branch 004 for the smoke test, see [src/index.ts:57](../../src/index.ts#L57) and [src/index.ts:273](../../src/index.ts#L273)). Verify these are already `export class` and `public async handleToolCall` — if so this sub-step is a no-op. The integration tests below need the dispatcher to be invokable from a test importing the class.

### Tests for User Story 1 ⚠️

> **NOTE**: These tests are required by spec FR-001/FR-003/FR-012 and Constitution Principle II. They are NOT optional.

- [X] T014 [P] [US1] Create `tests/tools/delete-file/registration.test.ts` — assertions:
  1. `delete_file` appears in `ALL_TOOLS` exactly once. (Catches the "duplicate registration" failure mode if T011 was skipped.)
  2. Its `inputSchema` is the `zod-to-json-schema` derivative of `DeleteFileRequestSchema` (test by re-deriving and deep-comparing — pattern from [tests/tools/patch-content/registration.test.ts](../../tests/tools/patch-content/registration.test.ts)).
  3. The `description` field contains the literal substring `"recursive"` (FR-011 / SC-006 satisfaction).
  4. The `description` also contains the literal substring `"verification"` or `"timeout"` to lock in the secondary timeout-coherence advertising from the contract.
- [X] T015 [P] [US1] Create `tests/tools/delete-file/schema.test.ts` — assertions:
  1. `assertValidDeleteFileRequest({ filepath: 'foo.md' })` returns the typed object unchanged.
  2. `assertValidDeleteFileRequest({ filepath: '  foo.md  ' })` returns `{ filepath: 'foo.md' }` (trim works).
  3. `assertValidDeleteFileRequest({})` throws `ZodError` whose error path includes `filepath`.
  4. `assertValidDeleteFileRequest({ filepath: '' })` throws `ZodError` (the `.min(1)` constraint fires after trim).
  5. `assertValidDeleteFileRequest({ filepath: '   ' })` throws `ZodError` (whitespace-only after trim is empty).
  6. `assertValidDeleteFileRequest({ filepath: 'foo.md', vaultId: 'work' })` returns the typed object with `vaultId` preserved.
- [X] T016 [P] [US1] Create `tests/tools/delete-file/single-file.test.ts` — happy-path baseline for the file branch:
  1. Use `nock` to mock `GET /vault/parent/` returning `{ files: ['target.md'] }` (parent listing shows the file is present, with no trailing slash).
  2. Mock `DELETE /vault/parent/target.md` returning 200.
  3. Mock `GET /vault/parent/` AGAIN returning `{ files: [] }` for the verification re-query (in case it fires; on a non-timeout-success path it shouldn't, so this mock should be defined as `.optionally()` — confirm none of the subsequent assertions are weakened by this).
  4. Instantiate `ObsidianMCPServer` (per T013), call `await server.handleToolCall('delete_file', { filepath: 'parent/target.md' })`.
  5. Assert: `result.content[0].text` parses to `{ ok: true, deletedPath: 'parent/target.md', filesRemoved: 0, subdirectoriesRemoved: 0 }`.
  6. Assert: `nock.isDone()` (parent listing + delete were both called).
  7. Pattern after the `nock` setup in [tests/tools/patch-content/handler.test.ts](../../tests/tools/patch-content/handler.test.ts).
- [X] T017 [P] [US1] Create `tests/tools/delete-file/recursive.test.ts` — **FR-012 regression test**. Asserts the wrapper iterates contained files in upstream listing order, issues per-item deletes, issues the final outer delete, and reports the consolidated outcome. Three `it(...)` blocks under a single `describe('delete_file recursive non-empty directory', ...)`:

  **Block 1 — depth-1 happy path** (the headline FR-012 assertion):
  1. Mock `GET /vault/` (root listing for directory detection on `dir`) returning `{ files: ['dir/'] }` — confirms `dir` is a directory.
  2. Mock `GET /vault/dir/` returning `{ files: ['fileA.md', 'sub/', 'fileB.md'] }` — three children in this exact order, with one nested subdirectory in the middle.
  3. Mock `GET /vault/dir/sub/` returning `{ files: ['inner.md'] }` (one nested file).
  4. Mock the five DELETE endpoints in the exact order they MUST be called: `DELETE /vault/dir/fileA.md` → 200; `DELETE /vault/dir/sub/inner.md` → 200; `DELETE /vault/dir/sub` → 200; `DELETE /vault/dir/fileB.md` → 200; `DELETE /vault/dir` → 200. NO verification mocks are needed because no upstream call is configured to time out in this test — `attemptWithVerification` only fires `verify()` on `ObsidianTimeoutError`.
  5. Call `await server.handleToolCall('delete_file', { filepath: 'dir' })`.
  6. Assert: `result.content[0].text` parses to `{ ok: true, deletedPath: 'dir', filesRemoved: 3, subdirectoriesRemoved: 1 }` (3 files = fileA + inner + fileB; 1 subdirectory = sub).
  7. Assert: `nock.isDone()` — every mock was consumed exactly once. **Mock-ordering strategy**: rely on nock's URL-match-on-registration-order semantics (each DELETE has a unique URL, so consumption order naturally pins the call sequence; if the handler issued them out of order, a later interceptor's URL would not match first and `nock.isDone()` would report a pending mock). Do NOT use `nock.recorder` or side-effect spies — the URL-uniqueness invariant is sufficient and less fragile.

  **Block 2 — depth-2 nested directory** (Edge case "Recursion depth"):
  1. Mock `GET /vault/` → `{ files: ['outer/'] }`.
  2. Mock `GET /vault/outer/` → `{ files: ['mid/'] }`.
  3. Mock `GET /vault/outer/mid/` → `{ files: ['leaf.md'] }`.
  4. Mock the DELETEs in order: `DELETE /vault/outer/mid/leaf.md` → 200; `DELETE /vault/outer/mid` → 200; `DELETE /vault/outer` → 200.
  5. Call `await server.handleToolCall('delete_file', { filepath: 'outer' })`.
  6. Assert: `{ ok: true, deletedPath: 'outer', filesRemoved: 1, subdirectoriesRemoved: 1 }`. Confirms recursion descends arbitrarily deep and the counters match path-by-path bookkeeping.
  7. Assert: `nock.isDone()`.

  **Block 3 — trailing-slash equivalence** (FR-010 lock-in — `foo/` and `foo` are the same target):
  1. Same mocks as Block 1 (re-registered via `beforeEach` or duplicated — depending on test-file structure; nock interceptors are per-test).
  2. Call `await server.handleToolCall('delete_file', { filepath: 'dir/' })` — note the trailing slash.
  3. Assert: identical outcome to Block 1 — `{ ok: true, deletedPath: 'dir', filesRemoved: 3, subdirectoriesRemoved: 1 }`. The `deletedPath` MUST be `'dir'` (without trailing slash) — the handler normalises before reporting.
  4. Assert: `nock.isDone()` — every mock matched the URL the handler dispatched, proving the handler stripped the trailing slash before calling the upstream.

  The describe-block name MUST include `recursive` and `non-empty` (per quickstart.md test-name convention) so test output identifies the FR-012 regression target.
- [X] T018 [P] [US1] Create `tests/tools/delete-file/partial-failure.test.ts` — Q1 + Q4 clarifications regression:
  1. Mock `GET /vault/dir/` → `{ files: ['fileA.md', 'fileB.md', 'fileC.md'] }`.
  2. Mock `GET /vault/` → `{ files: ['dir/'] }` (directory detection).
  3. Mock the DELETEs: `DELETE /vault/dir/fileA.md` → 200; `DELETE /vault/dir/fileB.md` → 500 with body `{ errorCode: 500, message: 'permission denied' }`. (Use a non-timeout error so verification is NOT triggered — this exercises the per-item delete failure path that goes straight to `PartialDeleteError`.)
  4. Call `await server.handleToolCall('delete_file', { filepath: 'dir' })`.
  5. Assert: `result.isError === true`.
  6. Assert: `result.content[0].text` is exactly `Error: child failed: dir/fileB.md — already deleted: [dir/fileA.md]`. **Note on punctuation**: the separator between `<failedPath>` and `already deleted: [...]` is the em-dash `U+2014` (`—`), NOT an ASCII hyphen-minus. The exact character MUST be copy-pasted from [contracts/delete_file.md § 3 Partial failure during recursive walk](contracts/delete_file.md) into both the handler's error-formatting code (T009 step 6) AND this test assertion. To prevent encoding drift, the handler SHOULD export the format as a single helper (e.g., `formatPartialFailureError(failedPath, deletedPaths)`) so the contract, handler, and test all reference one source of truth for the punctuation.
  7. Assert: NO `DELETE /vault/dir/fileC.md` call was made (the walk aborted on fileB; fileC is never touched).
  8. Assert: NO `DELETE /vault/dir` call was made (the outer delete is gated on the walk succeeding).
  9. Assert: `nock.pendingMocks()` does NOT include `/vault/dir/fileC.md` or `/vault/dir` (proves they were registered and unused — alternatively just don't register them and assert they were never called via `nock.isDone()` semantics).

**Checkpoint**: User Story 1 is functionally complete. The MVP behaviour from the bug report's primary reproduction now holds: `delete_file` on a non-empty directory returns `{ok:true}` with counts and the directory is gone. The five test files (registration, schema, single-file, recursive, partial-failure) pass deterministically against `nock`-mocked upstreams.

---

## Phase 4: User Story 2 - Coherent response when the upstream call times out (Priority: P1)

**Goal**: When the upstream HTTP call exceeds the wrapper's transport timeout, the wrapper performs a verification listing query against the parent and reports a definite success or definite failure based on the observed post-condition. The bug report's empty-directory reproduction ("transport-timeout error even though the delete succeeded") is fixed. Verification-query failures surface as "outcome undetermined", single-shot, no retry.

**Independent Test**: Per [quickstart.md § 1 "Reproduce empty directory"](quickstart.md): delete a file that leaves an empty directory, then call `delete_file` on the empty directory. Expect a clean success, NOT the raw transport-timeout error. The handler implementation from Phase 3 already delivers this behaviour — Phase 4's tasks are the regression tests that lock it in.

### Tests for User Story 2 ⚠️

> **NOTE**: These tests are required by spec FR-013 and FR-005/FR-006/FR-009 + the Q3 clarification. They are NOT optional.

- [X] T019 [P] [US2] Create `tests/tools/delete-file/timeout-verify.test.ts` — **FR-013 + FR-008 regression test**, covers five sub-cases per [contracts/delete_file.md § "Error responses"](contracts/delete_file.md):

  **Sub-case A: timeout-with-actual-success** (FR-013 mandate, Q3 clarification negative case):
  1. Mock `GET /vault/` (parent listing for directory detection) → `{ files: ['emptydir/'] }`. Track this interceptor as `directoryDetectionMock`.
  2. Mock `GET /vault/emptydir/` → `{ files: [] }` (the directory is empty — recursive walk has no children to delete).
  3. Mock the outer `DELETE /vault/emptydir` → `nock(...).delete(...).replyWithError({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' });` (synthesises an axios timeout deterministically per [research.md § R6](research.md#r6--test-fixtures-simulating-timeouts-deterministically)).
  4. Mock the verification re-query `GET /vault/` → `{ files: [] }` (directory is gone — upstream actually completed the delete). Track this interceptor as `verificationMock`. Wrap in a counter so the test can assert how many times the verification listing was actually consumed.
  5. Call `await server.handleToolCall('delete_file', { filepath: 'emptydir' })`.
  6. Assert: `result.isError` is falsy. `result.content[0].text` parses to `{ ok: true, deletedPath: 'emptydir', filesRemoved: 0, subdirectoriesRemoved: 0 }`. **The raw `Error: Obsidian API Error -1: timeout` text MUST NOT appear anywhere in the response** — this is the SC-002 / SC-005 lock-in.
  7. Assert (SC-004 lock-in — "exactly one verification listing query per timeout"): exactly TWO `GET /vault/` calls were made — one for the initial directory detection, one for the post-timeout verification. No more, no less. Implement by either: (a) using `nock`'s `.on('request', ...)` event with a path-matching counter, or (b) registering each `GET /vault/` mock individually (no `.persist()`) and checking `nock.pendingMocks().length === 0` AND that no extra interceptor was registered. The handler MUST NOT retry the verification query (FR-009 / Q3).

  **Sub-case B: timeout-with-actual-failure** (FR-006 inverse):
  1. Same `GET /vault/`, `GET /vault/emptydir/`, and timeout `DELETE /vault/emptydir` as sub-case A.
  2. Verification re-query `GET /vault/` → `{ files: ['emptydir/'] }` (directory is STILL THERE — upstream actually failed to complete the delete).
  3. Call the dispatcher.
  4. Assert: `result.isError === true`. The text starts with `Error:` and references the target path `emptydir`. It MUST NOT contain `ok: true`.

  **Sub-case C: timeout-then-verification-also-fails** (FR-009 / Q3 clarification):
  1. Same `GET /vault/`, `GET /vault/emptydir/`, and timeout `DELETE /vault/emptydir` as sub-case A.
  2. Verification re-query `GET /vault/` → `replyWithError({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' });` (verify itself times out — the harshest case).
  3. Call the dispatcher.
  4. Assert: `result.isError === true`. The text is exactly `Error: outcome undetermined for emptydir`. It MUST NOT contain `ok: true` and MUST NOT contain the raw axios timeout message.

  **Sub-case D: timeout-then-verification-fails-with-non-timeout-error** (Q3 clarification's "non-timeout error" branch, locks in the uniform handling):
  1. Same as sub-case C up through step 1.
  2. Verification re-query `GET /vault/` → `reply(503, { errorCode: 503, message: 'service unavailable' });` (verify fails with a 5xx, not a timeout).
  3. Call the dispatcher.
  4. Assert: identical to sub-case C — `result.isError === true`, text is `Error: outcome undetermined for emptydir`. The handler MUST treat verification timeout and verification 5xx identically.

  **Sub-case E: per-item-delete timeout-then-verify** (FR-008 lock-in — the timeout-then-verify behaviour applies to per-item deletes inside the recursive walk, not just the outer call):
  1. Mock `GET /vault/` → `{ files: ['dir/'] }` (directory detection — `dir` is a directory).
  2. Mock `GET /vault/dir/` → `{ files: ['fileA.md', 'fileB.md'] }` (two children).
  3. Mock the FIRST per-item delete: `DELETE /vault/dir/fileA.md` → `replyWithError({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' });` (per-item timeout — the failure mode FR-008 targets).
  4. Mock the per-item verification re-query: `GET /vault/dir/` → `{ files: ['fileB.md'] }` (the listing now shows fileA.md is absent — upstream actually completed the per-item delete despite the wire timeout).
  5. Mock the SECOND per-item delete: `DELETE /vault/dir/fileB.md` → 200.
  6. Mock the outer delete: `DELETE /vault/dir` → 200.
  7. Call `await server.handleToolCall('delete_file', { filepath: 'dir' })`.
  8. Assert: `result.isError` is falsy. `result.content[0].text` parses to `{ ok: true, deletedPath: 'dir', filesRemoved: 2, subdirectoriesRemoved: 0 }`. The walk must NOT have aborted on the timeout — it must have observed via verification that fileA.md was actually deleted, then continued to fileB.md.
  9. Assert: `nock.isDone()` (every mock was consumed — proves the per-item verify query fired exactly once for the timed-out child, the walk continued, and both fileB.md and the outer dir were deleted afterward).

  All five sub-cases live in the same test file as separate `it(...)` blocks under one `describe('delete_file timeout-then-verify', ...)`.

**Checkpoint**: Sub-cases A through E all pass. The timeout coherence half of the contract is regression-locked at both the outer-call layer (A–D) and the per-item layer inside the recursive walk (E). Together with Phase 3's recursive tests, the FR-008 + FR-012 + FR-013 mandate is satisfied.

---

## Phase 5: User Story 3 - Clear "not found" for a missing path (Priority: P2)

**Goal**: A caller invoking `delete_file` with a path that does not exist in the vault gets a clear `not found` error rather than a transport-timeout or generic upstream failure. The handler implementation from Phase 3 already delivers this behaviour via the parent-listing detection step + `ObsidianNotFoundError` mapping — Phase 5's task is the regression test.

**Independent Test**: Per [quickstart.md § 1 "Reproduce missing path"](quickstart.md): call `delete_file` with `this-path-never-existed.md`. Expect `Error: not found: this-path-never-existed.md`, never `Error: Obsidian API Error -1: timeout...`.

### Tests for User Story 3 ⚠️

- [X] T020 [P] [US3] Create `tests/tools/delete-file/not-found.test.ts` — covers four scenarios:

  **Scenario A: target absent in parent listing** (the directory-detection path returns "neither file nor directory"):
  1. Mock `GET /vault/parent/` → `{ files: ['unrelated.md'] }` (parent exists; target does not appear).
  2. Call `await server.handleToolCall('delete_file', { filepath: 'parent/missing.md' })`.
  3. Assert: `result.isError === true`. Text is exactly `Error: not found: parent/missing.md`.
  4. Assert: NO DELETE call was issued upstream (the handler bailed before any delete).

  **Scenario B: post-deletion state — target absent at root** (covers User Story 3 Acceptance Scenario 2: "a path that previously existed but has already been deleted"). The test does NOT issue two calls; it simulates the post-deletion vault state and asserts the second-call outcome:
  1. Mock `GET /vault/` → `{ files: [] }` (root is empty — the file was deleted before this call ran).
  2. Call `await server.handleToolCall('delete_file', { filepath: 'gone.md' })`.
  3. Assert: identical to Scenario A — `result.isError === true`, text is `Error: not found: gone.md`. No DELETE call was issued. SC-003 is locked in even when the upstream listing has changed shape since the path was last observed.

  **Scenario C: upstream returns 404 directly** (defence in depth — even if the parent listing accidentally includes the name due to caching / race, a 404 from the DELETE itself should still surface as "not found"):
  1. Mock `GET /vault/parent/` → `{ files: ['ghost.md'] }` (parent listing thinks it's there).
  2. Mock `DELETE /vault/parent/ghost.md` → `reply(404, { errorCode: 404, message: 'file not found' });` (upstream disagrees).
  3. Call the dispatcher.
  4. Assert: `result.isError === true`. Text is `Error: not found: parent/ghost.md` (the typed-error layer's `ObsidianNotFoundError` passthrough — never the raw upstream text "Obsidian API Error 404").

  **Scenario D: parent itself does not exist** (the parent-listing call returns 404 before directory detection can even run — covers the case where the user supplies a path under a non-existent parent directory like `delete_file({ filepath: 'no-such-dir/file.md' })`):
  1. Mock `GET /vault/no-such-dir/` → `reply(404, { errorCode: 404, message: 'directory not found' });` (the parent listing itself fails — the typed-error layer maps this to `ObsidianNotFoundError`).
  2. Call `await server.handleToolCall('delete_file', { filepath: 'no-such-dir/file.md' })`.
  3. Assert: `result.isError === true`. Text is `Error: not found: no-such-dir/file.md` — the message uses the **input target** verbatim, NOT the parent path. The handler's error mapping (T009 step 6) converts any `ObsidianNotFoundError` into `not found: ${target}` where `target` is the trimmed-and-trailing-slash-normalised input — irrespective of which upstream path actually returned 404.
  4. Assert: NO DELETE call was issued upstream.

**Checkpoint**: All four not-found scenarios pass. SC-003 (zero transport-timeout errors for missing paths) is regression-locked, and the contract's "not found error always names the input target" invariant is locked in regardless of which upstream layer returns the 404.

---

## Phase 6: User Story 4 - Tool description advertises the recursive contract (Priority: P3)

**Goal**: An LLM consumer reading the MCP tool catalogue (or the README's tools table) learns that `delete_file` is recursive on directory paths without having to invoke it.

**Independent Test**: Per [quickstart.md § 3 "Schema verification"](quickstart.md): `tools/list` returns the `delete_file` description, and that description contains the literal word "recursive" plus enough context to convey the contract. Independently: a reader of `README.md`'s tools table sees the same.

The schema-side delivery of US4 is already covered by T010 + T014 (description text + assertion). What remains is the README update.

### Implementation for User Story 4

- [X] T021 [US4] Edit `README.md` line 257 — replace `| \`delete_file\` | Delete file or directory |` with `| \`delete_file\` | Delete a file or directory. **Directory paths are deleted recursively** — the wrapper removes every contained file and subdirectory before deleting the directory itself, in a single tool call. On a transport timeout the wrapper verifies post-condition via a parent listing before reporting outcome. |`. Confirm the surrounding markdown table still renders correctly (column count, pipe alignment).

**Checkpoint**: The MCP catalogue description AND the README both advertise recursive deletion. SC-006 holds at both surfaces.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Pre-merge quality gates. The constitution requires lint + typecheck + build + test all to pass before merge.

- [X] T022 Run `npm run lint` — fix any new warnings introduced by Phases 2–6. Zero warnings required (constitution Section 2). Pay particular attention to unused imports in `handler.ts` and the typed-error file.
- [X] T023 Run `npm run typecheck` — zero errors required. The new `attemptWithVerification` generic should typecheck cleanly; if `T` is the operation's return type and the verify branch returns `Promise<{outcome:'success'}>` regardless of `T`, double-check the return-type inference.
- [X] T024 Run `npm run build` — confirm `tsup` produces a clean bundle with the new `delete-file/` module included.
- [X] T025 Run `npm run test` — full suite passes: existing patch-content + surgical-reads + graph tests still green; the seven new delete-file tests all pass.
- [ ] T026 [P] Reverse-validation against the bug report: against a real Obsidian vault, run all three reproduction flows from [quickstart.md § 1 "Manual reproduction"](quickstart.md). Assert the "expected" outcomes hold and the "before this fix" outcomes do NOT recur. **DEFER to user — requires a real Obsidian vault.**
- [ ] T027 [P] PR description includes the constitution one-liner: `Principles I–IV considered.` per Constitution Section 4 / Compliance review. **DEFER to PR-creation time.**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately. T002 + T003 are mutually parallel; T001 must run first because T002 logically follows the "create both directories" step but can run with T003 since T003 is read-only.
- **Phase 2 (Foundational)**: Depends on Phase 1. T004 must complete before T005 (T005 imports the error classes T004 creates). T006, T007, T008 are all parallelizable with each other AND with T005 once T004 is done — they create independent files that don't import obsidian-rest.ts. T007 references the typed errors from T004, so T007 has T004 as a soft dependency.
- **Phase 3 (US1)**: Depends on Phase 2. T009 (handler) imports from T006 (schema), T007 (verify utility), T008 (recursive walk), and T004 (typed errors) — strict serial dependency on Phase 2 completion. T010 (tool.ts), T011 (file-tools.ts edit), and T012 (tools/index.ts edit) can run in parallel with T009 and with each other (they touch disjoint files). T013 (src/index.ts dispatcher) depends on T009. The five test tasks T014–T018 are mutually parallel and can all start once T013 lands.
- **Phase 4 (US2)**: Depends on Phase 3. T019 (timeout-verify tests) needs the dispatcher to be wired (T013) so it can call `server.handleToolCall`.
- **Phase 5 (US3)**: Depends on Phase 3 (same reason as Phase 4). T020 can run in parallel with T019.
- **Phase 6 (US4)**: T021 (README) depends only on the description wording from T010 being final. Can run in parallel with Phases 4 and 5.
- **Phase 7 (Polish)**: Depends on all prior phases. T022–T025 are sequential gate checks. T026 + T027 are deferred to user/PR time.

### User Story Dependencies

- **US1 (P1)**: No dependencies on other stories. Delivers the MVP — recursive delete works end-to-end with the bug report's reproductions resolved.
- **US2 (P1)**: Test-only phase. Depends on US1's handler being wired (the implementation that satisfies US2 ALSO satisfies US1 — same `attemptWithVerification` calls). Per Constitution Principle II, US2's tests ship in the SAME PR as US1's implementation.
- **US3 (P2)**: Test-only phase. Same dependency on US1's handler. Ships in the same PR.
- **US4 (P3)**: Tool-registration text (delivered by T010 within US1's phase) plus a small README edit. Can ship in the same PR or a follow-up PR.

### Parallel Opportunities

- T002 and T003 within Phase 1.
- T006, T007, T008 within Phase 2 (after T004; T005 can parallel with these because it edits a different file).
- T010, T011, T012, T013 within Phase 3 (T013 depends on T009 only; T010/T011/T012 are mutually parallel and can also overlap with T009).
- All five test files in Phase 3 (T014, T015, T016, T017, T018) are mutually parallel.
- T019 (US2 tests) and T020 (US3 tests) parallel with each other.
- T021 (README) parallel with Phases 4 and 5.
- T026 and T027 parallel with each other in Phase 7.

---

## Parallel Example: Phase 3 test files (after dispatcher wired)

```bash
# Once T013 (dispatcher wiring) is done, launch all five test files in parallel:
Task: "Create tests/tools/delete-file/registration.test.ts (T014)"
Task: "Create tests/tools/delete-file/schema.test.ts (T015)"
Task: "Create tests/tools/delete-file/single-file.test.ts (T016)"
Task: "Create tests/tools/delete-file/recursive.test.ts (T017)"
Task: "Create tests/tools/delete-file/partial-failure.test.ts (T018)"
```

## Parallel Example: Phase 2 utility modules

```bash
# Once T004 (typed errors) is done, launch the three utility modules in parallel:
Task: "Create src/tools/delete-file/schema.ts (T006)"
Task: "Create src/tools/delete-file/verify-then-report.ts (T007)"
Task: "Create src/tools/delete-file/recursive-delete.ts (T008)"

# T005 can parallel with these because it edits src/services/obsidian-rest.ts — disjoint file set.
```

---

## Implementation Strategy

### Single-PR delivery (recommended for this fix)

Constitution Principle II requires a tool's tests to land in the same change as the tool itself. So all of US1 + US2 + US3 + US4 land in one PR.

1. Complete Phase 1 + 2 (Setup + Foundational).
2. Complete Phase 3 (US1) — implementation + 5 tests.
3. Complete Phase 4 (US2) — 1 test file (4 sub-cases).
4. Complete Phase 5 (US3) — 1 test file (3 sub-cases).
5. Complete Phase 6 (US4) — README edit.
6. Complete Phase 7 (Polish) — lint/typecheck/build/test gates plus reverse-validation.
7. Open PR; reference `Principles I–IV considered` per constitution.

### MVP-first variant (if circumstances force splitting)

If the team wants to ship the recursive delete fix without the timeout-coherence regression coverage:

1. Phases 1 + 2 + 3 + 7 in one PR (US1 implementation + the five US1 tests + gates). Note: this PR still implements timeout coherence in the handler — it just doesn't have the dedicated timeout-verify regression test from US2. SC-002 / SC-005 are technically at risk of regression without that test.
2. Follow-up PR with Phases 4 + 5 + 6 (test coverage for US2 + US3, README for US4).

This split is **not recommended** — Phase 4 + 5 are small enough that bundling them is cheaper than two reviews.

### Reverse-validation as continuous-integration check

Once the test suite (Phases 3–5) is in place, the manual reproduction flow from quickstart.md § 1 doubles as a smoke check anyone can run before merging changes that touch the delete path or the typed-error layer.

---

## Notes

- **Auto mode** is active in this conversation, so a subsequent `/speckit-implement` invocation will execute these tasks autonomously. Each task is scoped tightly enough that an implementing agent can complete it from this file alone — no hidden context required.
- **No new dependencies** are added by this feature. Every package the implementation needs (`axios`, `zod`, `zod-to-json-schema`, `vitest`, `nock`) is already in `package.json`.
- **Behavioural compatibility** of the `safeCall` change (T005) is critical — every existing tool's tests must continue to pass with the typed-error subclasses replacing the generic `Error`. The subclasses preserve `.message` exactly, so this should be a no-op for unrelated callers, but verify before continuing.
- **Test fixtures use `nock.replyWithError({ code: 'ECONNABORTED', ... })`** rather than `delayConnection(11000)` to keep the suite fast and deterministic. See [research.md § R6](research.md#r6--test-fixtures-simulating-timeouts-deterministically) for the rationale.
- **No new mocks of the `ObsidianRestService` itself** — tests run against a `nock`-mocked HTTP layer to exercise the actual `safeCall` typed-error mapping end-to-end. Mocking the service would skip the layer this feature is fixing.
