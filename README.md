# Obsidian MCP Server

[![npm version](https://img.shields.io/npm/v/@connorbritain/obsidian-mcp-server.svg)](https://www.npmjs.com/package/@connorbritain/obsidian-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TypeScript MCP server for Obsidian with core vault operations, graph analytics, and semantic search.

## Features

- **Core Tools**: Read, write, search, append, delete files in your Obsidian vault
- **Periodic Notes**: Access daily, weekly, monthly notes and recent changes
- **Advanced Search**: JsonLogic queries for complex filtering
- **Graph Tools**: Orphan detection, centrality analysis, cluster detection, path finding
- **Semantic Search**: Smart Connections integration for concept-based search

## Prerequisites

- Node.js 18+
- [Obsidian](https://obsidian.md/) with [Local REST API plugin](https://github.com/coddingtonbear/obsidian-local-rest-api) installed and enabled
- (Optional) [Dataview plugin](https://github.com/blacksmithgu/obsidian-dataview) for `get_recent_changes`
- (Optional) [Periodic Notes plugin](https://github.com/liamcain/obsidian-periodic-notes) for periodic note tools
- (Optional) [Smart Connections plugin](https://github.com/brianpetro/obsidian-smart-connections) for semantic search

## Installation

### From npm

```bash
npm install -g @connorbritain/obsidian-mcp-server
```

### From source

```bash
git clone https://github.com/ConnorBritain/obsidian-mcp-server.git
cd obsidian-mcp-server
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

Each tool in the MCP server now accepts an optional `vaultId` argument. When omitted, the server uses `OBSIDIAN_DEFAULT_VAULT` (or the first defined vault). This allows a single MCP session to read/write multiple vaults just by specifying which vault to target in the tool call.

## MCP Client Configuration

### Using npx (Recommended)

Use `npx` for the simplest setup:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "@connorbritain/obsidian-mcp-server"],
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
      "args": ["/absolute/path/to/obsidian-mcp-server/dist/index.js"],
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

### Core File Operations

| Tool | Description |
|------|-------------|
| `list_files_in_vault` | List all files/directories in vault root |
| `list_files_in_dir` | List files in a specific directory |
| `get_file_contents` | Read a single file |
| `batch_get_file_contents` | Read multiple files concatenated with headers |
| `delete_file` | Delete file or directory |

### Write Operations

| Tool | Description |
|------|-------------|
| `append_content` | Append to file (creates if missing) |
| `put_content` | Overwrite file content |
| ~~`patch_content`~~ | ⚠️ **Disabled**: Insert content relative to heading/block (awaiting Obsidian REST API fix - [see issue #146](https://github.com/coddingtonbear/obsidian-local-rest-api/issues/146)) |

> **Note**: The `patch_content` tool is currently disabled due to known bugs in the Obsidian Local REST API plugin. Use the read-modify-write pattern with `get_file_contents` + `put_content` as a reliable alternative.

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

| Tool | Description |
|------|-------------|
| `get_vault_stats` | Overview stats (notes, links, orphans, clusters) |
| `find_orphan_notes` | Notes with no incoming/outgoing links |
| `get_note_connections` | Incoming/outgoing links + tags for a note |
| `find_path_between_notes` | Shortest link path between two notes |
| `get_most_connected_notes` | Top notes by link count or PageRank |
| `detect_note_clusters` | Community detection via graph analysis |
| `get_vault_structure` | Folder tree structure of vault |

### Semantic Tools *(requires Smart Connections plugin)*

| Tool | Description |
|------|-------------|
| `semantic_search` | Conceptual search via Smart Connections |
| `find_similar_notes` | Find semantically similar notes

## Development

```bash
# Watch mode
npm run dev

# Type check
npm run typecheck

# Build
npm run build
```

## License

MIT
