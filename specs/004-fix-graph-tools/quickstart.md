# Quickstart: Verify the Fix Graph Tools work

This document walks through how to verify the fix manually (against a real vault) and via the test suite. Use it as the reproduction recipe in PR descriptions and as a smoke check after upgrading.

## Prerequisites

1. An Obsidian vault on disk with at least a few notes and some `[[wikilinks]]` between them.
2. `OBSIDIAN_VAULT_PATH` set in the environment to the absolute path of that vault — or a multi-vault config with at least one vault configured with `vaultPath`.
3. The MCP server built (`npm run build`) and either: invoked directly via `node dist/index.js` over stdio, or wired into a Claude Desktop / Claude Code MCP client.

## Manual verification (against a real MCP client)

1. **Confirm the precondition**: call `list_vaults`. The response MUST include at least one vault with `hasVaultPath: true`. If none does, set `OBSIDIAN_VAULT_PATH` and restart the server.

2. **Smoke-test each tool** — call each of the seven tools at least once. Pass criterion: every call returns a non-error response (or, for the per-note tools, an error whose message starts with `note not found:` rather than `Unknown tool`).

   Suggested call sequence (using a hypothetical vault with notes `Daily/2026-04-26.md` and `Projects/Inbox.md`):

   | # | Tool | Args | Expected response shape |
   |---|------|------|-------------------------|
   | 1 | `get_vault_stats` | `{}` | Object with `totalNotes`, `totalLinks`, `orphanCount`, `tagCount`, `clusterCount`, `skipped`, `skippedPaths` |
   | 2 | `get_vault_structure` | `{}` | Object with `tree` (nested folders), `skipped`, `skippedPaths` |
   | 3 | `find_orphan_notes` | `{}` | Object with `orphans` (array), `skipped`, `skippedPaths` |
   | 4 | `get_note_connections` | `{ "filepath": "Daily/2026-04-26.md" }` | Object with `filepath`, `outgoingLinks`, `backlinks`, `tags` (no envelope) |
   | 5 | `find_path_between_notes` | `{ "source": "Daily/2026-04-26.md", "target": "Projects/Inbox.md" }` | Object with `path` (array of paths) or `path: null` |
   | 6 | `get_most_connected_notes` | `{}` | Object with `notes` (sorted), `skipped`, `skippedPaths` |
   | 7 | `detect_note_clusters` | `{}` | Object with `clusters` (sorted), `skipped`, `skippedPaths` |

3. **Verify the `skipped` contract**: place a deliberately-malformed file in the vault — e.g. `corrupt.md` containing invalid UTF-8 bytes (`printf '\x80\x81' > /path/to/vault/corrupt.md`). Call `get_vault_stats` again. Pass criterion: the call still succeeds, `skipped` is now ≥ 1, and `skippedPaths` includes `corrupt.md`.

4. **Verify the precondition error**: temporarily run the server without `OBSIDIAN_VAULT_PATH` set. Call `get_vault_stats`. Pass criterion: response is `Error: Vault "<id>" does not have vaultPath configured (required for graph tools).` — NOT `Unknown tool`.

5. **Verify the not-found contract**: with `OBSIDIAN_VAULT_PATH` set, call `get_note_connections` with a path that doesn't exist (e.g. `{ "filepath": "does-not-exist.md" }`). Pass criterion: error message is `note not found: does-not-exist.md` — distinct from "found but no connections" (which would be a successful call with empty `outgoingLinks` and `backlinks`).

## Automated verification (test suite)

```bash
npm run test
```

Pass criteria:

- `tests/tools/graph/registration.test.ts` passes — each of the seven tools appears in `ALL_TOOLS` with a derived `inputSchema` of `type: 'object'` and a description containing the precondition phrase. Per-note tools additionally include the `note not found:` phrase.
- `tests/tools/graph/schema.test.ts` passes — each tool's zod validator rejects malformed input with the expected field path (eight failure cases across seven tools, covering Constitution Principle II's validation-failure requirement for every tool).
- `tests/tools/graph/handler-vault-stats.test.ts` passes — the FR-006 deep test successfully mocks `GraphService.getVaultStats`, calls `handleGetVaultStats`, and asserts the wrapper invokes the service correctly and parses the mocked return value into the envelope.
- `tests/tools/graph/handler-per-note.test.ts` passes — happy-path coverage for `get_note_connections` and `find_path_between_notes` (Constitution Principle II), including the FR-012 vault-id suffix and the `find_path_between_notes` "no path found" success case (`{ path: null }`).
- `tests/tools/graph/smoke.test.ts` passes — for each of the other six tool names, calling the dispatcher with minimal valid inputs returns a response whose text does NOT contain `Unknown tool`. The four aggregation rows additionally assert payload shape (presence of `skipped`, `skippedPaths`, and the primary array/object).

## Reverse-validation (optional but recommended)

Demonstrate that the regression net actually catches the bug class it's designed for:

1. Comment out one of the `case` branches in [src/index.ts](../../src/index.ts) — e.g. delete `case 'get_vault_stats':` and its body.
2. Run `npm run test`.
3. Observe: the `handler-vault-stats.test.ts` (FR-006) test fails. (Or, if you removed one of the four other aggregation tools, the corresponding row in `smoke.test.ts` fails with a row identifier matching the affected tool name — satisfying SC-006. If you removed one of the two per-note tools, both the `handler-per-note.test.ts` happy-path AND the `smoke.test.ts` row will fail.)
4. Restore the `case` branch.
5. Re-run tests; they pass again.

This sequence is the canonical demonstration of SC-003 and SC-006.

## Pre-merge checklist

- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` succeeds.
- [ ] `npm run test` passes (all suites, including the four new graph test files).
- [ ] Manual verification steps 1–5 above succeed against a real vault.
- [ ] README's "Available tools" section has been updated to list the seven graph tools with the `OBSIDIAN_VAULT_PATH` precondition stated.
- [ ] The constitution one-liner is included in the PR description: "Principles I–IV considered."
