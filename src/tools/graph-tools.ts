/**
 * Graph analysis tools using graphology
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const GRAPH_TOOLS: Tool[] = [
  {
    name: 'get_vault_stats',
    description: 'Get overview statistics about the vault: total notes, links, orphans, tags, clusters.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'find_orphan_notes',
    description: 'Find notes with no incoming or outgoing links.',
    inputSchema: {
      type: 'object',
      properties: {
        includeBacklinks: {
          type: 'boolean',
          description: 'Consider backlinks when determining orphan status (default: true).',
        },
      },
    },
  },
  {
    name: 'get_note_connections',
    description: 'Get all connections for a note: outgoing links, backlinks, tags, and embeds.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the note (relative to vault root).',
        },
        depth: {
          type: 'number',
          description: 'How many levels of connections to traverse (default: 1).',
        },
      },
      required: ['filepath'],
    },
  },
  {
    name: 'find_path_between_notes',
    description: 'Find the shortest link path between two notes.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Source note path.',
        },
        target: {
          type: 'string',
          description: 'Target note path.',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum path length to search (default: 5).',
        },
      },
      required: ['source', 'target'],
    },
  },
  {
    name: 'get_most_connected_notes',
    description: 'Get the most connected notes by link count or PageRank.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of notes to return (default: 10).',
        },
        metric: {
          type: 'string',
          enum: ['links', 'backlinks', 'pagerank'],
          description: 'Metric to rank by (default: backlinks).',
        },
      },
    },
  },
  {
    name: 'detect_note_clusters',
    description: 'Detect communities/clusters of related notes using graph analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        minClusterSize: {
          type: 'number',
          description: 'Minimum notes per cluster (default: 3).',
        },
      },
    },
  },
  {
    name: 'get_vault_structure',
    description: 'Get the folder tree structure of the vault.',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: {
          type: 'number',
          description: 'Maximum folder depth to return (default: unlimited).',
        },
        includeFiles: {
          type: 'boolean',
          description: 'Include files in the tree, not just folders (default: false).',
        },
      },
    },
  },
];
