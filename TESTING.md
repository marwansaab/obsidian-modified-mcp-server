# Testing

This document is the developer-facing guide for the test infrastructure
in `obsidian-modified-mcp-server`. It covers how to run the suite, how
the build's coverage gate enforces a floor, how to ratchet that floor
up (or, in plain sight, down), the convention for separating AS-IS
characterization tests from fork-authored feature tests, and the
remaining "uncovered by design" lines.

## Running the tests

```bash
npm test
```

This runs the full Vitest suite under V8 coverage. On success you see:

- A list of test pass/fail lines (Vitest's standard output).
- A per-file coverage summary table at the end (the `text` reporter),
  showing statement / branch / function / line percentages for every file
  under `src/`.
- A `coverage/` directory containing:
  - `lcov.info` — machine-readable LCOV (Codecov, IDE viewers).
  - `lcov-report/index.html` — open in a browser for a line-by-line
    coloured view.
  - `coverage-summary.json` — aggregate totals; this is what the build
    gate reads.

Watch mode for development:

```bash
npm run test:watch
```

## What the build gate enforces

The build fails (non-zero exit code) if **aggregate statement coverage
across `src/`** drops below the value of
`test.coverage.thresholds.statements` in [`vitest.config.ts`](vitest.config.ts).

The current floor is **82.4%** — set by spec 009 to match the AS-IS
characterization-test backfill it landed.

The gate is intentionally narrow:

- **Statement coverage only.** Branch and function coverage are measured
  and reported but do not fail the build. (See spec 009 / `/speckit-clarify`
  Q2.)
- **Aggregate only.** Per-file dips are tolerated as long as the total
  holds. (See spec 009 / `/speckit-clarify` Q1.)
- **No special override.** Lowering the floor is a one-line edit to the
  same field that raises it — visible in `git diff` and caught in PR
  review. (See spec 009 / `/speckit-clarify` Q3.)

## Ratcheting the floor

After a PR that improves coverage, raise the floor:

1. Run `npm test` and read the `text` reporter's `All files` row (or open
   `coverage/coverage-summary.json` and read `total.statements.pct`).
2. Edit `vitest.config.ts`:
   ```typescript
   thresholds: { statements: <new higher value> }
   ```
3. Run `npm test` again to confirm the new floor passes.
4. Commit and PR.

Lowering the floor uses the same edit. PR review is the gate that catches
it.

## AS-IS characterization tests vs. fork-authored feature tests

The test suite is split by directory:

