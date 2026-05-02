# Spec 009 — Test Infrastructure: PR Description (working draft)

> Internal to feature branch `009-test-infrastructure`. The contents of this
> file are pasted into the GitHub PR body when the PR opens. The file itself
> is feature-branch-only and not part of the merged repo state.

## Summary

Two changes in one PR (per plan.md / FR-006 / SC-004 — they ship together):

1. **Coverage gate.** Wire `@vitest/coverage-v8` (Vitest's first-party V8
   coverage provider) into `npm test`. Statement / branch / function
   coverage is measured for every file under `src/` and emitted to
   `coverage/` (LCOV + JSON summary + stdout `text` reporter). Aggregate
   statement coverage is gated by
   `vitest.config.ts` → `test.coverage.thresholds.statements`; the build
   exits non-zero when the floor is not met.

2. **AS-IS characterization backfill.** Add unit tests under a new
   `tests/inherited/` directory exercising every uncovered code path in
   the upstream-inherited tools, services, and root-level files (the
   FR-009 list). All tests use `nock` (already a `devDependency`) so the
   suite is fully offline. Tests encode each line's *currently observed*
   behaviour as the contract — `src/` is byte-for-byte unchanged
   (FR-006 / SC-004).

## SC-001 evidence — the gate is real

Captured by T024 with the procedure from `quickstart.md` "Smoke test:
gate is real, not advisory".

Procedure:

1. Armed gate state: `vitest.config.ts` →
   `test.coverage.thresholds.statements: 82.4`.
2. Removed `tests/tools/list-tags/handler.test.ts` (one fork-authored test).
3. Ran `npm test`.

Observations:

- **Exit code**: `1` (non-zero).
- **Aggregate statement coverage** dropped from `82.45%` (with all tests
  present) to `82.33%` (with the test removed).
- **Threshold-violation message in stdout**:
  `ERROR: Coverage for statements (82.33%) does not meet global threshold (82.4%)`

The single source of truth is `vitest.config.ts` →
`test.coverage.thresholds.statements`. Editing that one number ratchets
the floor up or, in plain sight, down (FR-005, `/speckit-clarify` Q3).
The test was restored after the verification.

## SC-004 evidence — `src/` byte-for-byte unchanged

Captured by T027.

```
$ git diff main..HEAD -- src/
(empty — zero lines)

$ git status --short src/
(empty — no modifications, additions, or deletions)
```

The byte-for-byte invariant from FR-006 / SC-004 holds: this PR does not
modify, add, or delete any file under `src/`. Every change ships outside
`src/` — under `tests/inherited/` (new), at the repo root
(`vitest.config.ts`, `TESTING.md` — new), `package.json` (devDependency
addition), and `.gitignore` (`coverage/` entry).

## Acceptance scenario 1 — coverage report covers every file under `src/`

Verified by T008. After T001–T007, running `npm test` produces:

- `coverage/lcov.info` — present.
- `coverage/lcov-report/index.html` — present.
- `coverage/coverage-summary.json` — present, with one entry per source
  file under `src/`.

`coverage-summary.json` per-file count after T007 (matching `data-model.md`
Entity 2 — `total` aggregate plus one entry per file). The 35 source files
matched by `coverage.include: ['src/**']` are all represented:

```
src/config.ts                                 (0%)
src/index.ts                                  (24.22%)
src/types.ts                                  (type-only — 0 statements)
src/services/graph-service.ts                 (37.98% — fork-authored, OOS)
src/services/obsidian-rest-errors.ts          (100%   — fork-authored, ✓)
src/services/obsidian-rest.ts                 (48.78%)
src/services/smart-connections.ts             (23.91%)
src/tools/file-tools.ts                       (100% — metadata only)
src/tools/index.ts                            (100% — barrel)
src/tools/obsidian-tools.ts                   (100% — metadata only)
src/tools/periodic-tools.ts                   (100% — metadata only)
src/tools/search-tools.ts                     (100% — metadata only)
src/tools/semantic-tools.ts                   (100% — metadata + zod parser)
src/tools/vault-tools.ts                      (100% — metadata only)
src/tools/write-tools.ts                      (100% — metadata only)
src/tools/delete-file/{handler,recursive-delete,schema,tool,verify-then-report}.ts
src/tools/graph/{handlers,schemas,tool}.ts
src/tools/list-tags/{handler,schema,tool}.ts
src/tools/patch-content/{handler,schema,tool}.ts
src/tools/surgical-reads/{handler-frontmatter,handler-heading,schema,tool}.ts
src/utils/path-normalisation.ts               (100%)
```

