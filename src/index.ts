#!/usr/bin/env node
/**
 * obsidian-mcp-server entry point
 * MCP server for Obsidian with core tools, graph analytics, and semantic search
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from './config.js';
import { ObsidianRestService } from './services/obsidian-rest.js';
import { GraphService } from './services/graph-service.js';
import { SmartConnectionsService } from './services/smart-connections.js';
import { ALL_TOOLS } from './tools/index.js';
import type { ToolResult, Config } from './types.js';

class ObsidianMCPServer {
  private server: Server;
  private obsidianRest: ObsidianRestService;
  private graphService: GraphService;
  private smartConnections: SmartConnectionsService;
  private config: Config;

  constructor() {
    this.config = getConfig();
    this.obsidianRest = new ObsidianRestService(this.config);
    this.graphService = new GraphService(this.config);
    this.smartConnections = new SmartConnectionsService(this.config);

    this.server = new Server({
      name: 'obsidian-mcp-server',
      version: '0.1.0',
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: ALL_TOOLS };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await this.handleToolCall(name, args ?? {});
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Tool ${name} failed:`, message);
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        };
      }
    });
  }

  private async handleToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    switch (name) {
      case 'list_files_in_vault': {
        const files = await this.obsidianRest.listFilesInVault();
        return {
          content: [{ type: 'text', text: JSON.stringify(files, null, 2) }],
        };
      }

      case 'list_files_in_dir': {
        const dirpath = args.dirpath as string;
        if (!dirpath) throw new Error('dirpath is required');
        const files = await this.obsidianRest.listFilesInDir(dirpath);
        return {
          content: [{ type: 'text', text: JSON.stringify(files, null, 2) }],
        };
      }

      case 'get_file_contents': {
        const filepath = args.filepath as string;
        if (!filepath) throw new Error('filepath is required');
        const content = await this.obsidianRest.getFileContents(filepath);
        return {
          content: [{ type: 'text', text: content }],
        };
      }

      case 'search': {
        const query = args.query as string;
        if (!query) throw new Error('query is required');
        const contextLength = (args.contextLength as number) ?? 100;
        const results = await this.obsidianRest.search(query, contextLength);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'patch_content': {
        const { filepath, operation, targetType, target, content } = args as {
          filepath: string;
          operation: string;
          targetType: string;
          target: string;
          content: string;
        };
        if (!filepath || !operation || !targetType || !target || !content) {
          throw new Error('filepath, operation, targetType, target, and content are required');
        }
        await this.obsidianRest.patchContent(filepath, operation, targetType, target, content);
        return {
          content: [{ type: 'text', text: 'Content patched successfully' }],
        };
      }

      case 'append_content': {
        const filepath = args.filepath as string;
        const content = args.content as string;
        if (!filepath || !content) throw new Error('filepath and content are required');
        await this.obsidianRest.appendContent(filepath, content);
        return {
          content: [{ type: 'text', text: 'Content appended successfully' }],
        };
      }

      case 'put_content': {
        const filepath = args.filepath as string;
        const content = args.content as string;
        if (!filepath || !content) throw new Error('filepath and content are required');
        await this.obsidianRest.putContent(filepath, content);
        return {
          content: [{ type: 'text', text: 'Content written successfully' }],
        };
      }

      case 'delete_file': {
        const filepath = args.filepath as string;
        if (!filepath) throw new Error('filepath is required');
        await this.obsidianRest.deleteFile(filepath);
        return {
          content: [{ type: 'text', text: 'File deleted successfully' }],
        };
      }

      case 'batch_get_file_contents': {
        const filepaths = args.filepaths as string[];
        if (!filepaths || !Array.isArray(filepaths)) throw new Error('filepaths array is required');
        const content = await this.obsidianRest.getBatchFileContents(filepaths);
        return {
          content: [{ type: 'text', text: content }],
        };
      }

      case 'complex_search': {
        const query = args.query as Record<string, unknown>;
        if (!query) throw new Error('query is required');
        const results = await this.obsidianRest.searchJson(query);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'get_periodic_note': {
        const period = args.period as string;
        const type = (args.type as string) ?? 'content';
        if (!period) throw new Error('period is required');
        const content = await this.obsidianRest.getPeriodicNote(period, type);
        return {
          content: [{ type: 'text', text: content }],
        };
      }

      case 'get_recent_periodic_notes': {
        const period = args.period as string;
        const limit = (args.limit as number) ?? 5;
        const includeContent = (args.include_content as boolean) ?? false;
        if (!period) throw new Error('period is required');
        const results = await this.obsidianRest.getRecentPeriodicNotes(period, limit, includeContent);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'get_recent_changes': {
        const limit = (args.limit as number) ?? 10;
        const days = (args.days as number) ?? 90;
        const results = await this.obsidianRest.getRecentChanges(limit, days);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'get_active_file': {
        const content = await this.obsidianRest.getActiveFile();
        return {
          content: [{ type: 'text', text: content }],
        };
      }

      case 'open_file': {
        const filepath = args.filepath as string;
        if (!filepath) throw new Error('filepath is required');
        await this.obsidianRest.openFile(filepath);
        return {
          content: [{ type: 'text', text: 'File opened successfully' }],
        };
      }

      case 'list_commands': {
        const commands = await this.obsidianRest.listCommands();
        return {
          content: [{ type: 'text', text: JSON.stringify(commands, null, 2) }],
        };
      }

      case 'execute_command': {
        const commands = args.commands as string[];
        if (!commands || !Array.isArray(commands)) throw new Error('commands array is required');
        const results: string[] = [];
        for (const cmd of commands) {
          try {
            await this.obsidianRest.executeCommand(cmd);
            results.push(`✓ ${cmd}`);
          } catch (err) {
            results.push(`✗ ${cmd}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return {
          content: [{ type: 'text', text: results.join('\n') }],
        };
      }

      // Pattern search - requires local file access
      case 'pattern_search': {
        if (!this.config.vaultPath) {
          return {
            content: [{ type: 'text', text: 'Pattern search requires OBSIDIAN_VAULT_PATH to be set.' }],
            isError: true,
          };
        }
        // TODO: Implement pattern search using vault path + regex
        return {
          content: [{ type: 'text', text: 'Pattern search implementation pending.' }],
          isError: true,
        };
      }

      // Graph tools
      case 'get_vault_stats': {
        if (!this.config.vaultPath) {
          return { content: [{ type: 'text', text: 'OBSIDIAN_VAULT_PATH required for graph tools.' }], isError: true };
        }
        const stats = await this.graphService.getVaultStats();
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      }

      case 'find_orphan_notes': {
        if (!this.config.vaultPath) {
          return { content: [{ type: 'text', text: 'OBSIDIAN_VAULT_PATH required for graph tools.' }], isError: true };
        }
        const includeBacklinks = (args.includeBacklinks as boolean) ?? true;
        const orphans = await this.graphService.findOrphanNotes(includeBacklinks);
        return { content: [{ type: 'text', text: JSON.stringify(orphans, null, 2) }] };
      }

      case 'get_note_connections': {
        if (!this.config.vaultPath) {
          return { content: [{ type: 'text', text: 'OBSIDIAN_VAULT_PATH required for graph tools.' }], isError: true };
        }
        const filepath = args.filepath as string;
        if (!filepath) throw new Error('filepath is required');
        const depth = (args.depth as number) ?? 1;
        const connections = await this.graphService.getNoteConnections(filepath, depth);
        return { content: [{ type: 'text', text: JSON.stringify(connections, null, 2) }] };
      }

      case 'find_path_between_notes': {
        if (!this.config.vaultPath) {
          return { content: [{ type: 'text', text: 'OBSIDIAN_VAULT_PATH required for graph tools.' }], isError: true };
        }
        const source = args.source as string;
        const target = args.target as string;
        if (!source || !target) throw new Error('source and target are required');
        const maxDepth = (args.maxDepth as number) ?? 5;
        const path = await this.graphService.findPathBetweenNotes(source, target, maxDepth);
        if (path) {
          return { content: [{ type: 'text', text: JSON.stringify(path, null, 2) }] };
        }
        return { content: [{ type: 'text', text: 'No path found between notes.' }] };
      }

      case 'get_most_connected_notes': {
        if (!this.config.vaultPath) {
          return { content: [{ type: 'text', text: 'OBSIDIAN_VAULT_PATH required for graph tools.' }], isError: true };
        }
        const limit = (args.limit as number) ?? 10;
        const metric = (args.metric as 'links' | 'backlinks' | 'pagerank') ?? 'backlinks';
        const connected = await this.graphService.getMostConnectedNotes(limit, metric);
        return { content: [{ type: 'text', text: JSON.stringify(connected, null, 2) }] };
      }

      case 'detect_note_clusters': {
        if (!this.config.vaultPath) {
          return { content: [{ type: 'text', text: 'OBSIDIAN_VAULT_PATH required for graph tools.' }], isError: true };
        }
        const minClusterSize = (args.minClusterSize as number) ?? 3;
        const clusters = await this.graphService.detectNoteClusters(minClusterSize);
        return { content: [{ type: 'text', text: JSON.stringify(clusters, null, 2) }] };
      }

      case 'get_vault_structure': {
        if (!this.config.vaultPath) {
          return { content: [{ type: 'text', text: 'OBSIDIAN_VAULT_PATH required for graph tools.' }], isError: true };
        }
        const maxDepth = args.maxDepth as number | undefined;
        const includeFiles = (args.includeFiles as boolean) ?? false;
        const structure = await this.graphService.getVaultStructure(maxDepth, includeFiles);
        return { content: [{ type: 'text', text: JSON.stringify(structure, null, 2) }] };
      }

      // Semantic tools
      case 'semantic_search': {
        const query = args.query as string;
        if (!query) throw new Error('query is required');
        const limit = (args.limit as number) ?? 10;
        const threshold = (args.threshold as number) ?? 0.7;
        const filters = args.filters as { folders?: string[]; excludeFolders?: string[] } | undefined;
        const results = await this.smartConnections.search(query, {
          limit,
          threshold,
          folders: filters?.folders,
          excludeFolders: filters?.excludeFolders,
        });
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      case 'find_similar_notes': {
        const filepath = args.filepath as string;
        if (!filepath) throw new Error('filepath is required');
        const limit = (args.limit as number) ?? 10;
        const threshold = (args.threshold as number) ?? 0.5;
        const results = await this.smartConnections.findSimilar(filepath, { limit, threshold });
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('obsidian-mcp-server running on stdio');
  }
}

async function main(): Promise<void> {
  try {
    console.error('Starting obsidian-mcp-server...');
    const server = new ObsidianMCPServer();
    await server.run();
  } catch (error) {
    console.error('Failed to start server:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('Received SIGINT, shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down');
  process.exit(0);
});

main();
