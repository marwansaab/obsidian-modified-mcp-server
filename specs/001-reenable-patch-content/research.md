# Phase 0 Research: Re-enable patch_content

**Branch**: `001-reenable-patch-content` | **Date**: 2026-04-26

This document records the research and decisions feeding into the
implementation plan. Each section follows the format:

- **Decision**: what was chosen
- **Rationale**: why
- **Alternatives considered**: what else was evaluated and rejected

---

## R1 — Test runner

**Decision**: Use **vitest**.

**Rationale**:

- The repo is `"type": "module"` in `package.json` (native ESM).
- Source files use `.js` import specifiers for relative imports
  (e.g., `from './services/obsidian-rest.js'`), confirming an ESM build
  pipeline through `tsup`.
- vitest has first-class TypeScript and ESM support, jest-compatible
  globals (`describe`, `it`, `expect`), built-in mocking, and fast
  startup.
- Adds two devDependencies (`vitest`, plus `@vitest/coverage-v8` if
  coverage reports are wanted later — not required by this feature).

**Alternatives considered**:

- **Jest**: most familiar, but requires `ts-jest` or `babel-jest` plus
  ESM workarounds (`extensionsToTreatAsEsm`, `moduleNameMapper` for
  `.js` specifiers, `--experimental-vm-modules`). High setup cost and
  ongoing friction in an ESM-first repo.
- **Node built-in `node:test`**: zero deps, modern. But lacks ergonomic
  matchers, watch mode, and the assertion vocabulary the rest of the
  team is likely to expect. Acceptable for a single-purpose script,
  not for a growing tool surface.
- **Mocha + Chai**: heavier setup, no built-in mocking, dated DX.

**Confidence**: high. vitest is an unambiguous fit for an ESM
TypeScript Node project.

---

## R2 — HTTP mock library

**Decision**: Use **nock**.

**Rationale**:

- The service layer uses **axios** (`src/services/obsidian-rest.ts:6`),
  which under Node uses the built-in `http` / `https` modules. nock
  patches those modules and intercepts at the request layer — axios
  never knows the difference.
- nock has been the canonical Node HTTP mock for years; documentation
  is extensive; the API is small and well understood.
- Works in vitest with no special setup beyond `import nock from
  'nock'` and `nock.cleanAll()` in `afterEach`.

**Alternatives considered**:

- **`undici` `MockAgent`**: lightweight and built into Node. But
  `MockAgent` only intercepts requests made through undici's `fetch`
  client; axios uses Node `http` directly, so `MockAgent` would not
  catch our calls. Switching the service layer to undici purely to
  enable this mock library would be wide-scope refactoring and is out
  of scope.
- **`msw` (Mock Service Worker)**: excellent, especially for projects
  shared between browser and Node. For a Node-only project the
  service-worker abstraction is overkill; nock is more direct.
- **`sinon` + custom transport**: more code than necessary for a thin
  axios wrapper.

**Confidence**: high.

---

## R3 — Keeping MCP `inputSchema` and runtime validator in sync

**Decision**: Use **`zod-to-json-schema`** to derive the published
`inputSchema` from the zod schema at module-load time.

**Rationale**:

- Constitution FR-010 (and Principle III) require the published schema
  and the runtime validator to come from a single source.
- `zod-to-json-schema` is the canonical bridge for zod ↔ JSON Schema in
  the MCP ecosystem. It is unmaintained-but-stable; the conversion is
  small and predictable for the simple object schema this feature
  needs.
- One additional dev/runtime dependency. Negligible bundle impact.

**Alternatives considered**:

- **Hand-write JSON Schema, hand-keep in sync**: directly violates
  FR-010 and Principle III. Two sources of truth; drift is inevitable.
- **Use zod's `_def` to render JSON Schema in-house**: avoids the dep
  but reinvents `zod-to-json-schema`. Not worth it for one tool.
- **Use the zod schema as the MCP `inputSchema` directly**: the MCP SDK
  expects JSON Schema in `Tool.inputSchema`, not a zod schema. This
  would not work without conversion.

**Confidence**: high.

---

## R4 — Heading-path validator algorithm

**Decision**: Pure structural validation with the following predicate:

```text
Given a string `target`, the value is VALID iff:
  - `target.split('::')` produces an array of length ≥ 2, AND
  - every element of that array has length ≥ 1 (no empty segments).
```

The wrapper does **not**:

