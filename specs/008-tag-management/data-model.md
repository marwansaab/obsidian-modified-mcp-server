# Phase 1 Data Model: Tag Management (`list_tags`)

**Branch**: `008-tag-management`
**Plan**: [plan.md](plan.md)
**Spec**: [spec.md](spec.md) §"Key Entities"

This feature is read-only and stateless: the wrapper holds no tag
data of its own. The entities below describe the *shape of data
flowing through* the wrapper from upstream to caller, plus the
shape of the caller's request.

## Entity: `ListTagsRequest`

The validated input object the handler receives after the boundary
zod parse.

| Field | Type | Required | Constraint | Source |
|---|---|---|---|---|
| `vaultId` | `string` (trimmed) | optional | `string` after `.trim()` (zod `.string().trim().optional()`) | spec FR-002 + repo convention (`obsidian-tools.ts`, `delete-file/schema.ts`) |

Validation rules:

- The schema accepts an empty `args` object, `{}`. No required field
  exists.
- `vaultId`, when present, MUST be a string. Whitespace is trimmed.
  An empty-after-trim `vaultId` is permitted by the schema (the
  field is optional and the trim removes nothing meaningful); the
  dispatcher's `resolveVaultId()` then falls back to the configured
  default vault if the trimmed value is falsy. This matches the
  precedent set by `src/index.ts:resolveVaultId` for every other
  tool — no per-tool re-implementation.
- Non-string `vaultId` (number, boolean, object, array) is rejected
  by zod with a `ZodError` whose first issue's `path` includes
  `vaultId`.

Type alias: `ListTagsRequest = z.infer<typeof ListTagsRequestSchema>`.

## Entity: `Tag` (upstream-defined; pass-through only)

A single tag entry as returned by the upstream `GET /tags/`. The
wrapper does not construct or mutate `Tag` records — it forwards
them verbatim per spec FR-012 and the success-body pass-through
clarification.

Documented upstream shape (per OpenAPI at
`coddingtonbear.github.io/obsidian-local-rest-api`):

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | Tag name without the leading `#`. May contain `/` for hierarchical tags (e.g., `work/tasks`). |
| `count` | `number` | Number of times this tag is used across the vault. |

Per FR-012 the wrapper does NOT type-narrow this shape internally:
the upstream may add fields in future versions and the wrapper must
forward them transparently. The shape above is documented for caller
guidance, not enforced by the wrapper.

Validation rules — none. The wrapper neither validates nor narrows
the upstream response body.

## Entity: `TagIndex` (upstream-defined; pass-through only)

The full response body of `GET /tags/`.

Documented upstream shape:

```json
{
  "tags": [
    { "name": "<string>", "count": <number> }
  ]
}
```

Behavioral rules established by upstream and documented in spec
edge cases:

- **Hierarchical roll-up**: a leaf tag like `work/tasks` contributes
  its count to every parent prefix (`work/tasks` and `work`). The
  index includes both the leaf and the parent rows. The wrapper
  passes this through unchanged; callers needing only leaf counts
  must filter client-side. (Spec edge case "Hierarchical tag
  roll-ups", FR-008.)
- **Code-block exclusion**: tag-shaped strings inside fenced code
  blocks are excluded by Obsidian itself; the upstream therefore
  does not include them in the index. The wrapper inherits this
  exclusion as a property of the upstream behavior, not as
  wrapper-side filtering. (Spec User Story 1 acceptance scenario 2,
  SC-002.)
- **Empty vault**: returns `{ "tags": [] }` (or whatever the
  upstream chooses for empty); the wrapper does not treat this as
  an error. (Spec edge case "Empty vault / no tags".)

## Entity: `ListTagsResult` (wrapper-internal, transient)

The MCP `CallToolResult` the handler returns to the dispatcher. Not
a persisted entity; described here for completeness.

```ts
{
  content: [
    {
      type: 'text',
      text: <serialized upstream response body, JSON.stringify(body, null, 2)>,
    },
  ],
}
```

Construction rules:

- The handler MUST `JSON.stringify` the *raw* upstream response
  body without any property pick/omit/rename. The pretty-print
  argument (`null, 2`) matches the convention used by every other
  pass-through tool in `src/index.ts` (e.g., `list_files_in_vault`,
  `complex_search`, `list_commands`).
- On a non-2xx upstream response or transport failure, the handler
  does NOT construct a `ListTagsResult`. It throws the typed error
  produced by `safeCall`; the dispatcher's `try/catch` in
  `src/index.ts` then produces the standard
  `{ content: [{ type: 'text', text: 'Error: <message>' }], isError: true }`
  shape used by every other tool. (FR-007.)

## Relationships

```text
ListTagsRequest ── (validated by) ── ListTagsRequestSchema
       │
       ▼ (resolved through configured vault)
ObsidianRestService.listTags()
       │
       ▼ (HTTP GET /tags/)
upstream Obsidian Local REST API plugin
       │
       ▼ (200 response body)
TagIndex { tags: Tag[] }
       │
       ▼ (verbatim JSON.stringify)
ListTagsResult (CallToolResult)
       │
       ▼
MCP caller
```

No state transitions. No persistence. No cross-vault aggregation.