Aggregate baseline (Phase 2): 49.39% statements
(411/832), 28.82% branches, 63.29% functions, 50.12% lines.

## Acceptance scenarios 3 & 4 — gate-fail mechanism (pre-validation)

Verified by T009 *before* the floor value is known. Procedure:

1. Edited `vitest.config.ts` to add `thresholds: { statements: 100 }`
   (a value the current suite cannot meet — baseline is 49.39%).
2. Ran `npm test`.
3. Observed:
   - Exit code: `1` (non-zero).
   - stdout contained the message:
     `ERROR: Coverage for statements (49.39%) does not meet global threshold (100%)`
4. Reverted `vitest.config.ts` to the disarmed state (no `thresholds`
   field).
5. Ran `git diff vitest.config.ts`. Output: empty (the file is new and
   currently untracked, but the disarmed shape is the one staged for
   commit). Confirms no threshold leaked into the Phase 3a/4 commits.

This pre-validates the gate's fail half before Phase 4 begins. T024
re-runs the same procedure with the actual armed floor value to capture
SC-001 evidence.

## SC-007 evidence — offline execution

Captured by T026 + T029 via the spec's footnote-allowed alternative
("rely on nock's shared setup having thrown ... `npm test`'s green run
IS the proof"), since disabling the host's network adapter is a
machine-wide destructive action this PR's runtime declined to take.

The proof rests on three observations:

1. The test suite uses `nock` for every HTTP interaction (FR-007). Each
   AS-IS test under `tests/inherited/` and each pre-existing test under
   `tests/tools/` registers a `nock(BASE_URL)...reply(...)` interceptor
   before the call and runs `nock.cleanAll()` in `afterEach`. There is
   no test that constructs a real socket against `localhost:27124`.
2. `npm test` was run on a machine with no Obsidian instance running on
   `127.0.0.1:27124`. All 390 tests pass:
   ```
   Test Files  41 passed (41)
   Tests       390 passed (390)
   ```
   If any test had attempted a real connection, axios's request would
   have failed with `ECONNREFUSED` (no listener on the port) → the test
   would have failed → the suite would have been red.
3. The same observation holds for the Smart Connections plugin's port
   (`8765` in test fixtures): no real listener exists, and yet the
   `tests/inherited/services/smart-connections.test.ts` suite passes —
   because every interaction is `nock`-mocked.

Combined, items 1-3 demonstrate that `npm test` requires no running
Obsidian instance and makes no real outbound HTTP requests.

If a future maintainer wants to verify this on their own machine, the
strict procedure is:

- **Linux/macOS**: `sudo ifconfig en0 down && npm test && sudo ifconfig en0 up`
  (or run inside a Docker container with `--network=none`).
- **Windows**: Settings → Network → disable adapter, run `npm test`, re-enable.

Either should still produce a green suite.

## Final-run evidence (T029)

`npm test` from a clean state produced:

```
Test Files  41 passed (41)
Tests       392 passed (392)
Errors      0
Statements  82.45% ( 686/832 ) ≥ 82.4% (gate floor)
Branches    72.97% ( 324/444 )
Functions   88.60% ( 140/158 )
Lines       82.41% ( 656/796 )
Exit code   0
```

All five preconditions hold:

- (a) all tests pass ✓
- (b) coverage report emits to `coverage/` (lcov.info, lcov-report/,
  coverage-summary.json) ✓
- (c) exit code 0 ✓
- (d) `text` reporter shows aggregate statement coverage ≥ the 82.4%
  floor in `vitest.config.ts` ✓
- (e) FR-001 "no Obsidian instance required" facet — verified by item 2
  of the SC-007 evidence above (a green run on a machine with no
  Obsidian instance running IS the proof; `nock` would have thrown
  fast on any unmocked request).

Spec 009 is implementation-complete and ready to PR.
