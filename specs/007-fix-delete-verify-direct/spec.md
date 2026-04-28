# Feature Specification: Fix Delete Verification (Direct-Path)

**Feature Branch**: `007-fix-delete-verify-direct`
**Created**: 2026-04-27
**Status**: Draft
**Input**: User description: "Fix Delete Verification — The wrapper's `delete_file` verification-on-timeout path currently queries the deleted target's parent directory listing to confirm the target is gone. When the upstream auto-prunes the parent directory itself (which happens automatically when the parent's last child is removed during a recursive delete), the parent listing call returns 404 — which the existing logic treats as 'outcome undetermined' per FR-009 / clarify Q3 answer (C). Resolution: switch the verification call from 'list the parent and check for the target's absence' to 'query the deleted target's path directly.' A 404 on the deleted path is positive evidence of successful deletion. A 200 (or any non-404 success) on the deleted path is positive evidence that the delete failed. The 'outcome undetermined' path is reserved for cases where the verification call itself fails for transport reasons that don't yield a deterministic 404-vs-success signal."

## Background

This feature is a follow-up correction to [specs/005-fix-directory-delete/spec.md](../005-fix-directory-delete/spec.md). Spec 005 introduced the verify-then-report contract (FR-004 through FR-009): on transport timeout the wrapper performs a single-shot verification query and surfaces success, failure, or "outcome undetermined" based on what that query observes. Spec 005 chose a parent-listing query as the verification mechanism. That choice has now been observed to fail in production for a recurring scenario — the headline scenario this feature exists to fix.

This spec changes **only** the verification-query mechanism. The response shapes, the abort-on-mid-walk-failure behaviour, and the rest of the spec 005 contract are unchanged.

## Clarifications

### Session 2026-04-27

- Q: What error response shape should the wrapper return when the direct-path verification observes the deleted target is still present (FR-003)? → A: Introduce a new error reason `delete did not take effect: <deletedPath>` carrying the same summary counts (`filesRemoved`, `subdirectoriesRemoved`) as the success response, so callers can reason about partial vault state — which children were already removed before the outer delete failed — without having to re-list the directory.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recursive delete whose parent becomes empty returns success (Priority: P1)

A caller invokes `delete_file` on a non-empty directory whose parent contains only that one directory as a child. The recursive walk completes and the upstream auto-prunes the now-empty parent as a side-effect. The wrapper's verification query for the deleted target must return the structured success response — not "outcome undetermined".

**Why this priority**: This is the headline scenario in the bug report. It fires deterministically on a common shape (a self-contained directory under an otherwise-empty parent) and produces a misleading error today even though the operation succeeded. Until this is fixed, callers cannot trust `delete_file`'s outcome reporting on directory deletes that empty their parent — they must wrap every call in a follow-up listing query, defeating the purpose of the spec 005 verify-then-report contract.

**Independent Test**: Create a directory `1000-Testing-to-be-deleted/issue2-test/` containing `file-A.md` and `file-B.md`, where `1000-Testing-to-be-deleted/` has only `issue2-test/` as its child. Invoke `delete_file` on `1000-Testing-to-be-deleted/issue2-test`. The wrapper returns the structured success response with `filesRemoved: 2`, `subdirectoriesRemoved: 0`, `deletedPath: "1000-Testing-to-be-deleted/issue2-test"`. A follow-up `list_files_in_vault` confirms the directory and its contents are gone.

**Acceptance Scenarios**:

1. **Given** a non-empty directory `parent/target/` whose parent `parent/` becomes empty after the recursive walk and is consequently auto-pruned by the upstream, **When** the caller invokes `delete_file` on `parent/target` and the upstream's delete call times out at the transport layer despite the operation completing on the vault, **Then** the wrapper queries `parent/target` directly, observes the 404, and returns the structured success response with the spec 005 summary counts — never "outcome undetermined".
2. **Given** a non-empty directory `parent/target/` whose parent `parent/` retains other siblings after the recursive walk (so the parent is NOT auto-pruned), **When** the caller invokes `delete_file` on `parent/target` and the upstream delete times out at the transport layer, **Then** the wrapper queries `parent/target` directly, observes the 404, and returns the structured success response — independent of parent state.
3. **Given** a multi-level auto-prune cascade where `grandparent/parent/target/` is deleted and both `parent/` and `grandparent/` become empty and get auto-pruned, **When** the caller invokes `delete_file` on `grandparent/parent/target` and the upstream delete times out at the transport layer, **Then** the wrapper queries `grandparent/parent/target` directly, observes the 404, and returns the structured success response — robust to any depth of auto-prune cascade.

