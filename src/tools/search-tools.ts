/**
 * Search tools: keyword search, complex JsonLogic search, pattern search
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SEARCH_TOOLS: Tool[] = [
  {
    name: 'search',
    description: 'Performs a keyword search across all files in the vault.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query.',
        },
        contextLength: {
          type: 'number',
          description: 'Number of characters of context around each match (default: 100).',
        },
        vaultId: {
          type: 'string',
          description: 'Optional vault ID (defaults to configured default vault).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'complex_search',
    description: 'Search using JsonLogic query. Supports glob and regexp operators for pattern matching.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'object',
          description: 'JsonLogic query object. Example: {"glob": ["*.md", {"var": "path"}]}',
        },
        vaultId: {
          type: 'string',
          description: 'Optional vault ID (defaults to configured default vault).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'pattern_search',
    description: 'Regex pattern extraction with context. Use for structured data mining, format analysis, content auditing.',
    inputSchema: {
      type: 'object',
      properties: {
        patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Regex patterns to search for. Examples: "\\\\b\\\\d{4}-\\\\d{2}-\\\\d{2}\\\\b" for dates, "TODO:.*" for todos.',
        },
        scope: {
          type: 'object',
          properties: {
            folders: {
              type: 'array',
              items: { type: 'string' },
              description: 'Folders to search in.',
            },
            filePattern: {
              type: 'string',
              description: 'Filename glob pattern, e.g., "*.md".',
            },
          },
        },
        options: {
          type: 'object',
          properties: {
            caseSensitive: {
              type: 'boolean',
              description: 'Case-sensitive matching (default: false).',
            },
            contextLines: {
              type: 'number',
              description: 'Lines of context around matches (default: 2).',
            },
            maxMatches: {
              type: 'number',
              description: 'Maximum matches to return.',
            },
          },
        },
        vaultId: {
          type: 'string',
          description: 'Optional vault ID (defaults to configured default vault).',
        },
      },
      required: ['patterns'],
    },
  },
];
