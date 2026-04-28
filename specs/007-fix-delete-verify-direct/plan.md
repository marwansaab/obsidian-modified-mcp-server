# Implementation Plan: Fix Delete Verification (Direct-Path)

**Branch**: `007-fix-delete-verify-direct` | **Date**: 2026-04-27 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/007-fix-delete-verify-direct/spec.md`

## Summary

Spec 005 introduced the verify-then-report contract for `delete_file`: on a transport timeout the wrapper performs a single-shot verification query and surfaces success, failure, or "outcome undetermined" based on what that query observes. Spec 005 chose a parent-listing query as the verification mechanism. That choice fails deterministically when the upstream Local REST API auto-prunes the parent as a side-effect of the recursive delete (the parent listing call returns 404 — "outcome undetermined" by spec 005's FR-009 — even though the operation actually succeeded).

This plan switches the verification mechanism from parent-listing to a **direct-path probe**: query the deleted target's path itself, interpret 404 as `'absent'` (success), 200 as `'present'` (failure), and any other failure as `'undetermined'`. The change is structurally narrow — the verification machinery (`attemptWithVerification`, the three call sites) keeps its shape; only the `verify` callback's data source switches from `listingHasName(rest, parent, name)` to `pathExists(rest, target, kind)`.

The Q1 clarification adds a new error category to the contract: `delete did not take effect: <path> (filesRemoved=<n>, subdirectoriesRemoved=<m>)` for the verified-still-present outcome on the outer/single-file path. The mid-walk per-item verified-still-present case continues to surface as the spec 005 `child failed: <path>` shape (vocabulary unity for the walk-abort path). The success response shape is preserved byte-for-byte (FR-006).

## Technical Context

**Language/Version**: TypeScript 5.6.x (strict mode, ES modules), compiled with `tsc --noEmit` clean and bundled with `tsup`. Inherited unchanged from spec 005.
**Primary Dependencies**: `@modelcontextprotocol/sdk` ^1.12.0, `axios` ^1.7.7, `zod` ^3.23.8, `zod-to-json-schema` 3.25.2. No new dependencies.
**Storage**: No new storage. The Obsidian vault on disk remains the system of record; this feature only changes the verification probe's URL.
**Testing**: `vitest` 4.1.5 + `nock` 14.0.13 — the same infrastructure spec 005 established. Three new test files; existing test fixtures shift from parent-listing-on-timeout to direct-path-on-timeout mocks.
**Target Platform**: Node.js >= 18; cross-platform. The fix applies on every platform — the upstream's auto-prune behaviour was observed on Windows 2026-04-27 but is not OS-specific (per spec 007 Assumption 2).
**Project Type**: Library / MCP server (single TypeScript project, `src/` + `tests/` mirror).
**Performance Goals**: Out of scope. The new direct-path probe replaces a parent-listing call with a path-specific call — the call count per timeout is unchanged (still single-shot per FR-009). For files the probe fetches the file content (small for typical Obsidian markdown notes); for directories the probe fetches the listing. Net I/O cost is comparable to spec 005's parent-listing.
**Constraints**: Constitution Principles I–IV apply. The wrapper's existing 10 000 ms transport timeout is preserved unchanged.
**Scale/Scope**: Same as spec 005 — typical Obsidian vault directories (dozens to low hundreds of files; recursion depth ≤ 5 levels typically).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution defines four normative principles ([.specify/memory/constitution.md](../../.specify/memory/constitution.md)). Each is evaluated against this feature:

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Modular Code Organization** | ✅ PASS | All changes land inside `src/tools/delete-file/`. The new `pathExists` helper and the new `DeleteDidNotTakeEffectError` class are added to the existing `verify-then-report.ts`, which is already the home of the verification machinery. The dead `listingHasName` helper is removed from `recursive-delete.ts`. No new module is created; no cross-module boundary shifts. The handler's catch block grows by one `instanceof` branch. The dispatcher in `src/index.ts` and `obsidian-rest.ts` are untouched. Cross-module imports remain `tool → handler → service → axios`. |
| **II. Public Tool Test Coverage (NON-NEGOTIABLE)** | ✅ PASS by design | `delete_file` is a registered public tool. The plan adds three new regression tests under `tests/tools/delete-file/` (auto-prune, sibling-preserving, verified-still-present) plus updates to existing tests' verification mocks. Both branches of Principle II are exercised: happy paths (auto-prune, sibling-preserving — verified-after-timeout success) AND error paths (verified-still-present — new error shape; outcome-undetermined — narrowed trigger). Spec 007 FR-007 / FR-008 / FR-009 / FR-010 / FR-011 each pin a specific assertion. |
| **III. Boundary Input Validation with Zod** | ✅ PASS | `DeleteFileRequestSchema` is unchanged. The `inputSchema` derivation is unchanged. The handler still calls `assertValidDeleteFileRequest(args)` before any upstream call. No new boundary surface is introduced — the `pathExists` helper is internal-only and is not directly callable by MCP clients. |
| **IV. Explicit Upstream Error Propagation** | ✅ PASS | The new `DeleteDidNotTakeEffectError` is an *explicit* documented recovery (Principle IV's "(a) handled with a documented recovery path" branch): the handler catches it and translates it to a structured `Error: delete did not take effect: <path> (...)` message, never silently swallowing the failure. The narrowed `OutcomeUndeterminedError` trigger condition (404 no longer triggers it under spec 007) is *more* specific than spec 005's behaviour, not less — silent successes that the spec 005 contract previously hid as `outcome undetermined` are now surfaced explicitly. The `pathExists` helper rethrows non-404 errors so they reach the explicit conversion site. |

**Gate result**: No constitution violations. No `Complexity Tracking` entries needed. Re-evaluated post-Phase-1 design (below) — still no violations.

## Project Structure

### Documentation (this feature)

```text
specs/007-fix-delete-verify-direct/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output: 5 design decisions
├── data-model.md        # Phase 1 output: delta vs. spec 005's data model
├── quickstart.md        # Phase 1 output: manual repro + automated test commands
├── contracts/           # Phase 1 output: superseding tool contract
│   └── delete_file.md
├── checklists/
│   └── requirements.md  # From /speckit-specify
├── spec.md              # From /speckit-specify (with 1 clarification)
└── tasks.md             # Phase 2 output (NOT created here — see /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── index.ts                                    # (unchanged — dispatcher delegates to handleDeleteFile)
├── services/
│   ├── obsidian-rest.ts                        # (unchanged — listFilesInDir + getFileContents already raise ObsidianNotFoundError on 404)
│   ├── obsidian-rest-errors.ts                 # (unchanged)
│   ├── graph-service.ts                        # (unchanged)
│   └── smart-connections.ts                    # (unchanged)
└── tools/
    ├── delete-file/
    │   ├── schema.ts                           # (unchanged)
    │   ├── tool.ts                             # MODIFIED: tool description's verification sentence updated to "single direct-path verification query"
    │   ├── handler.ts                          # MODIFIED: outer-dir verify-failure throws DeleteDidNotTakeEffectError; file-branch verify-failure also throws DeleteDidNotTakeEffectError; verify callbacks switch from listingHasName(...) to pathExists(...); catch block adds an instanceof DeleteDidNotTakeEffectError translation
    │   ├── recursive-delete.ts                 # MODIFIED: listingHasName removed; attemptChildDelete drops parentDir + childName params and accepts a kind: 'file' | 'directory' param; the per-item verify callback switches to pathExists(rest, childPath, kind)
    │   └── verify-then-report.ts               # MODIFIED: pathExists helper added; DeleteDidNotTakeEffectError class added; attemptWithVerification signature unchanged
    ├── file-tools.ts                           # (unchanged)
    ├── index.ts                                # (unchanged)
    ├── patch-content/                          # (unchanged)
    ├── surgical-reads/                         # (unchanged)
    └── graph/                                  # (unchanged)