- Trim whitespace within or around segments (preserves caller intent;
  thin pass-through). Whitespace-only segments are rejected because
  they have length ≥ 1 only after trim, but length-0 only matters if
  truly empty; a single space is a valid segment string. This is
  intentional and documented in the contract.
- Apply any escape decoding for `\::` or similar — there is no escape
  syntax (per spec Assumptions).
- Inspect note contents to confirm the path resolves; the upstream
  plugin does that.

**Rationale**: matches the spec's Edge Cases and Assumptions exactly,
is trivial to test, and aligns with Constitution Principle IV by leaving
"does this path actually exist?" to the upstream and propagating the
upstream's response.

**Alternatives considered**:

- **Trim segments before validation**: would make `"H1:: H2"` (space
  after `::`) succeed, but the upstream cares about exact heading text
  and would 404 anyway. Better to forward verbatim and let the upstream
  be the authority.
- **Reject targets containing characters that would need URL encoding**:
  out of scope. The existing service layer URL-encodes `target` via
  `encodeURIComponent` before sending (see
  `src/services/obsidian-rest.ts:163`); the validator is purely
  structural.

**Confidence**: high.

---

## R5 — Error format for wrapper-side validation failures

**Decision**: When validation fails, throw a `TypeError` (or a `ZodError`
that we re-format) whose message contains:

1. The rule name: `"heading targets must use the full H1::H2[::H3...] path"`.
2. The offending value, escaped/quoted: `"received: \"Action Items\""`.
3. A worked example using the offending value: e.g.,
   `"e.g., \"<Parent Heading>::Action Items\""`.

The existing top-level handler at `src/index.ts:250-257` already
converts thrown errors into MCP `isError: true` responses with a
human-readable `text` content. No changes to the top-level handler are
needed; the error message itself is what the LLM caller will see.

**Rationale**:

- Reuses existing project error-surfacing convention. No new error
  taxonomy.
- Satisfies SC-004 (caller can produce a correctly-formed retry on the
  first attempt).

**Alternatives considered**:

- **Return a structured error object inside `content`**: would require
  defining a new convention. Existing tools throw `Error` and let the
  top-level catch render `Error: <message>`. Diverging here would be
  inconsistent with sibling tools.
- **Use MCP's standard JSON-RPC error codes**: appealing in principle,
  but the project does not currently use them and adopting them is a
  larger refactor than this feature warrants.

**Confidence**: high.

---

## R6 — Timeout and retry policy for upstream calls

**Decision**: Inherit the existing `axios.create({ timeout: 10000 })` in
`ObsidianRestService` (`src/services/obsidian-rest.ts:27`); add **no**
retry logic.

**Rationale**:

- Matches the established project convention (none of the existing
  tools retry).
- PATCH is non-idempotent. A retry on a transient `5xx` could
  double-apply the patch under exactly the conditions where we'd be
  most likely to retry (timeout after the upstream began processing).
  Not retrying is the correct safety choice here.

**Alternatives considered**:

- **Add a single retry on `ECONNRESET` / network errors**: would help
  for genuinely transient failures, but introduces a non-idempotency
  risk for PATCH. Out of scope.
- **Configurable timeout per call**: not needed for a thin wrapper.
  Plan-level decision; no spec implication.

**Confidence**: high.

---

## R7 — Logging / observability

**Decision**: Inherit existing convention. The top-level handler in
`src/index.ts:252` already does `console.error("Tool ${name} failed:",
message)` for any thrown error. No additional logging at the wrapper
layer.

**Rationale**:

- Project does not currently expose structured logging, metrics, or
  tracing; introducing them as part of one tool's work would violate
  Constitution Principle I (modular code) and exceed scope.

**Alternatives considered**:

- **Log every rejected validation at `warn`**: useful for debugging
  prompt issues, but creates noise and is solved by callers reading
  the returned error message.
- **Emit metrics**: no metrics infrastructure exists.

**Confidence**: high. Trivially revisitable later if observability is
added project-wide.

---

## Summary

| Topic | Decision |
|---|---|
| Test runner | vitest |
| HTTP mock | nock |
| zod ↔ JSON Schema bridge | zod-to-json-schema |
| Validator algorithm | structural split on `::`, ≥ 2 non-empty segments, no trim, no escape |
| Validation error shape | thrown `Error` with rule, offending value, worked example |
| Timeout | existing 10 s `axios` default; no retry (PATCH non-idempotency) |
| Logging | existing top-level `console.error`; no new instrumentation |

No `NEEDS CLARIFICATION` items remain.
