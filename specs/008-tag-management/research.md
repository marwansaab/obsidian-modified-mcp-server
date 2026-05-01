# Phase 0 Research: Tag Management

**Branch**: `008-tag-management`
**Plan**: [plan.md](plan.md)
**Spec**: [spec.md](spec.md)

> Status: **Phase 0 RESOLVED**. The verification finding in §R1 below
> falsified an upstream-endpoint assumption; the user chose Alternative 1
> (reduce scope to `list_tags` only) on 2026-05-01, and the spec was
> amended to match. Phase 1 proceeds against the reduced scope.

## R1 — Upstream `/tags/...` surface verification

### Decision

**Original spec assumption falsified.** The upstream Obsidian Local
REST API plugin does **not** expose `GET /tags/{tagname}/` or
`PATCH /tags/{tagname}/`. Only `GET /tags/` exists.

**Resolution**: scope of feature 008 reduced to `list_tags` only.
Stories 2 & 3, FR-003..FR-006, FR-009, SC-003, SC-004, and dependent
edge cases / clarifications were removed from the spec.

### Evidence

Three independent sources, all consistent:

1. **OpenAPI spec at `coddingtonbear.github.io/obsidian-local-rest-api`**
   — only documents `GET /tags/` (returns
   `{ tags: [{ name, count }, …] }`). No path-parameterised tag
   endpoint, no PATCH, no other tag verb.