tests/
└── tools/
    └── delete-file/
        ├── registration.test.ts                # MODIFIED: assert tool description contains the new "single direct-path verification query" phrase
        ├── schema.test.ts                      # (unchanged)
        ├── single-file.test.ts                 # MODIFIED: verification mock switches from parent-listing to direct-path on the file URL
        ├── recursive.test.ts                   # MODIFIED: verification mocks for per-item deletes switch to direct-path on the per-item URL
        ├── partial-failure.test.ts             # MODIFIED: verification mocks switch to direct-path
        ├── timeout-verify.test.ts              # MODIFIED: keep FR-009 outcome-undetermined assertion; verification mock switches to direct-path with a non-404 5xx response
        ├── not-found.test.ts                   # (unchanged — type-detection still uses parent listing for the not-found case)
        ├── auto-prune.test.ts                  # NEW: FR-007 — outer delete times out, parent has only the target as a child; direct-path verification returns 404 → success with counts
        ├── sibling-preserving.test.ts          # NEW: FR-008 — outer delete times out, parent retains siblings; direct-path verification returns 404 → success with counts
        └── verified-still-present.test.ts      # NEW: FR-011 — outer delete times out, direct-path verification returns 200 → DeleteDidNotTakeEffectError with summary counts
```

**Structure Decision**: No new module is introduced. The fix is structurally a *callback-source switch* (parent-listing → direct-path) plus one new error class. All edits stay inside `src/tools/delete-file/` (four files modified, zero added) and `tests/tools/delete-file/` (six existing files modified, three new files added). This matches the convention spec 005 established and respects the existing module boundaries (Constitution Principle I).

## Phase 0 — Outline & Research

See [research.md](research.md) for the full Decision / Rationale / Alternatives entries. Summary of the five research questions resolved:

- **R1 — Probe endpoint**: Reuse `rest.listFilesInDir(path)` for directory targets, `rest.getFileContents(path)` for file targets. Both already translate 404 → `ObsidianNotFoundError` via `safeCall`.
- **R2 — Helper location**: New `pathExists(rest, path, kind)` lives in `verify-then-report.ts`; the dead `listingHasName` is deleted from `recursive-delete.ts`.
- **R3 — Threading kind through the walk**: Add `kind: 'file' | 'directory'` parameter to `attemptChildDelete`; drop the now-unused `parentDir` and `childName` parameters.
- **R4 — New error class**: `DeleteDidNotTakeEffectError(targetPath, filesRemoved, subdirectoriesRemoved)` translates to MCP message `delete did not take effect: <path> (filesRemoved=<n>, subdirectoriesRemoved=<m>)`.
- **R5 — Test layout**: Three new files (`auto-prune.test.ts`, `sibling-preserving.test.ts`, `verified-still-present.test.ts`) plus updates to existing fixtures.

## Phase 1 — Design & Contracts

### Data model

See [data-model.md](data-model.md). Summary of changes vs. spec 005's data model:

- **Added**: `pathExists(rest, path, kind)` helper, `DeleteDidNotTakeEffectError` class.
- **Removed**: `listingHasName` helper.
- **Changed semantics (no class change)**: `OutcomeUndeterminedError`'s trigger condition narrows — a 404 on the verification call is no longer "undetermined" but positive evidence of `'absent'`.
- **Unchanged**: `DeleteFileRequest`, `DeleteFileSuccess`, `PartialDeleteError`, `WalkState`, `ObsidianTimeoutError` / `ObsidianNotFoundError` / `ObsidianApiError`.

### Contracts

See [contracts/delete_file.md](contracts/delete_file.md). The contract:

- Preserves the success-response shape byte-for-byte (FR-006 / SC-004).
- Adds a sixth error category — "Delete did not take effect" — for the verified-still-present outcome on the outer/single-file path.
- Updates one sentence in the tool description text to reflect the direct-path verification mechanism.
- Inherits all other behaviour from spec 005's contract; the spec 007 contract supersedes spec 005's as the live source of truth.

### Quickstart

See [quickstart.md](quickstart.md). Three verification flows:

1. Manual smoke test using the bug-report reproduction recipe (`1000-Testing-to-be-deleted/issue2-test`).
2. `npm run test -- tests/tools/delete-file` (full suite) plus the three new spec 007 test files individually.
3. Manual `tools/list` schema verification — confirm the description text contains the recursive-contract phrase (spec 005) AND the direct-path-verification phrase (spec 007).

### Agent context update

`CLAUDE.md` between the `<!-- SPECKIT START -->` / `<!-- SPECKIT END -->` markers updates to point at this plan rather than spec 006's plan.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations. This feature is a narrow follow-up to spec 005, structurally a callback-source switch + one new error class. It introduces:

- Zero new modules.
- Zero new runtime dependencies.
- Zero new MCP tools (the existing `delete_file` tool stays registered with the same input schema and the same success-response shape).
- One new error class (`DeleteDidNotTakeEffectError`) — explicitly required by the spec 007 Q1 clarification, replacing the previous misleading reuse of `PartialDeleteError` for the outer-only case.
- One removed helper (`listingHasName`) — dead code under the new contract.

No `Complexity Tracking` entries needed.
