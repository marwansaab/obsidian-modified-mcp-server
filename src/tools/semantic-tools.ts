/**
 * Semantic search tools via Smart Connections API
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SEMANTIC_TOOLS: Tool[] = [
  {
    name: 'semantic_search',
    description: 'Concept-based search via Smart Connections. Finds conceptually related content using meaning/context similarity rather than keyword matching.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language concept query.',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 10).',
        },
        threshold: {
          type: 'number',
          description: 'Similarity threshold 0-1 (default: 0.7). Higher = more precise.',
        },
        filters: {
          type: 'object',
          properties: {
            folders: {
              type: 'array',
              items: { type: 'string' },
              description: 'Folder paths to search in.',
            },
            excludeFolders: {
              type: 'array',
              items: { type: 'string' },
              description: 'Folder paths to exclude.',
            },
          },
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_similar_notes',
    description: 'Find notes semantically similar to a given note.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the source note (relative to vault root).',
        },
        limit: {
          type: 'number',
          description: 'Maximum similar notes to return (default: 10).',
        },
        threshold: {
          type: 'number',
          description: 'Similarity threshold 0-1 (default: 0.5).',
        },
      },
      required: ['filepath'],
    },
  },
];
