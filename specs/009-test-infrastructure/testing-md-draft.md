# `TESTING.md` — Working Draft (T022 input)

> Internal to feature branch `009-test-infrastructure`. T025 promotes this
> content into the canonical repo-root `TESTING.md`. The
> "Uncovered by design" section below is the authoritative list compiled
> while writing the AS-IS tests in Phase 4.

The canonical sections (running tests, the build gate, ratcheting,
AS-IS vs. fork-authored, smoke test) are sourced from `quickstart.md`
and reproduced verbatim in T025.

---

## Uncovered by design

The AS-IS backfill achieves 82.4% aggregate statement coverage of `src/`.
The remaining ~17.6% is uncovered by design. Each line in this section is
either out of scope for spec 009, unreachable from outside the module,
or owned by a different feature spec.

### Process-shutdown infrastructure (`src/index.ts:543-551`)

```ts
process.on('SIGINT', () => {
  console.error('Received SIGINT, shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down');
  process.exit(0);
});
```

These handlers fire when the OS sends `SIGINT` (Ctrl-C) or `SIGTERM`
(kill) to the running MCP server process. In a test suite, no such
signal is delivered — the test process owns its own signal handling.
Triggering these lines from a test would require either sending a real
signal to the vitest worker (which would terminate the suite) or
extracting them into a testable helper, which is a `src/` modification
forbidden by FR-006.

**Verdict**: leave uncovered. These lines are infrastructure-level and
their behaviour is trivially obvious from the source.

### Fork-authored dispatcher arms in `src/index.ts`

The dispatcher in `ObsidianMCPServer.handleToolCall` has cases for tools
that were authored by this fork's specs 001-008:

| Line(s) | Case                     | Owner spec                          |
|---------|--------------------------|-------------------------------------|
| ~322    | `case 'list_tags'`       | spec 008 (Tag Management)           |
| ~343    | `case 'get_heading_contents'` | spec 004 (Surgical reads)      |
| ~346    | `case 'get_frontmatter_field'` | spec 004 (Surgical reads)     |
| ~359    | `case 'patch_content'`   | spec 003 (Patch content)            |
| ~382    | `case 'delete_file'`     | spec 005 (Recursive directory delete) |
| ~486    | `case 'get_vault_stats'` | spec 002 (Graph tools)              |
| ~489    | `case 'get_vault_structure'` | spec 002                       |
| ~492    | `case 'find_orphan_notes'` | spec 002                          |
| ~495    | `case 'get_note_connections'` | spec 002                       |
| ~498    | `case 'find_path_between_notes'` | spec 002                    |
| ~501    | `case 'get_most_connected_notes'` | spec 002                   |
| ~504    | `case 'detect_note_clusters'` | spec 002                       |

Plus the helpers each spec uses:

- `getGraphService(vaultId)` (lines ~103-112) — owned by spec 002
- `getSemanticService(vaultId)` (lines ~114-125) — owned by spec 006

Each of these arms is a `return handle<X>(args, this.get<Service>(vaultId))`
delegation. The fork-authored tests for these specs call the underlying
handler functions DIRECTLY (e.g., `handleListTags(args, rest)`),
bypassing the dispatcher arm — so the dispatcher arm itself shows as
uncovered in the report, even though every behaviour it routes is
fully tested.

**Verdict**: out of scope for spec 009 (FR-009 explicitly says the
already-covered fork features MUST NOT be re-tested). A future
follow-up spec covering "dispatcher-level integration tests for
fork-authored tools" can lift these to 100% in one shot — that work is
deliberately deferred until at least one upstream merge has demonstrated
that dispatcher-arm regressions actually slip past the existing
direct-handler tests.

### MCP transport wrapping in `setupHandlers` (`src/index.ts:256, 261-269`)

