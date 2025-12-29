/**
 * Write operation tools: append, put, patch
 */

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
  // DISABLED: patch_content tool commented out due to known bugs in Obsidian Local REST API
  // See: https://github.com/coddingtonbear/obsidian-local-rest-api/issues/146
  // Workaround: Use get_file_contents + put_content for reliable content modification
  // {
  //   name: 'patch_content',
  //   description: 'Insert content relative to a heading, block, or frontmatter in a file.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       filepath: {
  //         type: 'string',
  //         description: 'Path to the file (relative to vault root).',
  //       },
  //       operation: {
  //         type: 'string',
  //         enum: ['append', 'prepend', 'replace'],
  //         description: 'How to insert the content relative to the target.',
  //       },
  //       targetType: {
  //         type: 'string',
  //         enum: ['heading', 'block', 'frontmatter'],
  //         description: 'Type of target to locate.',
  //       },
  //       target: {
  //         type: 'string',
  //         description: 'The heading text, block ID, or frontmatter key to target.',
  //       },
  //       content: {
  //         type: 'string',
  //         description: 'The markdown content to insert.',
  //       },
  //     },
  //     required: ['filepath', 'operation', 'targetType', 'target', 'content'],
  //   },
  // },
];
