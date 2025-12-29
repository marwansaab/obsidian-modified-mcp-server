/**
 * obsidian-mcp-server entry point
 * MCP server for Obsidian with core tools, graph analytics, and semantic search
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

import { getConfig } from './config.js';
import { GraphService } from './services/graph-service.js';
import { ObsidianRestService } from './services/obsidian-rest.js';
import { SmartConnectionsService } from './services/smart-connections.js';
import { ALL_TOOLS } from './tools/index.js';

import type { Config, VaultConfig } from './types.js';


type PatternSearchScope = {
  folders?: string[];
  filePattern?: string;
};

type PatternSearchOptions = {
  caseSensitive?: boolean;
  contextLines?: number;
  maxMatches?: number;
};

type PatternSearchResult = {
  vaultId: string;
  file: string;
  line: number;
  pattern: string;
  match: string;
  context: string;
};

class ObsidianMCPServer {
  private server: Server;
  private config: Config;
  private restServices = new Map<string, ObsidianRestService>();
  private graphServices = new Map<string, GraphService>();
  private semanticServices = new Map<string, SmartConnectionsService>();

  constructor() {
    this.config = getConfig();

    this.server = new Server(
      {
        name: 'obsidian-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private getVaultConfig(vaultId?: string): VaultConfig {
    const id = vaultId ?? this.config.defaultVaultId;
    const vault = this.config.vaults[id];
    if (!vault) {
      throw new Error(`Vault "${id}" is not configured`);
    }
    return vault;
  }

  private getRestService(vaultId?: string): ObsidianRestService {
    const vault = this.getVaultConfig(vaultId);
    if (!this.restServices.has(vault.id)) {
      this.restServices.set(vault.id, new ObsidianRestService(vault));
    }
    return this.restServices.get(vault.id)!;
  }

  private getGraphService(vaultId?: string): GraphService {
    const vault = this.getVaultConfig(vaultId);
    if (!vault.vaultPath) {
      throw new Error(`Vault "${vault.id}" does not have vaultPath configured (required for graph tools).`);
    }
    if (!this.graphServices.has(vault.id)) {
      this.graphServices.set(vault.id, new GraphService(vault, this.config.graphCacheTtl));
    }
    return this.graphServices.get(vault.id)!;
  }

  private getSemanticService(vaultId?: string): SmartConnectionsService {
    const vault = this.getVaultConfig(vaultId);
    if (!vault.smartConnectionsPort) {
      throw new Error(
        `Vault "${vault.id}" does not have smartConnectionsPort configured (required for semantic tools).`
      );
    }
    if (!this.semanticServices.has(vault.id)) {
      this.semanticServices.set(vault.id, new SmartConnectionsService(vault));
    }
    return this.semanticServices.get(vault.id)!;
  }

  private resolveVaultId(args: Record<string, unknown>): string {
    const requested = (args.vaultId as string | undefined)?.trim();
    return this.getVaultConfig(requested).id;
  }

  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  }

  private async runPatternSearch(
    vault: VaultConfig,
    patterns: string[],
    scope?: PatternSearchScope,
    options?: PatternSearchOptions
  ): Promise<PatternSearchResult[]> {
    if (!vault.vaultPath) {
      throw new Error(`pattern_search requires vaultPath to be configured for vault "${vault.id}".`);
    }

    const baseDir = vault.vaultPath;
    const folders =
      scope?.folders && Array.isArray(scope.folders) && scope.folders.length > 0
        ? scope.folders
            .map((folder) => folder?.trim())
            .filter((folder): folder is string => !!folder)
        : ['.'];
    const filePatternRegex = scope?.filePattern ? this.globToRegex(scope.filePattern) : null;
    const caseSensitive = options?.caseSensitive ?? false;
    const regexFlags = caseSensitive ? 'g' : 'gi';
    const contextLines = options?.contextLines ?? 2;
    const maxMatches = options?.maxMatches && options.maxMatches > 0 ? options.maxMatches : 100;

    const filesToSearch: string[] = [];

    const walkDir = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const absPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkDir(absPath);
        } else if (extname(entry.name).toLowerCase() === '.md') {
          const relPath = relative(baseDir, absPath).replace(/\\/g, '/');
          if (!filePatternRegex || filePatternRegex.test(relPath)) {
            filesToSearch.push(absPath);
          }
        }
      }
    };

    for (const folder of folders) {
      const absFolder = join(baseDir, folder);
      await walkDir(absFolder);
      if (filesToSearch.length >= maxMatches) break;
    }

    const compiledPatterns = patterns.map((pattern) => {
      try {
        // Validate regex
        new RegExp(pattern);
        return pattern;
      } catch (error) {
        throw new Error(`Invalid regex pattern "${pattern}": ${(error as Error).message}`);
      }
    });

    const results: PatternSearchResult[] = [];

    for (const absPath of filesToSearch) {
      if (results.length >= maxMatches) break;
      let content: string;
      try {
        content = await readFile(absPath, 'utf-8');
      } catch {
        continue;
      }

      const relPath = relative(baseDir, absPath).replace(/\\/g, '/');
      const lines = content.split(/\r?\n/);

      for (let lineIndex = 0; lineIndex < lines.length && results.length < maxMatches; lineIndex++) {
        const line = lines[lineIndex];

        for (const pattern of compiledPatterns) {
          const regex = new RegExp(pattern, regexFlags);
          let match: RegExpExecArray | null;

          while ((match = regex.exec(line)) !== null) {
            const snippetStart = Math.max(0, lineIndex - contextLines);
            const snippetEnd = Math.min(lines.length - 1, lineIndex + contextLines);
            const context = lines.slice(snippetStart, snippetEnd + 1).join('\n');

            results.push({
              vaultId: vault.id,
              file: relPath,
              line: lineIndex + 1,
              pattern,
              match: match[0],
              context,
            });

            if (results.length >= maxMatches) break;
            if (match[0].length === 0) {
              // Avoid infinite loops on zero-length matches
              regex.lastIndex++;
            }
          }

          if (results.length >= maxMatches) break;
        }
      }
    }

    return results;
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
  ): Promise<CallToolResult> {
    const vaultId = this.resolveVaultId(args);
    const vault = this.getVaultConfig(vaultId);
    const rest = this.getRestService(vaultId);

    switch (name) {
      case 'list_files_in_vault': {
        const files = await rest.listFilesInVault();
        return {
          content: [{ type: 'text', text: JSON.stringify(files, null, 2) }],
        };
      }

      case 'list_files_in_dir': {
        const dirpath = args.dirpath as string;
        if (!dirpath) throw new Error('dirpath is required');
        const files = await rest.listFilesInDir(dirpath);
        return {
          content: [{ type: 'text', text: JSON.stringify(files, null, 2) }],
        };
      }

      case 'get_file_contents': {
        const filepath = args.filepath as string;
        if (!filepath) throw new Error('filepath is required');
        const content = await rest.getFileContents(filepath);
        return {
          content: [{ type: 'text', text: content }],
        };
      }

      case 'search': {
        const query = args.query as string;
        if (!query) throw new Error('query is required');
        const contextLength = (args.contextLength as number) ?? 100;
        const results = await rest.search(query, contextLength);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      // DISABLED: patch_content handler commented out due to known bugs in Obsidian Local REST API
      // See: https://github.com/coddingtonbear/obsidian-local-rest-api/issues/146
      // case 'patch_content': {
      //   const { filepath, operation, targetType, target, content } = args as {
      //     filepath: string;
      //     operation: string;
      //     targetType: string;
      //     target: string;
      //     content: string;
      //   };
      //   if (!filepath || !operation || !targetType || !target || !content) {
      //     throw new Error('filepath, operation, targetType, target, and content are required');
      //   }
      //   await this.obsidianRest.patchContent(filepath, operation, targetType, target, content);
      //   return {
      //     content: [{ type: 'text', text: 'Content patched successfully' }],
      //   };
      // }

      case 'append_content': {
        const filepath = args.filepath as string;
        const content = args.content as string;
        if (!filepath || !content) throw new Error('filepath and content are required');
        await rest.appendContent(filepath, content);
        return {
          content: [{ type: 'text', text: 'Content appended successfully' }],
        };
      }

      case 'put_content': {
        const filepath = args.filepath as string;
        const content = args.content as string;
        if (!filepath || !content) throw new Error('filepath and content are required');
        await rest.putContent(filepath, content);
        return {
          content: [{ type: 'text', text: 'Content written successfully' }],
        };
      }

      case 'delete_file': {
        const filepath = args.filepath as string;
        if (!filepath) throw new Error('filepath is required');
        await rest.deleteFile(filepath);
        return {
          content: [{ type: 'text', text: 'File deleted successfully' }],
        };
      }

      case 'batch_get_file_contents': {
        const filepaths = args.filepaths as string[];
        if (!filepaths || !Array.isArray(filepaths)) throw new Error('filepaths array is required');
        const content = await rest.getBatchFileContents(filepaths);
        return {
          content: [{ type: 'text', text: content }],
        };
      }

      case 'complex_search': {
        const query = args.query as Record<string, unknown>;
        if (!query) throw new Error('query is required');
        const results = await rest.searchJson(query);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'get_periodic_note': {
        const period = args.period as string;
        const type = (args.type as string) ?? 'content';
        if (!period) throw new Error('period is required');
        const content = await rest.getPeriodicNote(period, type);
        return {
          content: [{ type: 'text', text: content }],
        };
      }

      case 'get_recent_periodic_notes': {
        const period = args.period as string;
        const limit = (args.limit as number) ?? 5;
        const includeContent = (args.include_content as boolean) ?? false;
        if (!period) throw new Error('period is required');
        const results = await rest.getRecentPeriodicNotes(period, limit, includeContent);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'get_recent_changes': {
        const limit = (args.limit as number) ?? 10;
        const days = (args.days as number) ?? 90;
        const results = await rest.getRecentChanges(limit, days);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'get_active_file': {
        const content = await rest.getActiveFile();
        return {
          content: [{ type: 'text', text: content }],
        };
      }

      case 'open_file': {
        const filepath = args.filepath as string;
        if (!filepath) throw new Error('filepath is required');
        await rest.openFile(filepath);
        return {
          content: [{ type: 'text', text: 'File opened successfully' }],
        };
      }

      case 'list_commands': {
        const commands = await rest.listCommands();
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
            await rest.executeCommand(cmd);
            results.push(`✓ ${cmd}`);
          } catch (err) {
            results.push(`✗ ${cmd}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return {
          content: [{ type: 'text', text: results.join('\n') }],
        };
      }

      case 'pattern_search': {
        const patterns = args.patterns as string[];
        if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
          throw new Error('patterns array is required');
        }
        const scope = args.scope as PatternSearchScope | undefined;
        const options = args.options as PatternSearchOptions | undefined;
        const results = await this.runPatternSearch(vault, patterns, scope, options);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      default: {
        throw new Error(`Unknown tool: ${name}`);
      }
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
