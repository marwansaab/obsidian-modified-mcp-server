# Quickstart: Verifying the Direct-Path Delete Verification Fix

This document covers three verification flows for spec 007:

1. **Manual smoke test** — reproduce the bug-report recipe against a real Obsidian vault and confirm the fix.
2. **Automated test commands** — what to run in CI / locally.
3. **Manual schema verification** — confirm the tool description still advertises the recursive contract.

---

## 1. Manual smoke test (bug-report reproduction)

Pre-conditions: a real Obsidian vault is running with the Local REST API plugin enabled, and this MCP server is configured against it.

**Setup the failing scenario** (the headline bug):

```text
Vault layout before:
  1000-Testing-to-be-deleted/
    issue2-test/
      file-A.md
      file-B.md
```

`1000-Testing-to-be-deleted/` MUST contain only `issue2-test/` as its child — no siblings — so that the upstream Local REST API will auto-prune `1000-Testing-to-be-deleted/` itself when `issue2-test/` is removed.

You can create the layout from the MCP `append_content` tool by writing:

- `1000-Testing-to-be-deleted/issue2-test/file-A.md` with any content
- `1000-Testing-to-be-deleted/issue2-test/file-B.md` with any content

**Trigger the fix path**:

Invoke `delete_file` with `filepath: "1000-Testing-to-be-deleted/issue2-test"`.

**Expected response** (post-fix):

```json
{
  "ok": true,
  "deletedPath": "1000-Testing-to-be-deleted/issue2-test",
  "filesRemoved": 2,
  "subdirectoriesRemoved": 0
}
```

**Expected response (pre-fix, for reference)**: `Error: outcome undetermined for 1000-Testing-to-be-deleted/issue2-test` — the bug.

**Confirm vault state** by invoking `list_files_in_vault` and verifying neither `1000-Testing-to-be-deleted/` nor `1000-Testing-to-be-deleted/issue2-test/` is present.

---

## 2. Automated test commands

```bash
# Run the full delete-file suite (existing 7 files + 3 new files):
npm run test -- tests/tools/delete-file

# Run only the spec 007 regression files:
npm run test -- tests/tools/delete-file/auto-prune.test.ts
npm run test -- tests/tools/delete-file/sibling-preserving.test.ts
npm run test -- tests/tools/delete-file/verified-still-present.test.ts

# Run the updated existing tests that switch from parent-listing to direct-path mocks:
npm run test -- tests/tools/delete-file/timeout-verify.test.ts
npm run test -- tests/tools/delete-file/recursive.test.ts
npm run test -- tests/tools/delete-file/single-file.test.ts
npm run test -- tests/tools/delete-file/partial-failure.test.ts
npm run test -- tests/tools/delete-file/not-found.test.ts

# Constitution gates:
npm run lint
npm run typecheck
npm run build
```

Each new test file asserts exactly one acceptance criterion from the spec:

| File | Asserts | Spec 007 FR |
|---|---|---|
| `auto-prune.test.ts` | Outer delete times out at transport, direct-path verification returns 404 (parent already auto-pruned but irrelevant) → success response with summary counts | FR-007 |
| `sibling-preserving.test.ts` | Outer delete times out, parent retains other siblings, direct-path verification returns 404 → success response | FR-008 |
| `verified-still-present.test.ts` | Outer delete times out, direct-path verification returns 200 (target still on vault) → `delete did not take effect: <path> (filesRemoved=<n>, subdirectoriesRemoved=<m>)` error | FR-011 |

The existing `timeout-verify.test.ts` continues to cover FR-009 (verification call itself fails for a non-deterministic transport reason → `outcome undetermined`).

The existing `single-file.test.ts`, `recursive.test.ts`, `partial-failure.test.ts`, and `not-found.test.ts` files continue to assert their respective spec 005 FRs — only their internal nock fixtures change to use direct-path verification mocks where verification is exercised.

### Determinism check (SC-005)

Run the suite three consecutive times to confirm no flake:

```bash
for i in 1 2 3; do npm run test -- tests/tools/delete-file || break; done
```

Expected: all three runs pass with identical pass counts.

### Response shape pinning (SC-004)

`auto-prune.test.ts` includes an assertion that the success-response JSON is byte-equivalent to spec 005's pinned shape:

```typescript
expect(JSON.parse(result.content[0].text)).toEqual({
  ok: true,
  deletedPath: '1000-Testing-to-be-deleted/issue2-test',
  filesRemoved: 2,
  subdirectoriesRemoved: 0,
});
```

The keys, types, and absence of any extra fields (e.g., no `verifiedAfterTimeout` flag) are explicit per spec 007 FR-006.

---

## 3. Manual schema verification

The tool description text changes from spec 005 in exactly one sentence (the verification mechanism wording). To confirm the published schema:

```bash
# Build and run the server, then issue an MCP `tools/list` request from any client.
# The `delete_file` entry's `description` field MUST contain:
#   - "When the path refers to a directory, the deletion is recursive" (spec 005 FR-011, unchanged)
#   - "single direct-path verification query" (spec 007 — new wording)
```

The `registration.test.ts` file from spec 005 is updated to assert both phrases.
