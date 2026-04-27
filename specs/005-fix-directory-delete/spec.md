# Feature Specification: Fix Directory Delete

**Feature Branch**: `005-fix-directory-delete`
**Created**: 2026-04-27
**Status**: Draft
**Input**: User description: "Fix Directory Delete — The `delete_file` MCP tool currently returns a transport-timeout error in two distinct directory scenarios: (1) on a non-empty directory the delete is non-recursive AND the wrapper reports a 10s timeout error while leaving the directory unchanged; (2) on an empty directory the delete actually succeeds upstream but the wrapper still surfaces the same 10s timeout error, so the caller cannot tell from the response whether the operation worked. Fix both: make directory deletes recursive (Fix A) and make the response coherent with the actual upstream outcome by performing a verification re-query on transport timeout (Fix B)."

## Clarifications

### Session 2026-04-27

- Q: When the recursive walk aborts mid-flight because a contained child failed to delete, what should the error response include beyond naming the offender? → A: Include the offending child path plus the list of child paths that were already successfully deleted before the abort.
- Q: What should the success response include on a recursive directory delete? → A: A success indicator naming the deleted directory plus summary counts of how many files and how many subdirectories were removed (no full path inventory).
- Q: How should the wrapper handle a verification re-query that itself fails (whether by transport timeout or by a non-timeout upstream error such as 5xx)? → A: Treat any verification-query failure (timeout or non-timeout error) uniformly as "outcome undetermined" — single shot, no retry.
- Q: What is the scope of the "already-deleted child paths" list in the partial-failure error response — direct children only, or every successfully removed path during the recursive walk? → A: Every successfully removed path during the recursive walk (files and intermediate subdirectories), each as a full relative path under the target directory.
- Q: In what order should the recursive walk visit children? → A: In the order returned by the upstream listing endpoint, with no extra sorting in the wrapper. Tests pin order via the mocked listing fixture.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recursive directory delete returns a clear outcome (Priority: P1)

An LLM caller (or an integration consuming this MCP server) wants to remove a directory and everything underneath it in a single tool call. Today, calling `delete_file` on a non-empty directory leaves the directory untouched and returns a confusing 10-second transport-timeout error. After this fix, the caller issues a single `delete_file` call against the directory path and the wrapper removes the directory and all of its contents recursively, returning a clear success indicator.

**Why this priority**: This is the headline pain point that triggered the bug report. Without it, every consumer must either pre-walk and pre-delete contents (duplicating work the wrapper should be doing) or treat directory deletion as unsupported. It is also a prerequisite for Story 2 to be observable on directories that actually have contents.

**Independent Test**: Create a directory containing at least one file (and ideally one nested subdirectory) by appending content to a path inside it, then invoke `delete_file` on the directory path. The call returns a clear success indicator and a follow-up vault listing on the parent confirms the directory is gone. No prior emptying step is required from the caller.

**Acceptance Scenarios**:

1. **Given** a directory `1000- Testing-to-be-deleted/` that contains one file `test.md`, **When** the caller invokes `delete_file` with `1000- Testing-to-be-deleted`, **Then** the tool returns a clear success indicator and the directory is no longer present in the parent's listing.
2. **Given** a directory containing both files and a nested non-empty subdirectory, **When** the caller invokes `delete_file` on the outer directory, **Then** every file and subdirectory underneath is removed and the outer directory is removed last; the returned success indicator reflects the consolidated outcome.
3. **Given** a non-empty directory in which one contained file cannot be removed (for example, the upstream rejects the per-item delete), **When** the caller invokes `delete_file` on the directory, **Then** the wrapper aborts before issuing the final directory delete and returns an error that names the specific path that could not be removed AND lists every path that was successfully deleted during the recursive walk before the abort (files and intermediate subdirectories alike, each as a full relative path under the target); the outer directory remains in place because it is still non-empty.

---

### User Story 2 - Coherent response when the upstream call times out (Priority: P1)

A caller invokes `delete_file` and the upstream HTTP call exceeds the wrapper's transport timeout. Today the wrapper surfaces "Error: Obsidian API Error -1: timeout of 10000ms exceeded" regardless of what actually happened on the vault, which means the response is not a reliable signal of outcome — the caller has to issue a follow-up listing query to know what really happened. After this fix, the wrapper performs that verification re-query itself before reporting status, and the response always reflects the true post-condition on the vault.