| Directory                | Contains                                              | Convention                                                                                                                  |
|--------------------------|-------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| `tests/inherited/`       | AS-IS characterization tests for upstream-inherited code | Encode each line's *current* behaviour as the contract. **Do not modify `src/` to make them pass.**                         |
| `tests/tools/<feature>/` | Fork-authored feature tests (each spec's tool)        | Encode the *intended* behaviour spec'd by the corresponding feature.                                                         |
| `tests/utils/`           | Tests for repo-internal utilities                     | Same intent-based discipline as `tests/tools/`.                                                                              |

A future audit of "which tests are encoding upstream behaviour and which
are encoding our deliberate behaviour?" is answered by directory location
alone — no need to read test bodies.

## Adding a test in the AS-IS subset

When adding a test to `tests/inherited/`:

1. Mirror the source path. Tests for `src/tools/foo.ts` live at
   `tests/inherited/tools/foo.test.ts`. Tests for `src/services/bar.ts`
   live at `tests/inherited/services/bar.test.ts`. Tests targeting
   root-level `src/` files (e.g., `src/index.ts`, `src/config.ts`) live
   directly under `tests/inherited/`.
2. Use `nock` for any HTTP interaction. Do not introduce another
   mocking library.
3. Encode the **observed** behaviour, not the intended one. If a line
   looks suspicious — even buggy — the test asserts what the code does
   today. Open a separate bug-fix spec to fix it; do not fix it here.
4. Confirm `git diff main..HEAD -- src/` is still empty after your
   change.

## Adding a test for a new fork-authored feature

When adding a test for a new feature spec:

1. Place it under `tests/tools/<feature-name>/` (mirroring the
   `src/tools/<feature-name>/` directory the feature creates).
2. Use `nock` for HTTP interactions.
3. Encode the intended behaviour spec'd by the feature — the test fails
   if the code doesn't match the spec.

## Running just the AS-IS subset

For audits or upstream-merge sanity checks:

```bash
npm test -- tests/inherited/
```

This runs every AS-IS characterization test and skips the fork-authored
feature tests. If any AS-IS test fails after an upstream merge, the merge
changed inherited behaviour — decide whether the new behaviour is
intended (update the test) or an unintended regression (revert/fix the
merge).

## Smoke test: gate is real, not advisory

To confirm the gate actually fails the build:

```bash
# Move one test out of the way (don't delete — keep it stashed).
git stash push -- tests/tools/list-tags/handler.test.ts

npm test
# Expected: exit code non-zero, with the message
#   "Coverage for statements (X%) does not meet global threshold (82.4%)"
echo $?  # non-zero

# Restore the test.
git stash pop
```

This is the same procedure spec 009's implementation used to verify
SC-001 / Acceptance Scenario 3 of User Story 1.

## What if a line in `src/` is genuinely unreachable?

Some defensive branches depend on Node-internal failure modes (e.g.,
`JSON.parse` of a value that has already been schema-validated and
cannot be malformed). These lines cannot be covered without modifying
`src/` to inject the failure — which spec 009's FR-006 forbids.

When you encounter one:

1. Leave the line uncovered.
2. Set / keep the floor at a value that acknowledges the uncovered
   remainder.
3. Document the line in the "Uncovered by design" section below, with
   one sentence explaining why it's unreachable from outside the module.

## Uncovered by design

The 82.4% floor acknowledges these intentionally-uncovered lines:

### Process-shutdown infrastructure (`src/index.ts:543-551`)

The `process.on('SIGINT'/'SIGTERM')` handlers fire only when the OS
sends a signal to the running MCP server process. Triggering them from
a test would require sending a real signal to the vitest worker (which
would terminate the suite) or extracting them into a testable helper —
the latter is a `src/` modification forbidden by spec 009 / FR-006.

### Fork-authored dispatcher arms in `src/index.ts`

The dispatcher in `ObsidianMCPServer.handleToolCall` has cases for
fork-authored tools — `list_tags`, `delete_file`, `patch_content`,
`get_heading_contents`, `get_frontmatter_field`, the seven graph-tool
arms (`get_vault_stats`, `get_vault_structure`, `find_orphan_notes`,
`get_note_connections`, `find_path_between_notes`,
`get_most_connected_notes`, `detect_note_clusters`), and
`find_similar_notes`. Plus the helpers `getGraphService` /
`getSemanticService`.

The fork-authored tests for these specs call the underlying handler
functions DIRECTLY (e.g., `handleListTags(args, rest)`), bypassing the
dispatcher arm. The arm itself shows uncovered. Coverage is the
responsibility of follow-up specs that improve fork-authored tests, NOT
of the AS-IS feature.

### MCP transport-wrapping in `setupHandlers` (`src/index.ts:256, 261-269`)

The `ListToolsRequestSchema` and `CallToolRequestSchema` request
handlers fire only when an actual MCP transport message arrives. The
test suite bypasses this layer by calling `handleToolCall` directly —
which is the only way to exercise dispatcher arms without spinning up a
real stdio transport.

### Non-AxiosError rethrow in `safeCall` (`src/services/obsidian-rest.ts:58`)

This `throw error` line is reachable only if a non-AxiosError is thrown
inside the closure passed to `safeCall`. Since every closure is
`await this.client.<method>(...)` (axios), and axios always wraps
errors as AxiosError, this line is genuinely unreachable from outside
the module without a `src/` modification.

### `loadVaults` empty-fallback (`src/config.ts:99`)

The `if (Object.keys(vaults).length === 0) { throw ... }` defends
against `loadVaults` returning empty. But `loadVaults` either returns a
single-vault object or the multi-vault result of `loadVaultsFromJson`
(which already throws on empty input). So this branch is unreachable
without modifying `src/`.

### Smart-connections fallback paths

- `src/services/smart-connections.ts:64` — the
  `Unexpected status: <code>` branch fires only when `/search/smart`
  returns a 2xx other than 200 (rare).
- Lines 118 and 146 — non-AxiosError rethrows in `search()` and
  `findSimilar()`, same reachability story as `obsidian-rest.ts:58`.

### `runPatternSearch` outer break on filesToSearch growth (`src/index.ts:190`)

The folder-loop break (`if (filesToSearch.length >= maxMatches) break;`)
fires only when the cumulative number of `.md` files across folders
exceeds `maxMatches` (default 100). The fixture vault used by
`tests/inherited/index.test.ts` has only ~3 files; covering this would
require a much larger fixture for marginal coverage gain.