---

### User Story 2 - "Outcome undetermined" narrows but still fires for genuine verification-call failures, and verified-still-present surfaces a new error (Priority: P1)

The "outcome undetermined" path from spec 005 FR-009 remains the correct response when the verification call itself cannot produce a deterministic absent-vs-present signal for the deleted path — for example, the verification call hits a connection reset, a non-404 5xx error, or its own transport timeout. After this fix, "outcome undetermined" continues to fire for those genuine cases, but no longer fires for the auto-prune scenario in Story 1.

**Why this priority**: Without this constraint, the fix could over-rotate and silently downgrade genuine undetermined cases into either false success or false failure. The spec 005 contract requires the wrapper to never report a definite outcome when the post-condition was not actually observed.

**Independent Test**: Drive the wrapper against a stand-in upstream that times out on `delete_file` at the transport layer and then returns a 500 (or a connection reset) on the direct-path verification query. The wrapper surfaces "outcome undetermined" — not success and not failure. Repeat with the verification query itself timing out: same result.

**Acceptance Scenarios**:

1. **Given** a `delete_file` call whose upstream HTTP call times out at the transport layer, **When** the direct-path verification query also fails for a transport reason that does not return a deterministic 404-vs-success signal (e.g., its own transport timeout, a connection reset, or a non-404 5xx response), **Then** the wrapper returns "outcome undetermined" per spec 005 FR-009 — never success and never a definite failure.
2. **Given** a `delete_file` call whose upstream HTTP call times out at the transport layer, **When** the direct-path verification query returns a 200 (or any non-404 success) showing the target is still present, **Then** the wrapper returns an error indicating the delete did not take effect — never success and never "outcome undetermined".

---

### User Story 3 - Single-file delete and per-item walk apply the same direct-path verification (Priority: P2)

Spec 005 FR-008 requires the timeout-then-verify behaviour to apply to per-item file and subdirectory deletes during the recursive walk as well as the outer directory delete. This story ensures that requirement is preserved: the new direct-path verification mechanism applies symmetrically to single-file deletes and to per-item deletes inside the recursive walk, not just to the outer directory delete.

**Why this priority**: This is a consistency requirement, not a new behaviour. It is lower priority than Stories 1 and 2 because the headline reproduction case is the outer directory delete, but the contract from spec 005 must remain symmetric across all `delete_file`-issued deletes.

**Independent Test**: Drive the wrapper against a stand-in upstream that times out on a single-file `delete_file` at the transport layer and returns 404 on the direct-path verification query. The wrapper reports the structured success response. Repeat with a per-item file delete inside a recursive walk: same result.

**Acceptance Scenarios**:

1. **Given** a single-file `delete_file` call whose upstream HTTP call times out at the transport layer despite the file actually being deleted, **When** the wrapper performs the direct-path verification query and observes a 404, **Then** the wrapper returns the structured success response.
2. **Given** a per-item file delete issued during the recursive walk whose upstream HTTP call times out at the transport layer, **When** the wrapper performs the direct-path verification query for that specific item path and observes a 404, **Then** the wrapper treats the per-item delete as successful and continues the walk.

---

### Edge Cases

