# Baseline Coverage Note (Phase 2 / T007)

Working note internal to feature branch `009-test-infrastructure`. Captures the
coverage report after Phase 1 wiring, before any AS-IS test under
`tests/inherited/` exists. T021 will record the final achieved-floor value
into this same file at the end of Phase 4.

## How this was produced

After T001–T006 (devDependency added, `vitest.config.ts` wired with the
coverage block but `thresholds` omitted, `coverage/` gitignored,
`tests/inherited/{tools,services}/` scaffolded with the README), this command
produced the report:

```
npm test
```

Read from `coverage/coverage-summary.json` and the `text` reporter table.

## Aggregate baseline (Phase 2)

| Metric     | Total | Covered | Pct    |
|------------|-------|---------|--------|
| Statements |   832 |     411 | 49.39% |
| Branches   |   444 |     128 | 28.82% |
| Functions  |   158 |     100 | 63.29% |
| Lines      |   796 |     399 | 50.12% |

The single gated metric (per `/speckit-clarify` Q2) is **statements**.
The aggregate baseline statement coverage of `src/` is **49.39%**.

## Per-file baseline — files in scope for spec 009 (FR-009)

Inherited tool metadata files (each is a pure `Tool[]` export with ≤ 1
executable statement; the actual logic lives in the dispatcher in
`src/index.ts`):

| File                            | Stmts (covered/total) | Pct  | Notes                                  |
|---------------------------------|-----------------------|------|----------------------------------------|
| `src/tools/file-tools.ts`       |          1 / 1        | 100% | metadata only — logic in `index.ts`    |
| `src/tools/search-tools.ts`     |          1 / 1        | 100% | metadata only — logic in `index.ts`    |
| `src/tools/write-tools.ts`      |          1 / 1        | 100% | metadata only — logic in `index.ts`    |
| `src/tools/vault-tools.ts`      |          1 / 1        | 100% | metadata only — `list_vaults` in `index.ts` |
| `src/tools/periodic-tools.ts`   |          1 / 1        | 100% | metadata only — logic in `index.ts`    |
| `src/tools/obsidian-tools.ts`   |          1 / 1        | 100% | metadata only — logic in `index.ts`    |
| `src/tools/semantic-tools.ts`   |          4 / 4        | 100% | metadata + `assertValidFindSimilarNotesRequest` |

Inherited services and root files (the real targets — substantial uncovered
logic):

| File                                | Stmts (covered/total) | Pct    | Where the gaps are                                                                  |
|-------------------------------------|-----------------------|--------|-------------------------------------------------------------------------------------|
| `src/services/obsidian-rest.ts`     |        40 / 82        | 48.78% | Most REST methods are uncovered. Existing list_tags / delete-file tests touch only a slice. |
| `src/services/smart-connections.ts` |        11 / 46        | 23.91% | `isAvailable`, `search`, and most of `findSimilar` error paths uncovered.           |
| `src/index.ts`                      |        55 / 227       | 24.22% | Dispatcher arms for ~16 inherited tools entirely uncovered; `runPatternSearch`, helpers `getVaultConfig`/`getRestService`, `list_vaults` and `default` arms also uncovered. |
| `src/config.ts`                     |         0 / 50        |  0.00% | Module not imported by any current test (existing tests inject `VaultConfig` directly). |

Out of scope for spec 009 per FR-009 (fork-authored, MUST NOT be re-tested
by this feature):

| File                                       | Stmts pct | Notes                                                                              |
|--------------------------------------------|-----------|------------------------------------------------------------------------------------|
| `src/services/obsidian-rest-errors.ts`     |    100%   | Fork-authored (spec 005). Already covered by `tests/tools/delete-file/*`. ✓        |
| `src/services/graph-service.ts`            |  37.98%   | Fork-authored (spec 002 — Graph tools). Gaps here are out of scope; follow-up spec.|
| `src/tools/delete-file/*`                  |  ~93%     | Fork-authored (spec 005 — Delete file). ✓                                          |
| `src/tools/graph/*`                        |   100%    | Fork-authored (spec 002 — Graph tools). ✓                                          |
| `src/tools/list-tags/handler.ts`           |  66.66%   | Fork-authored (spec 008 — Tag Management). ✓                                       |
| `src/tools/patch-content/*`                |   100%    | Fork-authored (spec 003 — Patch content). ✓                                        |
| `src/tools/surgical-reads/*`               |   100%    | Fork-authored (spec 004 — Surgical reads). ✓                                       |
| `src/utils/path-normalisation.ts`          |   100%    | Fork-authored. ✓                                                                   |
| `src/types.ts`                             |  0% / 0   | Type-only — V8 sees zero statements after type-erasure. No coverage needed.        |

## Implications for Phase 4 (AS-IS test placement)

- T010–T016 (per-tool-file tests): the source files have only 1 executable
  statement each (the `Tool[]` export). Adding tests for these files is
  effectively adding **schema-validation tests on the registered tool list**
  plus, for `semantic-tools.ts`, tests on `assertValidFindSimilarNotesRequest`.
  Marginal coverage gain; behaviour-level coverage of these tools comes from
  T020 (dispatcher tests) which exercises the actual handler logic.

- T017 (`obsidian-rest.ts`): biggest single uncovered service. Direct tests
  per REST method (mocked with `nock`) raise this from 48.78% toward the
  termination point.

- T018 (`smart-connections.ts`): three methods, each with multiple error
  branches. Direct tests with `nock` raise this from 23.91% toward the
  termination point.

