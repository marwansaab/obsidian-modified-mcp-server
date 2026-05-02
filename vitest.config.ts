import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      // Build gate (spec 009 / FR-005). Single source of truth for the
      // floor; raising or lowering it is a one-line edit to this field.
      // Branches/functions/lines/perFile are intentionally absent — see
      // contracts/coverage-config.md and /speckit-clarify Q1/Q2.
      thresholds: { statements: 82.4 },
    },
  },
});
