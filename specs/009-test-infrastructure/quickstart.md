# Quickstart: Test Infrastructure (009)

This is the developer-facing guide for the test infrastructure
shipped by spec 009. The canonical version lives at the repo
root as `TESTING.md` (created by the implementation as part of
FR-008). This quickstart is the source from which `TESTING.md`
is derived.

---

## Running the tests

```bash
npm test
```

This runs the full Vitest suite under coverage. On success you
see:

- A list of test pass/fail lines (Vitest's standard output).
- A per-file coverage summary table at the end (the `text`
  reporter), showing statement / branch / function / line
  percentages for every file under `src/`.
- A `coverage/` directory containing:
  - `lcov.info` — machine-readable LCOV (Codecov, IDE viewers).
  - `lcov-report/index.html` — open in a browser for a
    line-by-line coloured view.
  - `coverage-summary.json` — aggregate totals; this is what the
    build gate reads.

## What the build gate enforces

The build fails (non-zero exit code) if **aggregate statement
coverage across `src/`** drops below the value of
`test.coverage.thresholds.statements` in
[`vitest.config.ts`](../../vitest.config.ts).

The gate is intentionally narrow:

- **Statement coverage only.** Branch and function coverage are
  measured and reported but do not fail the build. (See
  `/speckit-clarify` Q2 in [spec.md](spec.md).)
- **Aggregate only.** Per-file dips are tolerated as long as the
  total holds. (See `/speckit-clarify` Q1.)
- **No special override.** Lowering the floor is a one-line edit
  to the same field that raises it — visible in `git diff` and
  caught in PR review. (See `/speckit-clarify` Q3.)

## Ratcheting the floor

After a PR that improves coverage, raise the floor:

1. Run `npm test` and read the `text` reporter's `All files`
   row.
2. Edit `vitest.config.ts`:
   ```typescript
   thresholds: { statements: <new higher value> }
   ```
3. Run `npm test` again to confirm the new floor passes.
4. Commit and PR.

Lowering the floor uses the same edit. PR review is the gate
that catches it.

## AS-IS characterization tests vs. fork-authored feature tests

The test suite is split by directory:

| Directory | Contains | Convention |
|-----------|----------|-----------|
| `tests/inherited/` | AS-IS characterization tests for upstream-inherited code | Encode each line's *current* behaviour as the contract. **Do not modify `src/` to make them pass.** |
| `tests/tools/<feature>/` | Fork-authored feature tests (each spec's tool) | Encode the *intended* behaviour spec'd by the corresponding feature. |
| `tests/utils/` | Tests for repo-internal utilities | Same intent-based discipline as `tests/tools/`. |

A future audit of "which tests are encoding upstream behaviour
and which are encoding our deliberate behaviour?" is answered by
directory location alone — no need to read test bodies.

## Adding a test in the AS-IS subset

When adding a test to `tests/inherited/`:

1. Mirror the source path: tests for `src/tools/foo.ts` live at
   `tests/inherited/tools/foo.test.ts`.
2. Use `nock` for any HTTP interaction. Do not introduce another
   mocking library.
3. Encode the **observed** behaviour, not the intended one. If a
   line looks suspicious — even buggy — the test asserts what the
   code does today. Open a separate bug-fix spec to fix it; do
   not fix it here.
4. Confirm `git diff main..HEAD -- src/` is still empty after
   your change.

## Adding a test for a new fork-authored feature

When adding a test for a new feature spec:

1. Place it under `tests/tools/<feature-name>/` (mirroring the
   `src/tools/<feature-name>/` directory the feature creates).
2. Use `nock` for HTTP interactions.
3. Encode the intended behaviour spec'd by the feature — the
   test fails if the code doesn't match the spec.

## What if a line in `src/` is genuinely unreachable?

Some defensive branches depend on Node-internal failure modes
(e.g., `JSON.parse` of a value that has already been
schema-validated and cannot be malformed). These lines cannot be
covered without modifying `src/` to inject the failure — which
FR-006 forbids.

When you encounter one:

1. Leave the line uncovered.
2. Set / keep the floor at a value that acknowledges the
   uncovered remainder.
3. Document the line in the "Uncovered by design" section of
   `TESTING.md`, with one sentence explaining why it's
   unreachable from outside the module.

## Running just the AS-IS subset

For audits or upstream-merge sanity checks:

```bash
npm test -- tests/inherited/
```

This runs every AS-IS characterization test and skips the
fork-authored feature tests. If any AS-IS test fails after an
upstream merge, the merge changed inherited behaviour — decide
whether the new behaviour is intended (update the test) or an
unintended regression (revert/fix the merge).

## Smoke test: gate is real, not advisory

To confirm the gate actually fails the build:

```bash
# Move one test out of the way (don't delete — keep it stashed).
git stash push -- tests/tools/list-tags/handler.test.ts

npm test
# Expected: exit code non-zero, with the message
#   "Coverage for statements (X%) does not meet global threshold (Y%)"
echo $?  # non-zero

# Restore the test.
git stash pop
```

This is the same procedure the implementation uses to verify
SC-001 / Acceptance Scenario 3.
