/**
 * Obsidian integration tools: active file, open file, commands
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const OBSIDIAN_TOOLS: Tool[] = [
  {
    name: 'get_active_file',
    description: 'Get the currently active file in Obsidian.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'open_file',
    description: 'Open a file in Obsidian.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file to open (relative to vault root).',
        },
      },
      required: ['filepath'],
    },
  },
  {
    name: 'list_commands',
    description: 'List all available commands in Obsidian. For commands that operate on notes, open a note first.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'execute_command',
    description: 'Execute one or more Obsidian commands in order. For commands that operate on notes, open a note first.',
    inputSchema: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of command IDs to execute.',
        },
      },
      required: ['commands'],
    },
  },
];