**Why this priority**: This is the second of the two anomalies that motivated the bug report and is reproduced today on the empty-directory case. Without it, callers cannot trust success or failure responses for any directory delete and must wrap every call in defensive verification logic — an unstable contract for an LLM-facing tool.

**Independent Test**: Drive the wrapper against a stand-in upstream that completes the directory delete on the vault but does not return an HTTP response within the wrapper's transport timeout. The wrapper detects the timeout, queries the parent listing, observes that the target is absent, and reports success. Conversely, simulate an upstream that times out but leaves the directory in place; the wrapper observes presence on re-query and reports failure.

**Acceptance Scenarios**:

1. **Given** an empty directory, **When** the caller invokes `delete_file` on it and the upstream HTTP call exceeds the wrapper's transport timeout while the upstream actually completes the deletion, **Then** the wrapper performs a verification listing query on the parent, observes the directory is absent, and returns a clear success indicator — never the raw transport-timeout error.
2. **Given** a directory that the upstream fails to delete, **When** the upstream HTTP call also exceeds the wrapper's transport timeout, **Then** the wrapper performs the verification listing query, observes the directory is still present, and returns an error that names the failure — never reports success.
3. **Given** any `delete_file` call (file or directory) that returns a transport timeout, **When** the wrapper handles the timeout, **Then** it performs the verification re-query before deciding the outcome rather than propagating the raw timeout to the caller.

---

### User Story 3 - Clear "not found" for a missing path (Priority: P2)

A caller invokes `delete_file` with a path that does not exist in the vault. After this fix, the response is a clear "not found" error rather than a generic transport-timeout error, so the caller can branch on the outcome.

**Why this priority**: The bug report calls this out as a specific acceptance criterion. It is lower priority than Stories 1 and 2 because most production callers will already have observed the path before deletion, but it still affects contract clarity and is cheap to deliver alongside the other two fixes.

**Independent Test**: Invoke `delete_file` with a path that has never existed in the vault and confirm the response is a clear "not found" error — not a transport-timeout error and not a generic upstream failure.

**Acceptance Scenarios**:

1. **Given** a path that does not exist in the vault, **When** the caller invokes `delete_file` on that path, **Then** the response is a clear "not found" error.
2. **Given** a path that previously existed but has already been deleted, **When** the caller invokes `delete_file` on that path again, **Then** the response is a clear "not found" error rather than success and rather than a transport-timeout error.

---

### User Story 4 - Tool description advertises the recursive contract (Priority: P3)

LLM callers discover the `delete_file` contract through the MCP tool schema. After this fix, that schema's description states explicitly that directory deletes are recursive, so callers do not have to discover the behaviour empirically.

**Why this priority**: This is documentation in the schema, not new behaviour. It is needed for the contract to be self-describing to LLM consumers, but it cannot ship without the underlying behaviour from Stories 1 and 2.

**Independent Test**: Inspect the MCP tool schema for `delete_file` and confirm the description states that directory paths are deleted recursively (the directory itself plus all contained files and subdirectories).

**Acceptance Scenarios**:

1. **Given** a consumer that reads the MCP tool catalogue, **When** it inspects the `delete_file` tool description, **Then** the description says that when the path is a directory the deletion is recursive.

---

### Edge Cases