- T019 (`config.ts`): currently 0% — no test imports it. Direct tests with
  `vi.stubEnv` cover the env-var matrix and bring this to ~100%.

- T020 (`src/index.ts`): the largest absolute coverage gap. ~16 dispatcher
  arms, plus `runPatternSearch`, plus helpers, are entirely uncovered. This is
  the bulk of the AS-IS work. Tests instantiate `ObsidianMCPServer` directly
  and call `handleToolCall(name, args)`, mocking REST endpoints with `nock`.

The fork-authored bits already covered (delete-file, graph, list-tags,
patch-content, surgical-reads, path-normalisation, obsidian-rest-errors)
are NOT re-tested by Phase 4 (FR-009).

## Achieved-floor value (T021 — final aggregate after Phase 4)

After T010–T020 landed, `npm test` produced this aggregate:

| Metric     | Total | Covered | Pct    |
|------------|-------|---------|--------|
| Statements |   832 |     686 | 82.45% |
| Branches   |   444 |     324 | 72.97% |
| Functions  |   158 |     140 | 88.60% |
| Lines      |   796 |     656 | 82.41% |

**Achieved-floor value (rounded down to one decimal per
`contracts/coverage-config.md` "Implementation order" step 3): `82.4`.**

This is the value T023 writes into
`vitest.config.ts` → `test.coverage.thresholds.statements`. The 0.05
floating-point margin (82.45 actual → 82.4 enforced) leaves headroom
against V8 coverage-rounding drift between runs.

## Per-file final coverage (T021)

In-scope (FR-009 inherited):

| File                                  | Stmts pct (baseline → final) |
|---------------------------------------|------------------------------|
| `src/config.ts`                       | 0.00% → 98.00%               |
| `src/index.ts`                        | 24.22% → 91.62%              |
| `src/services/obsidian-rest.ts`       | 48.78% → 98.78%              |
| `src/services/smart-connections.ts`   | 23.91% → 93.47%              |
| `src/tools/file-tools.ts`             | 100% → 100% (metadata only)  |
| `src/tools/search-tools.ts`           | 100% → 100% (metadata only)  |
| `src/tools/write-tools.ts`            | 100% → 100% (metadata only)  |
| `src/tools/vault-tools.ts`            | 100% → 100% (metadata only)  |
| `src/tools/periodic-tools.ts`         | 100% → 100% (metadata only)  |
| `src/tools/obsidian-tools.ts`         | 100% → 100% (metadata only)  |
| `src/tools/semantic-tools.ts`         | 100% → 100%                  |

Out-of-scope (fork-authored — unchanged by this feature):

| File                                  | Stmts pct (unchanged) |
|---------------------------------------|-----------------------|
| `src/services/obsidian-rest-errors.ts`| 100%                  |
| `src/services/graph-service.ts`       | 37.98%                |
| `src/tools/delete-file/handler.ts`    | 90.00%                |
| `src/tools/delete-file/recursive-delete.ts` | 90.00%          |
| `src/tools/list-tags/handler.ts`      | 66.66%                |
| `src/tools/graph/handlers.ts`         | 100%                  |

The remaining gaps (lines uncovered after Phase 4) are documented in
`testing-md-draft.md` under "Uncovered by design" (T022 output).

## Termination evidence (T021 / FR-009 termination condition)

Per FR-009, AS-IS work terminates when "further tests would either
duplicate existing coverage, exercise unreachable defensive branches,
or require modifying `src/`". The remaining 17.55% uncovered breaks down
as:

- **Out-of-scope fork-authored bits** (graph-service.ts, list-tags/handler.ts,
  delete-file/*) — these are owned by their own specs (002, 005, 008) and
  re-testing them is forbidden by FR-009.
- **Fork-authored dispatcher arms in `src/index.ts`** — the
  `case 'list_tags'`, `case 'patch_content'`, `case 'get_heading_contents'`,
  `case 'get_frontmatter_field'`, `case 'delete_file'`, the seven graph-tool
  arms, `case 'find_similar_notes'`, plus the helpers `getGraphService` /
  `getSemanticService`. The fork-authored handler tests call handlers
  directly, bypassing the dispatcher arm. Coverage of these arms is the
  responsibility of follow-up specs that improve fork-authored tests.
- **Process-shutdown infrastructure** in `src/index.ts` — the
  `process.on('SIGINT'/'SIGTERM')` handlers (lines 543-551). Triggering
  these lines requires sending an OS signal to the test runner, which is
  not test-suite behaviour.
- **MCP transport-layer wrapping** in `setupHandlers` — the
  `CallToolRequestSchema` request handler's catch block that converts
  errors into `isError: true` responses. Exercised only when the MCP
  transport carries a real request; the dispatcher arms themselves
  (covered by Phase 4 tests) bypass this layer by calling
  `handleToolCall` directly.
- **Genuinely-unreachable defensive lines** — the non-AxiosError rethrow
  in `safeCall` (`obsidian-rest.ts:58`); `runPatternSearch`'s
  `vault.vaultPath` truthy check is covered, but the inline value-of
  fallbacks in `loadVaults` (`config.ts:99`) for an empty
  `Object.values(...)` of OBSIDIAN_VAULTS_JSON are guarded against
  upstream by the array-or-object normalization step.

`npm test` shows `Statements   : 82.45% ( 686/832 )` and adding any
additional plausible test against the FR-009 in-scope files yields no
new statement coverage without modifying `src/`. **Termination reached.**
