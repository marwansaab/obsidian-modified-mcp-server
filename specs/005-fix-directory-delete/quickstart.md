# Quickstart: Verifying Fix Directory Delete

Three verification flows covering manual reproduction against a real Obsidian vault, the automated regression-test commands, and a one-line schema check that the new tool description is published correctly.

---

## 1. Manual reproduction (against a real Obsidian vault)

This re-runs the exact bug-report scenario from `spec.md § Input` and confirms both Fix A and Fix B land.

**Pre-flight**:

1. Obsidian is running with the Local REST API plugin enabled.
2. `OBSIDIAN_API_KEY` and the host/port are configured per the existing `getConfig()` flow.
3. The MCP server is built and pointed at this branch: `npm run build && node dist/index.js`.

**Reproduce non-empty directory** (Fix A):

```text
1. Call append_content with filepath = "1000- Testing-to-be-deleted/test.md", content = "test"
   → confirms the file appears (Obsidian creates the directory implicitly)
2. Call delete_file with filepath = "1000- Testing-to-be-deleted"
   → expected:  {"ok":true,"deletedPath":"1000- Testing-to-be-deleted","filesRemoved":1,"subdirectoriesRemoved":0}
   → before this fix: "Error: Obsidian API Error -1: timeout of 10000ms exceeded" + directory unchanged
3. Call list_files_in_vault
   → expected: "1000- Testing-to-be-deleted/" no longer appears in the returned list
```

**Reproduce empty directory** (Fix B coherence):

```text
1. Recreate the directory: append_content with filepath = "1000- Testing-to-be-deleted/test.md", content = "test"
2. Delete the file alone: delete_file with filepath = "1000- Testing-to-be-deleted/test.md"
3. Now call delete_file with filepath = "1000- Testing-to-be-deleted" (the empty directory)
   → expected:  {"ok":true,"deletedPath":"1000- Testing-to-be-deleted","filesRemoved":0,"subdirectoriesRemoved":0}
   → before this fix: same 10s transport-timeout error, even though the deletion succeeded
4. Call list_files_in_vault
   → expected: "1000- Testing-to-be-deleted/" no longer appears in the returned list
```

**Reproduce missing path**:

```text
1. Call delete_file with filepath = "this-path-never-existed.md"
   → expected:  Error: not found: this-path-never-existed.md
   → never:     "Error: Obsidian API Error -1: timeout of 10000ms exceeded"
```

If all three reproductions match the "expected" lines, Fixes A + B are working end-to-end against a real vault.

---

## 2. Automated regression tests (deterministic, against a `nock`-mocked upstream)

```bash
# All delete_file tests
npm run test -- tests/tools/delete-file

# Just the FR-012 + FR-013 regression files (the two named in the spec)
npm run test -- tests/tools/delete-file/recursive.test.ts
npm run test -- tests/tools/delete-file/timeout-verify.test.ts

# Type & lint gates (constitution-mandated)
npm run typecheck
npm run lint
```

Each file's responsibility:

| File | Scenario | Spec mapping |
|------|----------|--------------|
| `registration.test.ts` | `delete_file` appears exactly once in `ALL_TOOLS`; `inputSchema` is the `zod-to-json-schema` derivative of `DeleteFileRequestSchema`; description literally contains `"recursive"` | SC-006, FR-011, Constitution III |
| `schema.test.ts` | zod rejects `filepath: ""` and `filepath` missing; happy parse for valid input | Principle II "validation-failure path" |
| `single-file.test.ts` | delete_file on a regular file → `{ok:true, filesRemoved: 0, subdirectoriesRemoved: 0}`; nock asserts a single DELETE on `/vault/<filepath>` | FR-001 baseline |
| `recursive.test.ts` | Non-empty directory with two files + one nested subdirectory: nock'd listing pins iteration order; test asserts the DELETE calls happen in that exact order, then the final outer DELETE; final response has correct counts | **FR-012**, FR-001, FR-014 |
| `partial-failure.test.ts` | Mid-walk: first child delete succeeds, second errors out (mocked with a non-timeout 5xx); response is `Error: child failed: <path2> — already deleted: [<path1>]`; outer DELETE is NEVER issued | FR-003, Q1+Q4 clarifications |
| `timeout-verify.test.ts` | Three sub-cases: (a) outer DELETE times out, verification listing shows directory absent → `ok:true`; (b) outer DELETE times out, verification listing shows directory still present → `Error: outcome` (failure); (c) outer DELETE times out, verification listing also errors → `Error: outcome undetermined for <path>` | **FR-013**, FR-004–FR-009, Q3 clarification |
| `not-found.test.ts` | Parent listing does not contain target (or upstream returns 404) → `Error: not found: <filepath>`; never a transport-timeout error | FR-007, SC-003 |

All seven tests run deterministically without wall-clock waits — `replyWithError({ code: 'ECONNABORTED', ... })` simulates timeouts inline (per research.md R6).

---

## 3. Schema verification (one-liner)

After build, run a stub MCP `tools/list` request via the dev script to confirm the description ships:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js | jq '.result.tools[] | select(.name=="delete_file") | .description'
```

Expected: a string starting with `"Delete a file or directory from the vault. **When the path refers to a directory, the deletion is recursive..."` (the exact wording in `contracts/delete_file.md` § "Tool description"). This satisfies SC-006 — an LLM consumer can read the catalogue and learn the contract without invoking the tool.

---

## Sanity-check checklist before opening the PR

- [ ] All seven tests under `tests/tools/delete-file/` pass.
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` zero warnings.
- [ ] `npm run build` succeeds.
- [ ] Manual flow #1 above reproduces the expected outcomes against a real vault.
- [ ] No other tool's tests have regressed (`npm run test` whole-suite).
- [ ] `delete_file` appears **exactly once** in `ALL_TOOLS` (the registration test catches this, but worth eyeballing once).