- **Parent auto-prune (the trigger scenario)**: Verification proceeds via the deleted target path itself, so parent state is irrelevant. The wrapper does not look at the parent.
- **Multi-level auto-prune cascade**: Same — verification is on the deleted target path, so any depth of cascade above the target is irrelevant.
- **Sibling-preserving delete (parent retains siblings)**: Same — verification is on the deleted target path, so the wrapper does not need to reason about parent state.
- **Verification query returns 404**: Positive evidence of success. Wrapper reports the spec 005 structured success response.
- **Verification query returns 200 (or any non-404 success)**: Positive evidence of failure (target still present). Wrapper reports the `delete did not take effect: <deletedPath>` error with summary counts (`filesRemoved`, `subdirectoriesRemoved`) matching the children that were already successfully removed during the walk.
- **Verification query times out**: Reported as "outcome undetermined" per spec 005 FR-009.
- **Verification query returns a non-404 error response (e.g., 500, 502, connection reset)**: Reported as "outcome undetermined" per spec 005 FR-009 — the call did not produce a deterministic absent-vs-present signal.
- **Path was a file, not a directory, on a transport timeout**: Same direct-path verification applies. A 404 means the file is gone (success); a non-404 success means the file is still present (failure); any other failure of the verification query means undetermined.
- **Per-item delete inside the recursive walk with a transport timeout**: Same direct-path verification applies to the per-item path; the walk continues only when the verification confirms the per-item delete succeeded.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the wrapper performs the verification query mandated by spec 005 FR-004 (after a transport timeout on a `delete_file`-issued delete), it MUST query the deleted target's path directly. It MUST NOT use the parent directory's listing as a proxy for the target's existence.
- **FR-002**: A 404 response (or the upstream's deterministic equivalent for "path absent") on the direct-path verification query MUST be interpreted as positive evidence of successful deletion. The wrapper MUST return the spec 005 structured success response (`ok: true` with `filesRemoved`, `subdirectoriesRemoved`, `deletedPath`) for the directory case, and the equivalent single-file success response for the file case.
- **FR-003**: A 200 response (or any other non-404 success) on the direct-path verification query MUST be interpreted as positive evidence that the delete did not take effect. The wrapper MUST return an error with the reason `delete did not take effect: <deletedPath>` carrying the same summary counts (`filesRemoved`, `subdirectoriesRemoved`) as the spec 005 success response — never a success, never "outcome undetermined", and never the spec 005 `child failed: <path>` shape (which is reserved for mid-walk per-item failures, not post-walk outer-target failures). The counts let callers reason about which children were already successfully removed during the walk before the outer delete failed.
- **FR-004**: When the direct-path verification query itself fails for any reason that does not yield a deterministic 404-vs-success signal — including its own transport timeout, a connection reset, or a non-404 error response (e.g., 5xx) — the wrapper MUST return the "outcome undetermined" error per spec 005 FR-009. The wrapper MUST NOT retry the verification query (single-shot, consistent with FR-009).
- **FR-005**: The direct-path verification MUST apply symmetrically to (a) the outer directory delete in a recursive walk, (b) the single-file delete path, and (c) per-item file and subdirectory deletes issued during the recursive walk. This preserves the spec 005 FR-008 symmetry across all `delete_file`-issued deletes.
- **FR-006**: The success response shape introduced by spec 005 (`filesRemoved`, `subdirectoriesRemoved`, `deletedPath` for the directory case; the single-file equivalent for the file case) MUST be preserved unchanged by this fix. This is a verification-call refactor only, not a response-shape change.
- **FR-007**: An automated regression test MUST cover the auto-prune scenario specifically: a directory `parent/target/` containing files, where `parent/` has only `target/` as its child, with the upstream mocked to (a) time out the outer delete at the transport layer and (b) return 404 on the direct-path verification query for `parent/target`. The test MUST assert the wrapper returns the structured success response — never "outcome undetermined".
- **FR-008**: An automated regression test MUST cover the sibling-preserving scenario: a directory `parent/target/` with at least one sibling preserved under `parent/` after the delete, with the upstream mocked to time out the outer delete and return 404 on the direct-path verification query. The test MUST assert the wrapper returns the structured success response.
- **FR-009**: An automated regression test MUST cover the genuine "outcome undetermined" path: a transport timeout on the outer delete followed by a non-404 error (or its own timeout, or a connection reset) on the direct-path verification query. The test MUST assert the wrapper returns "outcome undetermined" — preserving the spec 005 FR-009 contract.
- **FR-010**: An automated regression test MUST assert the success response shape is byte-equivalent to the shape pinned by spec 005's tests for the directory case (`filesRemoved`, `subdirectoriesRemoved`, `deletedPath`), guarding against accidental shape regression during the verification refactor.
- **FR-011**: An automated regression test MUST cover the verified-still-present case: the upstream is mocked to (a) report all per-item child deletes as immediate successes, (b) time out the outer directory delete at the transport layer, and (c) return a 200 (or any non-404 success) on the direct-path verification query for the outer target. The test MUST assert the wrapper returns the `delete did not take effect: <deletedPath>` error with summary counts matching the children that were successfully removed during the walk — never a success, never the spec 005 `child failed: <path>` shape, and never "outcome undetermined".
- **FR-012**: The wrapper's `delete_file` tool description (advertised in the MCP `tools/list` response) MUST advertise the direct-path verification mechanism via the phrase "single direct-path verification query" (or semantically equivalent wording that names the direct-path approach), so an LLM consumer can reason about why a `delete did not take effect` response is meaningful (the wrapper actually checked the deleted path) without having to invoke the tool. The recursive-contract sentence introduced by spec 005 FR-011 ("When the path refers to a directory, the deletion is recursive...") MUST also remain in the description, unchanged. An automated registration test MUST assert both phrases are present.

### Key Entities

- **Direct-path verification query**: A single-shot query against the deleted target's exact path (not its parent's listing). Returns a deterministic absent-vs-present signal (404 vs. non-404 success) when the upstream is reachable, or a non-deterministic failure (timeout, connection reset, 5xx) otherwise.
- **Verification outcome**: One of three coherent states — `present` (non-404 success on the direct-path query, surfaced as the `delete did not take effect: <deletedPath>` error with summary counts mirroring the spec 005 success response), `absent` (404 on the direct-path query, surfaced as the spec 005 structured success response), or `undetermined` (verification call itself failed without a deterministic absent-vs-present signal, surfaced per spec 005 FR-009).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A `delete_file` call against a non-empty directory whose parent becomes empty after the operation (and consequently gets auto-pruned by the upstream) returns the structured success response in 100% of cases where the upstream actually completed the deletion. The bug-report reproduction (`1000-Testing-to-be-deleted/issue2-test`) returns success after this fix, not "outcome undetermined".
- **SC-002**: A `delete_file` call against a non-empty directory whose parent retains siblings after the operation also returns the structured success response — independent of parent state — in 100% of cases where the upstream actually completed the deletion.
- **SC-003**: Across the full automated regression suite for this feature, zero "outcome undetermined" responses are returned for cases where the deleted target is verifiably absent on the vault. The "outcome undetermined" code path fires only when the verification call itself produced no deterministic absent-vs-present signal.
- **SC-004**: The success response shape from spec 005 (`filesRemoved`, `subdirectoriesRemoved`, `deletedPath` for the directory case) is unchanged after this fix — verified by a regression test that compares the response JSON to the shape pinned by spec 005's regression tests.
- **SC-005**: The full regression suite for this fix runs deterministically (no flake) across at least three consecutive runs.
- **SC-006**: The reproduction recipe from the bug report — create `parent/target/` with files inside under an otherwise-empty `parent/`, call `delete_file` on `parent/target` — returns the structured success response 100% of the time across two consecutive test runs (matching the determinism level at which the bug was originally reproduced on 2026-04-27). SC-005's three-run automated determinism check supersedes this two-run target.
- **SC-007**: When the outer delete times out at the transport layer and the direct-path verification observes the outer target is still present, the wrapper returns the `delete did not take effect: <deletedPath>` error with summary counts in 100% of such cases — never a success, never the `child failed: <path>` shape, and never "outcome undetermined".