- **Recursion depth**: Deeply nested subdirectories (multiple levels) must all be removed. The wrapper traverses contents to whatever depth is present.
- **Mid-traversal failure**: If any contained file or subdirectory fails to delete, the wrapper aborts before issuing the outer directory delete and returns an error that names the offending path AND lists every path successfully deleted during the recursive walk before the abort (files and intermediate subdirectories alike, each as a full relative path under the target). Items already deleted before the failure remain deleted (best-effort, no rollback).
- **Empty directory**: Recursive delete on a directory with no contents skips the iteration step and goes straight to the final directory delete; the response remains coherent with the post-condition on the vault.
- **Path is a file, not a directory**: The existing single-file delete behaviour is preserved; the recursive logic only engages when the path resolves to a directory.
- **Path does not exist**: The caller receives a clear "not found" error — neither a transport-timeout nor a generic upstream failure.
- **Transport timeout on a per-item delete inside the recursive walk**: The wrapper applies the same verification re-query logic to per-item deletes as it does to the outer call, so an item that actually deleted on the vault despite a timeout is treated as deleted, and an item that genuinely failed despite a timeout is treated as a failure that names the offending child path.
- **Verification query itself fails**: If the verification re-query times out or fails with any non-timeout upstream error (e.g., 5xx, connection reset), the wrapper surfaces an error that explicitly says the outcome is undetermined — it never reports success or a definite failure when the actual post-condition was not observed, and it does not retry the verification query.
- **Concurrent modifications during the recursive walk**: If a contained item is added by another writer between the listing snapshot and the final directory delete, that new item will block the directory delete; the wrapper reports the failure naming the unexpected child rather than masking it as success.
- **Trailing slash or normalisation differences**: The directory detection treats `foo/` and `foo` as the same target.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the path passed to `delete_file` resolves to a directory, the wrapper MUST list the directory's contents, delete each contained file and subdirectory (recursively for subdirectories), and then delete the now-empty directory itself, all within a single tool invocation. On success the wrapper MUST return a success indicator that names the deleted directory and includes summary counts of the number of files removed and the number of subdirectories removed during the recursive walk (no full path inventory). For a single-file delete or an empty-directory delete the counts are 0.
- **FR-002**: The caller MUST NOT be required to empty a directory before invoking `delete_file` on it; recursive emptying is the wrapper's responsibility.
- **FR-003**: If any contained file or subdirectory fails to delete during the recursive walk, the wrapper MUST abort before issuing the final directory delete, MUST NOT remove the outer directory, and MUST return an error that (a) names the specific path that could not be removed and (b) lists every path successfully deleted during the recursive walk before the abort — files AND intermediate subdirectories alike, each presented as a full relative path under the target directory — so the caller can reason about the partial vault state.
- **FR-004**: When an upstream HTTP call made by the wrapper exceeds the wrapper's transport timeout, the wrapper MUST perform a verification listing query on the relevant parent (or vault root) to determine the actual post-condition on the vault before returning a status to the caller.
- **FR-005**: The wrapper MUST NOT return a transport-timeout error when the post-condition on the vault matches the success expected by the call (the directory is absent for a delete).
- **FR-006**: The wrapper MUST NOT return a success indicator when the post-condition on the vault contradicts success (the directory is still present after a delete attempt).
- **FR-007**: When the path passed to `delete_file` does not exist, the wrapper MUST return a clear "not found" error rather than a transport-timeout error or a generic upstream failure.
- **FR-008**: The wrapper MUST apply the same timeout-then-verify behaviour (FR-004 through FR-006) to the per-item file and subdirectory deletes issued during the recursive walk, not just the final outer-directory delete.
- **FR-009**: If the verification listing query itself fails for any reason — whether by transport timeout or by a non-timeout upstream error (e.g., 5xx, connection reset) — the wrapper MUST return an error that explicitly states the outcome is undetermined and MUST NOT report a definite success or a definite failure. The wrapper MUST NOT retry the verification query; the verification is a single-shot observation.
- **FR-010**: The wrapper MUST detect whether the supplied path is a directory before deciding between the single-file delete path and the recursive directory delete path; trailing-slash variants of the same path MUST be treated as the same target.
- **FR-011**: The MCP tool schema description for `delete_file` MUST state that, when the path refers to a directory, the deletion is recursive (the directory itself plus all contained files and subdirectories).
- **FR-012**: An automated regression test MUST cover the non-empty-directory case end-to-end against a stand-in upstream and assert that the wrapper iterates the contained files, issues a per-item delete for each, issues the final directory delete, and reports the consolidated outcome.
- **FR-013**: An automated regression test MUST cover the timeout-with-actual-success case (the upstream delete on the directory does not respond within the transport timeout but the directory is absent on the follow-up listing) and assert that the wrapper reports success rather than the raw transport timeout.
- **FR-014**: The recursive walk MUST visit children in the order returned by the upstream listing endpoint (no in-wrapper sorting or reordering). The wrapper makes no ordering guarantee independent of the upstream's listing — the upstream's order is the wrapper's order. This means the partial-failure deleted-paths list (FR-003) reflects upstream listing order, and regression tests pin that order via the mocked listing fixture.

### Key Entities

