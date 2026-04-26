/**
 * Write operation tools: append, put, patch
 */

import { PATCH_CONTENT_TOOLS } from './patch-content/tool.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const WRITE_TOOLS: Tool[] = [
  {
    name: 'append_content',
    description: 'Append content to a file. Creates the file if it does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file (relative to vault root).',
        },
        content: {
          type: 'string',
          description: 'The markdown content to append.',
        },
        vaultId: {
          type: 'string',
          description: 'Optional vault ID (defaults to configured default vault).',
        },
      },
      required: ['filepath', 'content'],
    },
  },
  {
    name: 'put_content',
    description: 'Overwrite the entire content of a file. Creates the file if it does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file (relative to vault root).',
        },
        content: {
          type: 'string',
          description: 'The markdown content to write.',
        },
        vaultId: {
          type: 'string',
          description: 'Optional vault ID (defaults to configured default vault).',
        },
      },
      required: ['filepath', 'content'],
    },
  },
  ...PATCH_CONTENT_TOOLS,
];