## Assumptions

- The upstream Obsidian Local REST API exposes a path-query endpoint that returns 404 for absent paths and a non-404 success for present paths, and the wrapper can call it with the deleted target's exact path. This is the same kind of query the wrapper already issues elsewhere when it needs to check whether a specific path exists; no new upstream capability is assumed.
- The upstream Local REST API plugin auto-prunes empty parent directories regardless of OS — observed on Windows during the bug reproduction on 2026-04-27 and assumed to apply on other platforms. The fix must work whether or not auto-prune happens, because the direct-path verification is independent of parent state.
- Spec 005's response shape (`filesRemoved`, `subdirectoriesRemoved`, `deletedPath`) and FR-009 "outcome undetermined" semantics are the established contract. This spec narrows *when* "outcome undetermined" fires (only on genuine verification-call failures, not on auto-pruned parents), without changing the shape or the semantics elsewhere.
- Spec 005 FR-008 (symmetric verify-then-report across the outer delete and per-item deletes during the recursive walk) is preserved. The direct-path verification mechanism applies to all `delete_file`-issued deletes, not only the outer one.
- Option A (walk up to grandparent on parent-404) was considered and rejected because the upstream's auto-prune cascade can go many levels deep; falling back one level just relocates the same failure mode rather than fixing it. Option B (verify the deleted path directly) is the resolution adopted by this spec.
- Regression tests run against a stand-in upstream (test double) rather than a real Obsidian instance, consistent with spec 005's existing test infrastructure. The new tests extend that infrastructure with mocks for the direct-path verification query.

## Out of Scope

- Changing the spec 005 success response shape, the abort-on-mid-walk-failure behaviour, the "not found" handling (FR-007 of spec 005), the trailing-slash normalisation (FR-010 of spec 005), the upstream-listing-order requirement (FR-014 of spec 005), or any other element of spec 005's contract that is not the verification-query mechanism itself.
- Changing the wrapper's transport timeout duration.
- Adding retry logic to the verification query (still single-shot per spec 005 FR-009).
- Discovering or compensating for upstream auto-prune behaviour at any layer other than the verification query — the wrapper does not need to know whether auto-prune happened, only whether the deleted target is absent.