- **Vault path**: An identifier for a single file or a directory inside the user's Obsidian vault, as supplied to `delete_file`. May or may not exist; may resolve to either a file or a directory.
- **Directory listing**: The set of immediate children (files and subdirectories) under a given directory path, as observed via the wrapper's listing query against the upstream. Used both to drive the recursive walk and to verify post-conditions after a transport timeout.
- **Tool outcome**: The structured response returned to the caller. Has two coherent shapes:
  - **Success** — names the deleted path and, for a recursive directory delete, includes summary counts (number of files removed, number of subdirectories removed). For a single-file or empty-directory delete the counts are 0.
  - **Error** — names a specific reason: "not found", "child failed: <path>" (with a flat list of every path successfully deleted during the recursive walk before the abort — files and intermediate subdirectories alike, each as a full relative path under the target), or "outcome undetermined" (verification query itself did not return).
  Never the raw transport-timeout when a post-condition observation was possible.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A `delete_file` call against a non-empty directory returns a clear success indicator in 100% of cases where the recursive walk and final delete actually succeed on the vault, and the directory is absent on a follow-up listing in 100% of those cases.
- **SC-002**: A `delete_file` call against an empty directory never surfaces a raw transport-timeout error to the caller; the response always reflects the verified post-condition on the vault.
- **SC-003**: A `delete_file` call against a path that does not exist returns a clear "not found" error in 100% of cases, never a transport-timeout error.
- **SC-004**: For every transport timeout the wrapper experiences while servicing `delete_file`, the wrapper performs exactly one verification listing query before returning status; if that single verification query fails for any reason (timeout or non-timeout upstream error) the wrapper returns an explicit "outcome undetermined" error and does not retry.
- **SC-005**: Zero responses report success while the target directory is still present on the vault, and zero responses report transport-timeout failure while the target directory is actually absent on the vault — measured across the full automated regression suite for this feature.
- **SC-006**: An LLM consumer reading the MCP tool catalogue can determine from the `delete_file` description alone that directory deletes are recursive, without having to invoke the tool to discover that contract.
- **SC-007**: The end-to-end regression test for the non-empty-directory case runs against a stand-in upstream and passes deterministically (no flake) on every run.
- **SC-008**: The end-to-end regression test for the timeout-with-actual-success case runs against a stand-in upstream that simulates a transport timeout on the directory delete while presenting the directory as absent on the follow-up listing, and the test asserts that the wrapper reports success.

## Assumptions

- The upstream Obsidian local REST API exposes a directory listing endpoint that the wrapper can call to enumerate immediate children of a directory and to verify presence/absence of a path, and that endpoint is the same one already surfaced as `list_files_in_dir` / `list_files_in_vault` from this server.
- The upstream API exposes a per-item delete that the wrapper can invoke for each file and (recursively) for each contained subdirectory, and the upstream does not itself perform recursive deletion when given a directory path — that is precisely why the wrapper must do the walk.
- A best-effort recursive walk with no rollback on partial failure is acceptable: items deleted before a mid-walk failure stay deleted, the wrapper aborts before the final outer delete, and the caller is told which child path failed. This matches the behaviour described in the bug report ("aborts before the final directory delete and returns an error that names the offending child path") and is the convention for filesystem `rm -r`-style operations.
- The wrapper's existing transport timeout (currently 10 seconds for the symptom under investigation) remains in place; this feature changes how a timeout is interpreted, not the timeout duration itself. Any future change to the timeout duration is out of scope.
- Verification re-queries reuse the same transport configuration as the original call. The verification is single-shot: any failure of the verification query (transport timeout *or* non-timeout upstream error such as 5xx or connection reset) is reported uniformly as "outcome undetermined" without retry or back-off.
- The fix applies symmetrically to file deletes that experience a transport timeout — they get the same verify-then-report treatment — even though the headline bug report focuses on directories. This is consistent with the FR-008 requirement and avoids leaving file deletes with the same unreliable contract.
- Regression tests run against a stand-in upstream (test double) rather than a real Obsidian instance, so they can deterministically simulate the transport-timeout-with-actual-success and per-item-failure scenarios. The existing test infrastructure for this server supports this style of test.
- Directory detection uses the upstream listing endpoint (a path that lists as a directory is treated as a directory; a path that lists as a single file is treated as a file). No separate filesystem stat call is assumed.
