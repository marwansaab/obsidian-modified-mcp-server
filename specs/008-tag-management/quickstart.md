# Quickstart: `list_tags` Manual Smoke Test

**Branch**: `008-tag-management`
**Plan**: [plan.md](plan.md)
**Contract**: [contracts/list_tags.md](contracts/list_tags.md)

A 5-minute end-to-end check against a real Obsidian vault, run by a
developer to verify the implemented `list_tags` tool behaves the way
the contract says. Automated regression coverage lives in
`tests/tools/list-tags/`; this file documents the manual confirmation
step.

## Prerequisites

1. Obsidian is running with the **Local REST API** community plugin
   installed and enabled (>= v3.5.0 — earlier versions do not have
   `GET /tags/`).
2. The plugin's HTTPS port and API key are recorded in your shell
   env / `mcp` config the same way the other tools in this server
   use them.
3. The vault contains, at minimum:
   - One note with an inline tag (e.g., `#draft`).
   - One note whose YAML frontmatter declares `tags: [project, urgent]`.
   - One note that contains a tag-shaped string (e.g., `#draft`)
     **only inside a fenced code block** — placed there to verify
     code-block exclusion at SC-002.
   - One hierarchical tag (e.g., `#work/tasks`) used at least once.

## Build & start the server

From the repo root:

```bash
npm install        # if you haven't already on this branch
npm run lint
npm run typecheck
npm test           # all existing + new tag tests pass
npm run build
node dist/index.js
```

The last command starts the MCP server on stdio. Connect to it with
your MCP client of choice (e.g., Claude Code, MCP Inspector, or a
direct stdio client).

## Step 1 — Tool discovery

Issue an MCP `tools/list` request and confirm `list_tags` appears
exactly once in the returned array. The entry's `description`
should mention all three clauses required by FR-008:

- inline + frontmatter inclusion
- code-block exclusion
- hierarchical-tag parent-prefix roll-up

This confirms FR-001, FR-008, SC-006 (description audit).

## Step 2 — Happy path with no arguments

Issue:

```json
{
  "name": "list_tags",
  "arguments": {}
}
```

Expected `content[0].text` is a JSON string that parses into
`{ "tags": [ ... ] }`. Verify:

- (FR-001) Every real tag from your prerequisite notes appears.
- (Acceptance scenario 2 / SC-002) `draft` appears with a `count`
  that matches the number of times you used it **outside** the
  fenced code block. The fenced code-block occurrence is NOT
  counted.
- (Acceptance scenario 3) Both `project` and `urgent` are present.
- (Acceptance scenario 5 / FR-008 hierarchical clause) Both
  `work/tasks` AND `work` appear, each with a count. The two counts
  reflect Obsidian's parent-prefix roll-up; the wrapper did NOT
  fabricate them.

This confirms FR-001, FR-002 (no required args), FR-012 (verbatim
pass-through), SC-002.

## Step 3 — Happy path with `vaultId`

If you have a second vault configured, issue:

```json
{
  "name": "list_tags",
  "arguments": { "vaultId": "<your second vault id>" }
}
```

Expected: tag index for the second vault, distinct from Step 2.
Confirms FR-002 vault selector.

If only one vault is configured, supply its id explicitly to
exercise the same code path; the result should match Step 2's.

## Step 4 — Authentication failure

Temporarily replace the configured API key with an invalid one and
restart the server. Repeat Step 2.

Expected `content[0].text`:

```text
Error: Obsidian API Error 401: <upstream's authentication error message>
```

`isError: true` MUST be set on the result. Confirms FR-007, SC-005,
Constitution Principle IV.

Restore the correct API key before continuing.

## Step 5 — Upstream unreachable

Stop the Obsidian application (or block the port at the firewall).
Repeat Step 2.

Expected `content[0].text` contains an
`Obsidian API Error -1:` line with the underlying axios transport
message (`ECONNREFUSED` or similar). `isError: true` is set.
Confirms the wrapper does not silently substitute an empty result
for transport failures (Constitution Principle IV).

Restart Obsidian before continuing.

## Step 6 — Empty vault

Point the configured vault at an empty Obsidian vault directory (or
create a temporary vault with zero tags). Repeat Step 2.

Expected `content[0].text` parses to `{ "tags": [] }` — and the
result is NOT marked `isError`. Confirms the empty-vault edge case
in spec.

---

## Done

When all six steps pass, the manual smoke test confirms the
contract end-to-end against a real upstream. The automated
regression suite under `tests/tools/list-tags/` covers each of these
paths against a `nock`-mocked upstream and runs in CI on every
change.