```ts
this.server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: ALL_TOOLS };
});

this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await this.handleToolCall(name, args ?? {});
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Tool ${name} failed:`, message);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});
```

These handlers fire only when an actual MCP transport message arrives
(an MCP client somewhere on the other end of stdio sending a JSON-RPC
request). Phase 4 tests bypass this layer by calling `handleToolCall`
directly — which is the ONLY way to exercise dispatcher arms without
spinning up a real stdio transport. Adding tests that send fake MCP
messages over a mocked transport would require introducing a second
SDK-level mocking pattern with no behaviour gain — every behaviour is
already covered at the dispatcher level.

**Verdict**: leave uncovered. The transport-wrapping logic is a thin
adapter; its only behaviour beyond the dispatcher is the
"convert thrown error to isError:true response" branch, which is trivial
and reviewable from the source.

### Non-AxiosError rethrow in `safeCall` (`src/services/obsidian-rest.ts:58`)

```ts
private async safeCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AxiosError) {
      ... // mapped to ObsidianApiError / ObsidianTimeoutError / ObsidianNotFoundError
    }
    throw error;  // <— this line
  }
}
```

To reach this line, a non-AxiosError must be thrown inside the `fn`
closure. Since every closure in `obsidian-rest.ts` is `await this.client.<method>(...)`
(axios), and axios always wraps any error it throws as an AxiosError,
this `throw error` line is reachable only via Node-internal failures
that bypass axios's error wrapping (e.g., a thrown literal from a
custom interceptor — but no custom interceptor is registered).

**Verdict**: genuinely unreachable from outside the module without a
`src/` modification. Documented and left uncovered per the spec edge
case "A line in `src/` is genuinely unreachable".

### `loadVaults` empty-fallback line (`src/config.ts:99`)

The line `if (Object.keys(vaults).length === 0) { throw new Error('No vaults configured'); }`
in `resolveDefaultVault` defends against `loadVaults` returning an empty
map. But `loadVaults` either returns a single-vault object (from
`OBSIDIAN_API_KEY`), or the multi-vault result of `loadVaultsFromJson`
(which already throws "must describe at least one vault" on empty input).
So `vaults` is non-empty by the time `resolveDefaultVault` runs.

**Verdict**: defensive branch unreachable from outside without a `src/`
modification. Documented and left uncovered.

### `runPatternSearch` outer break on filesToSearch growth (`src/index.ts:190`)

```ts
for (const folder of folders) {
  const absFolder = join(baseDir, folder);
  await walkDir(absFolder);
  if (filesToSearch.length >= maxMatches) break;
}
```

This is the FOLDER loop's break, NOT the inner pattern-loop break (which
IS covered). It fires when the cumulative number of files-to-search
across folders exceeds `maxMatches`. Triggering it requires (a) multiple
folders in `scope.folders`, AND (b) more than `maxMatches` markdown
files across those folders. The fixture vault built by
`tests/inherited/index.test.ts` has only ~3 .md files — far below the
default maxMatches of 100 — so this break never fires in tests.

**Verdict**: reachable from outside; not covered to avoid bloating the
fixture vault. A future test that builds a fixture with > 100 .md files
and invokes pattern_search with `maxMatches: 50` would cover this line.
Deferred as low-value; the break's behaviour is trivially obvious.

### Smart-connections fallback paths (lines 64, 118, 146)

- Line 64: `return { available: false, message: \`Unexpected status: ${response.status}\` };`
  — fires when an upstream `/search/smart` returns a 2xx other than 200.
  nock's `.reply(204)` produces a 204 with no body, but axios's default
  `validateStatus` accepts 2xx so the response.status stays at 204 and
  the if-check returns the unexpected-status message. This IS reachable;
  consider adding a test if termination criterion is borderline.

- Line 118: `throw error;` final fallback in `search()` for non-AxiosError
  — same reachability story as `obsidian-rest.ts:58`.

- Line 146: `throw error;` final fallback in `findSimilar()` — same.

**Verdict**: line 64 is reachable; lines 118 and 146 are unreachable
without `src/` mods. The reachable line could be covered by a follow-up
test if the floor needs to ratchet upward.

---

## Summary

The 17.6% uncovered breaks down as:
- ~10% fork-authored dispatcher arms + helpers (out of scope, FR-009)
- ~3% fork-authored modules (graph-service, list-tags, delete-file —
  already covered by their own specs to the level those specs achieved;
  not re-tested by spec 009)
- ~2.5% MCP transport-wrapping + process-shutdown infrastructure
- ~2% genuinely-unreachable defensive branches

The achieved-floor value (82.4%) acknowledges this remainder.
