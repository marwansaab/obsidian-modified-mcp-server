/**
 * File operation tools: list, get, batch, delete
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const FILE_TOOLS: Tool[] = [
  {
    name: 'list_files_in_vault',
    description: 'Lists all files and directories in the root of your Obsidian vault.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_files_in_dir',
    description: 'Lists all files and directories in a specific directory within your Obsidian vault.',
    inputSchema: {
      type: 'object',
      properties: {
        dirpath: {
          type: 'string',
          description: 'Path to the directory (relative to vault root). Empty directories are not returned.',
        },
      },
      required: ['dirpath'],
    },
  },
  {
    name: 'get_file_contents',
    description: 'Returns the content of a single file in your vault.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file (relative to vault root).',
        },
      },
      required: ['filepath'],
    },
  },
  {
    name: 'batch_get_file_contents',
    description: 'Return the contents of multiple files concatenated with headers.',
    inputSchema: {
      type: 'object',
      properties: {
        filepaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of file paths to read (relative to vault root).',
        },
      },
      required: ['filepaths'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or directory from the vault.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file or directory to delete (relative to vault root).',
        },
      },
      required: ['filepath'],
    },
  },
];
