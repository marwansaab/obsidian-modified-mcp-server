# `tests/inherited/` — AS-IS characterization tests

This directory contains **characterization tests** for code inherited
from `ConnorBritain/obsidian-mcp-server` (the upstream of this fork).
These tests encode each line's *currently observed* behaviour as the
contract — they are a safety net, not a specification.

## The rules

1. **Do NOT modify `src/` to make a test pass.** Production code under
   `src/` is byte-for-byte unchanged by this directory's contents
   (spec 009, FR-006). If a line of inherited code looks suspicious or
   buggy, the test asserts what the code does *today*; opening a
   follow-up bug-fix spec is the way to remedy it, not editing `src/`
   here.

2. **Mirror the source path.** Tests for `src/tools/foo.ts` live at
   `tests/inherited/tools/foo.test.ts`. Tests for
   `src/services/bar.ts` live at `tests/inherited/services/bar.test.ts`.
   Tests targeting root-level `src/` files (e.g., `src/index.ts`,
   `src/config.ts`) live directly under `tests/inherited/`.

3. **Use `nock` for every HTTP interaction.** The repo's single shared
   HTTP-mocking layer is `nock` (already a `devDependency`). Do not
   introduce another mocking library here.

4. **Encode observed behaviour, not intended behaviour.** Each
   characterization test asserts what the wrapper does today against
   `nock`-recorded upstream responses. The future-regression-detection
   value comes from the test failing if observed behaviour drifts —
   the maintainer then decides whether the new behaviour is intended
   (update the test) or an unintended regression (revert/fix the code).

## Adding a fork-authored feature test? Wrong directory.

Tests for fork-authored features (specs 001-008) live under
`tests/tools/<feature-name>/` and encode the *intended* behaviour spec'd
by that feature. Use this directory only for AS-IS characterization
tests of upstream-inherited code.

The canonical guide for the test infrastructure (where the coverage
report is written, how to ratchet the floor, how to identify the AS-IS
subset) lives at the repo root in `TESTING.md`.