2. **GitHub releases / changelog** — the only tag-related entry is
   v3.5.0 ("new `GET /tags/` endpoint returning all vault tags with
   usage counts"). No subsequent release introduces tag mutation.
3. **Plugin source** (`src/requestHandler.ts` on `main` branch) —
   exactly one tag-route registration: `GET /tags/` → `tagsGet`. The
   plugin's PATCH machinery exists, but it accepts only `Target-Type`
   ∈ {`heading`, `block`, `frontmatter`} on `/vault/*`, `/active/`,
   and `/periodic/:period/` paths. No `/tags/...` PATCH handler.

### Alternatives considered

1. **Reduce scope to User Story 1 only** (selected). Ship `list_tags`
   alone. Drop `get_files_with_tag` and `tag_mutation`; re-spec them
   later if upstream adds the endpoints.
2. **Reduce + replace** — emulate `get_files_with_tag` via existing
   search tools. Rejected: contradicts spec Assumption "Obsidian's own
   tag-detection rules are the source of truth; the wrapper does not
   duplicate or second-guess them." Risk of drift between wrapper and
   Obsidian's own definitions.
3. **Reduce + emulate** — emulate `tag_mutation` via per-file
   frontmatter PATCHes. Rejected: directly violates spec FR-006 ("the
   wrapper MUST perform the rename via a single upstream call and
   MUST NOT iterate files client-side") and silently misses inline
   `#tag` mentions, which are precisely the highest-value/highest-risk
   case the spec calls out.

### Rationale for selection

Alternative 1 preserves the spec's pass-through ethos and the
constitutional commitment to explicit upstream error propagation
(Principle IV). Alternatives 2 and 3 require constitutional /
specification deviations that would land as Complexity Tracking
entries in plan.md; the user opted not to take on those deviations.

## R2 — Implementation pattern alignment

### Decision

`list_tags` will follow the same module shape that the
post-spec-005/007 tools use: a per-tool directory under `src/tools/`
with `schema.ts` (zod), `tool.ts` (registration), `handler.ts`
(orchestration), and a corresponding `tests/tools/list-tags/` directory
with at least one happy-path test and one upstream-error test.

### Rationale

- **Constitution Principle I (Modular Code Organization)** mandates
  small, single-purpose modules. The per-tool-directory pattern is
  already in use for `delete-file`, `surgical-reads`, `patch-content`,
  `graph`, and is the established convention.
- **Constitution Principle III (Boundary Input Validation with Zod)**
  mandates a zod schema as the single source of truth for both the
  MCP `inputSchema` (via `zod-to-json-schema`) and the runtime parser.
  The `delete-file/schema.ts` shape (export schema + `assertValid*`
  helper, type alias via `z.infer`) is the canonical pattern.
- **Constitution Principle II (Public Tool Test Coverage)**: vitest
  + nock are already configured (package.json devDependencies). The
  existing `tests/tools/<feature>/` layout with `schema.test.ts` +
  `registration.test.ts` + behavior tests is the canonical pattern
  to follow.

### Alternatives considered

- **Flat single-file tool** (à la `obsidian-tools.ts`) — appropriate
  only for trivial wrappers with no zod schema and no orchestration.
  `list_tags` does have a zod schema (the optional `vaultId`) and
  needs an HTTP call wrapped in `safeCall`. The per-tool-directory
  shape is correct.
- **Inline `case 'list_tags'` arm in `src/index.ts` dispatcher**
  rather than a dedicated `handleListTags` import — rejected. The
  dispatcher is already crowded; adding another inline arm would
  push it further from the modular pattern. The existing
  `case 'delete_file': return handleDeleteFile(args, rest);` shape is
  the right model.

## R3 — Upstream client method addition

### Decision

Add a single method `listTags(): Promise<unknown>` to
`ObsidianRestService` (in `src/services/obsidian-rest.ts`). Return
type is `unknown` (caller forwards the body verbatim per FR-012;
narrowing would re-impose a wrapper-defined shape and contradict the
clarification on success-body pass-through).

### Rationale

- The existing service methods (`listFilesInVault`, `getFileContents`,
  etc.) all narrow to typed return values, but in those cases the
  wrapper actually consumes the data (e.g., the delete-file handler
  inspects parent listings). For `list_tags` the handler does not
  inspect the body — it serializes whatever came back. Typing the
  return as `unknown` makes that explicit and prevents accidental
  reliance on a specific upstream shape.
- The method MUST go through `safeCall` so transport errors land in
  the existing typed-error surface (`ObsidianApiError` /
  `ObsidianTimeoutError` / `ObsidianNotFoundError`), satisfying
  Constitution Principle IV.

### Alternatives considered

- **Type the return as `{ tags: Array<{ name: string; count: number }> }`**
  matching the documented OpenAPI shape — rejected because it
  violates the success-body pass-through clarification (Q5) by
  encoding a wrapper-side schema that drops fields if the upstream
  evolves additively.
- **Bypass the service layer and call axios directly from the
  handler** — rejected. Violates Principle I (cross-module flow
  must be tool → service → client) and forfeits the typed-error
  conversion in `safeCall`.

## R4 — Test fixtures and HTTP mocking

### Decision

Use `nock` for upstream HTTP mocking (already in devDependencies and
used by all existing tool tests). Each test pins exact method, path,
and headers; the tag-index fixture is a small inline literal with
two or three tags including a hierarchical (`work/tasks` + `work`
parent roll-up) example, so the parent-prefix-rollup acceptance
scenario is exercised without coupling to a specific Obsidian
fixture vault.

### Rationale

- Consistent with existing pattern in `tests/tools/delete-file/`,
  `tests/tools/patch-content/`, etc.
- A small inline fixture keeps the test self-contained and removes
  any dependency on a real vault for the regression test FR-010
  requires.

### Alternatives considered

- **Spin up a real Obsidian vault + Local REST API plugin in CI** —
  out of scope; the existing test suite is unit/integration with
  mocked HTTP, and that's the established convention.

## Sources

- [Obsidian Local REST API — interactive docs](https://coddingtonbear.github.io/obsidian-local-rest-api/)
- [Obsidian Local REST API — releases](https://github.com/coddingtonbear/obsidian-local-rest-api/releases)
- [coddingtonbear/obsidian-local-rest-api — `requestHandler.ts` on `main`](https://github.com/coddingtonbear/obsidian-local-rest-api/blob/main/src/requestHandler.ts)
- [DeepWiki — PATCH Operations and Content Insertion](https://deepwiki.com/coddingtonbear/obsidian-local-rest-api/6.1-patch-operations)
