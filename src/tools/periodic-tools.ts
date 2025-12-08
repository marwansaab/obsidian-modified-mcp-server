/**
 * Periodic notes and recent changes tools
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const PERIODIC_TOOLS: Tool[] = [
  {
    name: 'get_periodic_note',
    description: 'Get the current periodic note for a specified period.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
          description: 'The period type.',
        },
        type: {
          type: 'string',
          enum: ['content', 'metadata'],
          description: 'Return type: content only or with metadata (default: content).',
        },
      },
      required: ['period'],
    },
  },
  {
    name: 'get_recent_periodic_notes',
    description: 'Get most recent periodic notes for a specified period type.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
          description: 'The period type.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of notes to return (default: 5).',
        },
        include_content: {
          type: 'boolean',
          description: 'Whether to include note content (default: false).',
        },
      },
      required: ['period'],
    },
  },
  {
    name: 'get_recent_changes',
    description: 'Get recently modified files in the vault.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of files to return (default: 10).',
        },
        days: {
          type: 'number',
          description: 'Only include files modified within this many days (default: 90).',
        },
      },
    },
  },
];
