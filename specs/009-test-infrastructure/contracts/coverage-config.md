# Contract: Coverage Configuration (`vitest.config.ts`)

This contract specifies the shape of the `coverage` block added to
`vitest.config.ts` by this feature. It is the single repo-side
config file FR-005 refers to.

## File location

Repo root: `vitest.config.ts` (NEW — this file does not currently
exist; it is created by this feature). Vitest auto-detects it.

## Required shape

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Coverage block — added by spec 009.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',

      // The build gate — single source of truth for the floor.
      // Edit the `statements` value (and only the `statements` value)
      // to ratchet the floor up or, in plain sight, down.
      // See specs/009-test-infrastructure/spec.md FR-005 and
      // /speckit-clarify Q3 for why the visible diff IS the override.
      thresholds: {
        statements: <NUMBER FILLED IN AT END OF AS-IS WORK>,
        // branches and functions intentionally absent — measured but
        // not gated. See spec FR-002 and /speckit-clarify Q2.
        // perFile intentionally absent — only aggregate gated.
        // See spec FR-003 and /speckit-clarify Q1.
      },
    },
  },
});
```

## Field-by-field contract

| Field | Required | Value | Rationale |
|-------|----------|-------|-----------|
| `test.coverage.provider` | Required | `'v8'` | R1 (Vitest's first-party V8 provider) |
| `test.coverage.include` | Required | `['src/**']` | R7 (no source files excluded) |
| `test.coverage.reporter` | Required | `['text', 'lcov', 'json-summary']` | R3 (three reporters: stdout, CI tools, gate) |
| `test.coverage.reportsDirectory` | Required | `'coverage'` | R3 (Vitest default; matches `.gitignore` entry) |
| `test.coverage.thresholds.statements` | Required after AS-IS work | One number `[0,100]` | The single source of truth for the floor (FR-005) |
| `test.coverage.thresholds.branches` | Forbidden | (absent) | `/speckit-clarify` Q2 — branches measured but not gated |
| `test.coverage.thresholds.functions` | Forbidden | (absent) | `/speckit-clarify` Q2 — functions measured but not gated |
| `test.coverage.thresholds.lines` | Forbidden | (absent) | Out of scope; statements are the gated metric |
| `test.coverage.thresholds.perFile` | Forbidden | (absent) | `/speckit-clarify` Q1 — only aggregate gated |
| `test.coverage.exclude` | Forbidden as override | (absent or default) | R7 — no source-file exclusions |

"Forbidden" means: a future PR adding any of these turns this PR's
discipline (statement-only, aggregate-only) into something else
without being explicit about it. Reviewers MUST flag any such
addition; if the change is intentional it belongs in a separate
ratchet PR with its own spec.

## Implementation order for the threshold value

Per R6 / FR-004 / spec edge case "Floor is set to 0% before the
AS-IS work":

1. **Initial wire-up commit**: `vitest.config.ts` is created with
   `provider`, `include`, `reporter`, `reportsDirectory`, but the
   `thresholds` object is **omitted entirely** — the gate is
   disarmed during AS-IS work so intermediate commits don't fail
   on a not-yet-met floor.
2. **AS-IS backfill commits**: tests are added; each `npm test`
   prints the new coverage in the `text` reporter and updates
   `coverage-summary.json`.
3. **Final commit**: `thresholds: { statements: <value> }` is
   added with `<value>` set to the actual aggregate statement
   coverage measured in step 2's last run, rounded down to one
   decimal place to leave a small safety margin against
   floating-point noise (e.g., 82.43 → 82.4).

The final commit SHOULD be its own commit (separable from the AS-IS
test additions) so reviewers can see the threshold being armed as a
distinct change.

## Edits NOT permitted by this PR

This contract reserves the right to set the values listed above.
This PR MUST NOT add any of the following to `vitest.config.ts`:

- Custom test-runner overrides outside the `coverage` block (e.g.,
  `pool`, `globals`, `setupFiles`) — out of scope; if any are
  needed for the AS-IS tests, that's a separate concern that
  belongs in its own dedicated commit with rationale.
- Path aliases or import resolution overrides — out of scope.
- Concurrency or parallelism overrides — out of scope; Vitest's
  defaults are sufficient for the suite size.

The `vitest.config.ts` produced by this feature is intentionally
small: just the coverage block and `defineConfig` boilerplate.

## .gitignore addition

The repo's `.gitignore` MUST gain an entry for `coverage/`. This is
the only `.gitignore` change scoped to this feature.
