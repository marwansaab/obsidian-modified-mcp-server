# Obsidian Modified MCP Server

[![npm version](https://img.shields.io/npm/v/@marwansaab/obsidian-modified-mcp-server.svg)](https://www.npmjs.com/package/@marwansaab/obsidian-modified-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This is a personal fork of [`@connorbritain/obsidian-mcp-server`](https://github.com/ConnorBritain/obsidian-mcp-server) by Connor Britain. Its purpose is to mitigate wrapper-side limitations of the Local-REST-API-based MCP server. Concrete changes so far: re-enabled the `patch_content` tool under a structural-only path validator; added two surgical-read tools (`get_heading_contents`, `get_frontmatter_field`); wired the seven graph tools through the dispatcher (they previously advertised schemas but returned `Unknown tool` at runtime); and made `delete_file` recursive on directory paths with timeout-coherent responses. Subsequent specs will add similar wrapper-level mitigations as the fork evolves.

> **Status: Personal fork. External support not guaranteed; use at your own discretion.**

TypeScript MCP server for Obsidian with core vault operations, graph analytics, and semantic search.

## Features

- **Core Tools**: Read, write, search, append, delete files in your Obsidian vault
- **Periodic Notes**: Access daily, weekly, monthly notes and recent changes
- **Advanced Search**: JsonLogic queries for complex filtering
- **Graph Tools**: Orphan detection, centrality analysis, cluster detection, path finding
- **Semantic Search**: Smart Connections integration for concept-based search

## Differences from upstream

<!-- This section is maintained as new differences land. -->

| Change | Description | Rationale |
|---|---|---|
| `patch_content` re-enabled | Heading/block/frontmatter PATCH tool is enabled in this fork under a structural-only path validator. | Wraps the same upstream endpoint Connor's fork disabled. The empirically-observed `40080 invalid-target` is a client-side path-mismatch (per [coddingtonbear/obsidian-local-rest-api#146](https://github.com/coddingtonbear/obsidian-local-rest-api/issues/146)), addressable by enforcing fully-qualified heading paths at the wrapper boundary. |
| `get_heading_contents` + `get_frontmatter_field` added | Two new MCP read tools that fetch part of a vault note instead of the whole file. `get_heading_contents` returns the raw markdown body under a fully-pathed heading (reusing `patch_content`'s structural path validator). `get_frontmatter_field` returns one frontmatter field's value with its original type preserved (string, number, boolean, array, object, or `null`). | Avoids round-tripping the entire file through the MCP transport just to read one section or one field; surfaces the upstream Local REST API's surgical-read endpoints (`GET /vault/{path}/heading/...`, `GET /vault/{path}/frontmatter/{field}`) directly. |
| Graph tools wired through dispatcher | The seven graph tools (`get_vault_stats`, `get_vault_structure`, `find_orphan_notes`, `get_note_connections`, `find_path_between_notes`, `get_most_connected_notes`, `detect_note_clusters`) are now actually dispatched at runtime. Aggregation tools tolerate malformed notes via `skipped` + `skippedPaths`; per-note tools return `note not found: <path>` for missing endpoints (distinct from "found but no connections" and "no path between endpoints"). | Previously the seven tools advertised JSON schemas at the catalog layer but returned `Error: Unknown tool: <name>` at runtime — the catalog was a superset of what the runtime served. Honouring the contract eliminates the false-advertisement state. Full I/O contracts in [`specs/004-fix-graph-tools/contracts/`](specs/004-fix-graph-tools/contracts/). |
| `delete_file` recursive + timeout-coherent | Directory paths are deleted recursively in a single tool call — the wrapper walks contents in upstream listing order, deletes each file and subdirectory, then deletes the outer directory and returns `{ok, deletedPath, filesRemoved, subdirectoriesRemoved}`. On a transport timeout the wrapper performs a single verification listing query against the parent before reporting outcome, so callers see definite success or definite failure (or a structured `outcome undetermined` if verification itself fails) — never an ambiguous raw timeout. | Upstream `delete_file` is non-recursive on directories (so a non-empty directory request fails with the directory unchanged), and even an empty-directory delete that succeeded on the vault was surfaced to callers as a 10-second transport-timeout error — both produced unreliable responses. Full contract in [`specs/005-fix-directory-delete/contracts/delete_file.md`](specs/005-fix-directory-delete/contracts/delete_file.md). |

## Heading-path discipline (`patch_content`, `get_heading_contents`)

To avoid the disambiguation issue tracked in upstream issue
[coddingtonbear/obsidian-local-rest-api#146](https://github.com/coddingtonbear/obsidian-local-rest-api/issues/146),
this fork applies a structural validator at the MCP wrapper boundary
**before** any HTTP call is made. The same rule applies to
`patch_content`'s heading targets and to `get_heading_contents`'s
`heading` argument — there is exactly one definition of the predicate
across the codebase.

- **Heading targets MUST be path-shaped.** At least two non-empty
  `::`-separated segments, full path from the document's H1 downward.
  Use `"About This Vault::Frontmatter Conventions"`, **not**
  `"Frontmatter Conventions"`. Bare names are rejected with an
  actionable error message that names the rule, quotes the offending
  value, and shows a corrected example.
- **Headings whose literal text contains `::`** are unreachable through
  these tools — the validator treats every `::` as a path separator and
  there is no escape syntax. Fall back to `get_file_contents` +
  `put_content` (write side) or `get_file_contents` + client-side
  slicing (read side).
- **Top-level-only headings** (i.e., files with no `::`-separable
  nesting) are also unreachable through these tools. Same fallback.
- `patch_content`'s `block` and `frontmatter` target types pass through
  to the upstream unchanged.
- `get_heading_contents` returns just the raw markdown body under the
  targeted heading — frontmatter, tags, and file metadata are not
  included. For frontmatter use `get_frontmatter_field` (single field)
  or `get_file_contents` (whole note).
- Upstream errors propagate verbatim with status code and message
  preserved (no silent fallbacks). For `get_frontmatter_field` in
  particular, a present-but-`null` field value (`{"value":null}`) is
  distinct from a missing field (upstream 4xx surfaced as `isError`).

These limitations are also stated in each tool's MCP `description`
field, so they are visible to any caller that lists the available tools.

## Prerequisites

- Node.js 18+
- [Obsidian](https://obsidian.md/) with [Local REST API plugin](https://github.com/coddingtonbear/obsidian-local-rest-api) installed and enabled
- (Optional) [Dataview plugin](https://github.com/blacksmithgu/obsidian-dataview) for `get_recent_changes`
- (Optional) [Periodic Notes plugin](https://github.com/liamcain/obsidian-periodic-notes) for periodic note tools
- (Optional) [Smart Connections plugin](https://github.com/brianpetro/obsidian-smart-connections) for semantic search

## Installation

### From npm

```bash
npm install -g @marwansaab/obsidian-modified-mcp-server
```

### From source

```bash
git clone https://github.com/marwansaab/obsidian-modified-mcp-server.git
cd obsidian-modified-mcp-server
npm install
npm run build
```

## Configuration

Set the following environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OBSIDIAN_API_KEY` | Yes* | - | API key from Local REST API plugin settings (used when multi-vault JSON is not supplied) |
| `OBSIDIAN_HOST` | No | `127.0.0.1` | Obsidian REST API host |
| `OBSIDIAN_PORT` | No | `27124` | Obsidian REST API port |
| `OBSIDIAN_PROTOCOL` | No | `https` | `http` or `https` |
| `OBSIDIAN_VAULT_PATH` | No | - | Path to vault (required for graph tools) |
| `SMART_CONNECTIONS_PORT` | No | - | Port for Smart Connections API |
| `GRAPH_CACHE_TTL` | No | `300` | Graph cache TTL in seconds |
| `OBSIDIAN_VAULTS_JSON` | No | - | JSON string describing one or more vaults. Overrides the single `OBSIDIAN_API_KEY` style config. |
| `OBSIDIAN_VAULTS_FILE` | No | - | Path to a JSON file describing one or more vaults (same shape as `OBSIDIAN_VAULTS_JSON`). |
| `OBSIDIAN_DEFAULT_VAULT` | No | first defined | Name/ID of the vault to use when a tool call omits `vaultId`. |

> **Multi-vault note:** If neither `OBSIDIAN_VAULTS_JSON` nor `OBSIDIAN_VAULTS_FILE` is provided, the legacy single-vault env vars (`OBSIDIAN_API_KEY`, `OBSIDIAN_HOST`, etc.) are used to create a `default` vault entry automatically.

### Example `OBSIDIAN_VAULTS_JSON`

```json
[
  {
    "id": "work",
    "apiKey": "work-api-key",
    "host": "127.0.0.1",
    "port": 27124,
    "protocol": "https",
    "vaultPath": "C:/Users/you/Obsidian/work",
    "smartConnectionsPort": 29327
  },
  {
    "id": "personal",
    "apiKey": "personal-api-key",
    "vaultPath": "C:/Users/you/Obsidian/personal"
  }
]
```

Each tool in the MCP server accepts an optional `vaultId` argument. When omitted, the server uses `OBSIDIAN_DEFAULT_VAULT` (or the first defined vault). This allows a single MCP session to read/write multiple vaults just by specifying which vault to target in the tool call.

### Multi-Vault Port Configuration

> **Important:** When running multiple Obsidian vaults simultaneously, each vault's Local REST API plugin must listen on a **unique port**. By default, all vaults use port `27124`, which causes conflicts—only one vault can bind to a port at a time, and requests to other vaults will fail with authorization errors.

#### Step 1: Assign Unique Ports in Obsidian

For each vault, open **Settings → Community Plugins → Local REST API** and scroll to **Advanced Settings**:

1. Set **Encrypted (HTTPS) Server Port** to a unique value (e.g., `27124`, `27125`, `27126`, `27127`)
2. Toggle the plugin off and back on (or restart Obsidian) to apply the change
3. Copy the **API Key** shown in the plugin settings

#### Step 2: Update Your Vaults JSON

In your `obsidian-vaults.json` file (or `OBSIDIAN_VAULTS_JSON` env var), specify the `port` for each vault to match what you configured in the plugin:

```json
[
  {
    "id": "vault_one",
    "apiKey": "your-api-key-for-vault-one",
    "port": 27124,
    "vaultPath": "C:/Users/you/Obsidian/vault_one"
  },
  {
    "id": "vault_two",
    "apiKey": "your-api-key-for-vault-two",
    "port": 27125,
    "vaultPath": "C:/Users/you/Obsidian/vault_two"
  },
  {
    "id": "vault_three",
    "apiKey": "your-api-key-for-vault-three",
    "port": 27126,
    "vaultPath": "C:/Users/you/Obsidian/vault_three"
  }
]
```

#### Step 3: Restart Your MCP Client

After updating the JSON file, restart your MCP client (Windsurf, Claude Desktop, etc.) so it reloads the configuration with the new ports.

#### Verifying Connectivity

You can test each vault's API directly with curl:

```bash
# Replace PORT and API_KEY for each vault
curl -k -H "Authorization: Bearer YOUR_API_KEY" https://127.0.0.1:PORT/vault/
```

A successful response returns a JSON object with the vault's file listing. If you receive `40101 Authorization required`, the API key doesn't match. If you receive `40400 Not Found`, the plugin isn't fully initialized on that port—try toggling it off/on or restarting the vault.

## MCP Client Configuration

### Using npx (Recommended)

Use `npx` for the simplest setup:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "@marwansaab/obsidian-modified-mcp-server"],
      "env": {
        "OBSIDIAN_API_KEY": "your-api-key-here",
        "OBSIDIAN_VAULT_PATH": "/path/to/your/vault",
        "OBSIDIAN_VAULTS_FILE": "C:/path/to/vaults.json",
        "OBSIDIAN_DEFAULT_VAULT": "work"
      }
    }
  }
}
```

### Using Local Build (Development)

If running from source:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/absolute/path/to/obsidian-modified-mcp-server/dist/index.js"],
      "env": {
        "OBSIDIAN_API_KEY": "your-api-key-here",
        "OBSIDIAN_VAULT_PATH": "/path/to/your/vault",
        "OBSIDIAN_VAULTS_JSON": "[{\"id\":\"work\",\"apiKey\":\"...\",\"vaultPath\":\"/work\"}]"
      }
    }
  }
}
```

### Config File Locations

| Client | Config Path |
|--------|-------------|
| **Claude Desktop (Windows)** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Claude Desktop (Mac/Linux)** | `~/.config/claude/claude_desktop_config.json` |
| **Windsurf** | `~/.windsurf/mcp_config.json` |
| **Cursor** | `~/.cursor/mcp_config.json` |

## Available Tools

All tools accept an optional `vaultId` argument. If omitted, the server uses the default vault from your configuration. This lets you read/write multiple Obsidian vaults within the same MCP session.

**Path separators**: every tool that takes a `filepath` (or `source` / `target`) argument accepts forward-slash, backslash, or mixed separators uniformly across platforms. Forward-slash is the canonical form, but Windows-style backslash paths work without modification. See [`specs/006-normalise-graph-paths/`](specs/006-normalise-graph-paths/).

### Vault Management

| Tool | Description |
|------|-------------|
| `list_vaults` | List all configured vaults with their IDs, capabilities, and connection info |

### Core File Operations

| Tool | Description |
|------|-------------|
| `list_files_in_vault` | List all files/directories in vault root |
| `list_files_in_dir` | List files in a specific directory |
| `get_file_contents` | Read a single file |
| `batch_get_file_contents` | Read multiple files concatenated with headers |
| `delete_file` | Delete a file or directory. **Directory paths are deleted recursively** — the wrapper removes every contained file and subdirectory before deleting the directory itself, in a single tool call. On a transport timeout the wrapper verifies post-condition via a parent listing before reporting outcome. |

### Surgical Read Operations

| Tool | Description |
|------|-------------|
| `get_heading_contents` | Read just the raw markdown body under a fully-pathed heading (`H1::H2[::H3...]`). Frontmatter, tags, and file metadata are not included — see [Heading-path discipline](#heading-path-discipline-patch_content-get_heading_contents) above. |
| `get_frontmatter_field` | Read one frontmatter field's value with its original type preserved (string, number, boolean, array, object, or `null`). Missing fields surface as upstream 4xx errors, distinct from a present-but-`null` value. |

### Write Operations

| Tool | Description |
|------|-------------|
| `append_content` | Append to file (creates if missing) |
| `put_content` | Overwrite file content |
| `patch_content` | Insert content relative to a heading, block, or frontmatter target. **Heading targets must use the full `H1::H2[::H3...]` path form** — see [Heading-path discipline](#heading-path-discipline-patch_content-get_heading_contents) above. |

### Search

| Tool | Description |
|------|-------------|
| `search` | Keyword search across vault |
| `complex_search` | JsonLogic query search (glob, regexp support) |
| `pattern_search` | Regex pattern extraction with context *(requires vault path)* |

### Periodic Notes & Recent Changes

| Tool | Description |
|------|-------------|
| `get_periodic_note` | Get current daily/weekly/monthly/quarterly/yearly note |
| `get_recent_periodic_notes` | Get recent periodic notes with optional content |
| `get_recent_changes` | Get recently modified files (requires Dataview) |

### Obsidian Integration

| Tool | Description |
|------|-------------|
| `get_active_file` | Get the currently active file in Obsidian |
| `open_file` | Open a file in Obsidian |
| `list_commands` | List all available Obsidian commands |
| `execute_command` | Execute one or more Obsidian commands |

### Graph Tools *(requires OBSIDIAN_VAULT_PATH)*

Each graph tool requires `OBSIDIAN_VAULT_PATH` to be set for the targeted vault. The two per-note tools (`get_note_connections`, `find_path_between_notes`) return `note not found: <path>` when the target note is not present in the vault — distinct from "found but no connections" (success with empty arrays) and "no path between endpoints" (success with `path: null`). Aggregation tools wrap their primary result in an envelope with `skipped` and `skippedPaths` (up to 50 entries) describing files skipped during the build because of read or parse errors. Full I/O contracts live under [`specs/004-fix-graph-tools/contracts/`](specs/004-fix-graph-tools/contracts/).

| Tool | Description | Contract |
|------|-------------|----------|
| `get_vault_stats` | Overview stats (notes, links, orphans, clusters) | [contract](specs/004-fix-graph-tools/contracts/get_vault_stats.md) |
| `get_vault_structure` | Folder tree structure of vault | [contract](specs/004-fix-graph-tools/contracts/get_vault_structure.md) |
| `find_orphan_notes` | Notes with no incoming/outgoing links | [contract](specs/004-fix-graph-tools/contracts/find_orphan_notes.md) |
| `get_note_connections` | Incoming/outgoing links + tags for a note. Returns `note not found: <path>` when missing. | [contract](specs/004-fix-graph-tools/contracts/get_note_connections.md) |
| `find_path_between_notes` | Shortest link path between two notes. Returns `note not found: <path>` (or `notes not found: <source>, <target>`) when an endpoint is missing. | [contract](specs/004-fix-graph-tools/contracts/find_path_between_notes.md) |
| `get_most_connected_notes` | Top notes by link count or PageRank | [contract](specs/004-fix-graph-tools/contracts/get_most_connected_notes.md) |
| `detect_note_clusters` | Community detection via graph analysis | [contract](specs/004-fix-graph-tools/contracts/detect_note_clusters.md) |

### Semantic Tools *(requires Smart Connections plugin)*

| Tool | Description |
|------|-------------|
| `semantic_search` | Conceptual search via Smart Connections |
| `find_similar_notes` | Find semantically similar notes |

## Development

```bash
# Watch mode
npm run dev

# Lint
npm run lint

# Type check
npm run typecheck

# Build
npm run build

# Run the test suite (vitest + nock-mocked HTTP)
npm test

# Run tests in watch mode
npm run test:watch
```

### Project Constitution & Spec-Driven Workflow

This repo uses [Spec Kit](https://github.com/github/spec-kit) for non-trivial
features. The project constitution (principles every contribution must
honor — modular code, public-tool tests, zod boundary validation, explicit
upstream error propagation) lives in
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).
Per-feature specs, plans, contracts, and task lists live under
[`specs/`](specs/). Pull requests should confirm that constitution
Principles I–IV were considered.

## License

MIT — see [LICENSE](LICENSE). Copyright is held by Connor England (upstream author); this fork's modifications are released under the same MIT terms.
