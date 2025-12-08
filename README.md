# @connorbritain/obsidian-mcp-server

[![npm version](https://img.shields.io/npm/v/@connorbritain/obsidian-mcp-server.svg)](https://www.npmjs.com/package/@connorbritain/obsidian-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TypeScript MCP server for Obsidian with core vault operations, graph analytics, and semantic search.

## Features

- **Core Tools**: Read, write, search, patch, append, delete files in your Obsidian vault
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
git clone https://github.com/connorbritain/obsidian-mcp-server.git
cd obsidian-mcp-server
npm install
npm run build
```

## Configuration

Set the following environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OBSIDIAN_API_KEY` | Yes | - | API key from Local REST API plugin settings |
| `OBSIDIAN_HOST` | No | `127.0.0.1` | Obsidian REST API host |
| `OBSIDIAN_PORT` | No | `27124` | Obsidian REST API port |
| `OBSIDIAN_PROTOCOL` | No | `https` | `http` or `https` |
| `OBSIDIAN_VAULT_PATH` | No | - | Path to vault (required for graph tools) |
| `SMART_CONNECTIONS_PORT` | No | - | Port for Smart Connections API |
| `GRAPH_CACHE_TTL` | No | `300` | Graph cache TTL in seconds |

## MCP Client Configuration

### Claude Desktop

Add to your `claude_desktop_config.json` (typically at `~/.config/claude/claude_desktop_config.json` on Linux/Mac or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/path/to/obsidian_mcp/dist/index.js"],
      "env": {
        "OBSIDIAN_API_KEY": "your-api-key-here",
        "OBSIDIAN_VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

### Windsurf / Cursor / Other MCP Clients

Add to your `mcp_config.json` (location varies by client):

**Windsurf**: `~/.windsurf/mcp_config.json`  
**Cursor**: `~/.cursor/mcp_config.json`

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/path/to/obsidian_mcp/dist/index.js"],
      "env": {
        "OBSIDIAN_API_KEY": "your-api-key-here",
        "OBSIDIAN_VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

### Using npx (Recommended)

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["@connorbritain/obsidian-mcp-server"],
      "env": {
        "OBSIDIAN_API_KEY": "your-api-key-here",
        "OBSIDIAN_VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

## Available Tools

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
| `patch_content` | Insert content relative to heading/block |

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
