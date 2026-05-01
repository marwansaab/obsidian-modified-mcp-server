# Contract: `list_tags` MCP Tool

**Branch**: `008-tag-management`
**Plan**: [../plan.md](../plan.md)
**Spec**: [../spec.md](../spec.md)
**Status**: authoritative for the public surface this feature ships.

---

## Tool name

`list_tags`

## Tool description (advertised in MCP `tools/list`)

> List every tag present in the vault, together with its usage count.
> The result is sourced from Obsidian's own tag index via the Local
> REST API plugin's `GET /tags/` endpoint, so it includes both
> inline (`#tag`) and YAML frontmatter tags and excludes tag-shaped
> strings that appear inside fenced code blocks — making it more
> accurate than text or frontmatter search for tag enumeration.
> Hierarchical tags (e.g., `work/tasks`) contribute counts to every
> parent prefix (e.g., `work`), matching how Obsidian's own tag
> sidebar displays them.

The description text is fixed by spec FR-008 + SC-006: it MUST state
the inline+frontmatter inclusion rule, the code-block exclusion rule,
and the hierarchical-tag parent-prefix roll-up. Tests assert the
presence of each clause.

## Input schema (derived from `ListTagsRequestSchema` via `zod-to-json-schema`)

```json
{
  "type": "object",
  "properties": {
    "vaultId": {
      "type": "string",
      "description": "Optional vault ID (defaults to configured default vault)."
    }
  }
}
```

Notes:

- No `required` array — `vaultId` is optional.
- The schema is generated from a single zod source
  (`src/tools/list-tags/schema.ts`) shared with the runtime parser, so
  the published JSON Schema and the runtime validator cannot drift
  apart (Constitution Principle III).
- `vaultId` is trimmed before use (zod `.trim()` modifier). Whitespace-
  only or missing values fall through to the configured default vault
  via the dispatcher's existing `resolveVaultId()`.

## Successful response

```json
{
  "content": [
    {
      "type": "text",
      "text": "<JSON.stringify(upstream response body, null, 2)>"
    }
  ]
}
```

The `text` field's content is the upstream's `GET /tags/` response
body serialized verbatim (FR-012). Documented upstream shape:

```json
{
  "tags": [
    { "name": "project", "count": 3 },
    { "name": "work/tasks", "count": 5 },
    { "name": "work", "count": 5 }
  ]
}
```

Notes:

- Hierarchical-tag parent-prefix counts are present in the upstream
  body and forwarded as-is.
- Empty vault returns whatever the upstream returns (typically
  `{ "tags": [] }`), wrapped in the same `text` content block.
- The wrapper does NOT type-narrow the body; if the upstream adds
  fields per tag (e.g., `firstSeenAt`) or top-level fields, those
  reach the caller without a wrapper update.

## Error responses

The dispatcher's existing `try/catch` in `src/index.ts` translates
any `Error` thrown by the handler into:

```json
{
  "content": [{ "type": "text", "text": "Error: <message>" }],
  "isError": true
}
```

The handler emits **three distinct error categories**:

### 1. Validation failure (zod)

```text
Error: Invalid input — vaultId: Expected string, received <type>
```

Triggered when `vaultId` is provided but is not a string (number,
boolean, object, array). No upstream call is made. (Constitution
Principle III; spec FR-002.)

### 2. Vault not configured

```text
Error: Vault "<id>" is not configured
```

Triggered when a `vaultId` is supplied but no matching vault exists
in `getConfig()`. This error is thrown by the dispatcher's
`getVaultConfig()` before the handler runs — same shape as every
other tool. Not list-tags-specific; documented here for caller
clarity.

### 3. Upstream error (passthrough)

```text
Error: Obsidian API Error <code>: <message>
```

Any non-2xx upstream response or transport failure. The
`<code>` is either the upstream's `errorCode` field (if present in
the response body), the HTTP status (if not), or `-1` for transport
errors with no response. The `<message>` is either the upstream's
`message` field (if present) or the axios error message verbatim.
This is the standard shape produced by
`src/services/obsidian-rest.ts:safeCall` for every read tool. (Spec
FR-007, SC-005; Constitution Principle IV.)

Subcategories observable to the caller via the message:

- **Authentication failure**: `Obsidian API Error 401: <upstream message>`
  — upstream rejected the API key.
- **Upstream 5xx**: `Obsidian API Error 5xx: <upstream message>` —
  passed through unchanged.
- **Transport timeout**: `Obsidian API Error <code>: <axios message>`
  thrown as `ObsidianTimeoutError`. The wrapper does NOT retry; the
  caller decides whether to.

The handler does NOT translate any of these to wrapper-specific
text (FR-007). It re-throws the typed error from `safeCall` as a
plain `Error` whose message is the typed error's `message` field —
the dispatcher then formats it.

## Behavioural contract (mapped to functional requirements)

| FR | Behaviour visible at the contract surface |
|----|-------------------------------------------|
| FR-001 | A tool named `list_tags` is registered and returns tag-with-usage-count entries from the upstream's authoritative index. |
| FR-002 | The tool accepts zero required arguments and an optional string `vaultId`. |
| FR-007 | Non-2xx upstream responses produce the `Obsidian API Error <code>: <message>` error format above; no wrapper-specific paraphrase. |
| FR-008 | Tool description (above) advertises the inline+frontmatter inclusion rule, code-block exclusion rule, and hierarchical-tag roll-up behavior. |
| FR-010 | Regression tests at [../../../tests/tools/list-tags/](../../../tests/tools/list-tags/) pin the HTTP method (`GET`), URL path (`/tags/`), and `Authorization: Bearer <key>` header against a `nock`-mocked upstream. A separate test exercises the upstream-error path. |
| FR-012 | Success response body is forwarded verbatim — no field pick, omit, or rename. |

## Non-contract (deliberately out of scope)

- **Sorting / ordering of returned tags**: whatever order the
  upstream emits is what the caller sees. No wrapper-side sort.
- **Filtering, grouping, or hierarchical aggregation**: callers do
  this client-side. The wrapper does not synthesize a "leaves only"
  view.
- **Caching across calls**: every invocation hits the upstream.
  Caching is not specified and would interact unexpectedly with
  vault edits between calls.
- **Cross-vault enumeration**: each call resolves to one vault. To
  enumerate tags across multiple configured vaults, the caller
  invokes the tool once per `vaultId`.
- **Listing files for a given tag** or **mutating tags**: not
  supported in this feature; the upstream endpoints required do
  not exist as of upstream v3.5.0. See [../research.md](../research.md) §R1.
