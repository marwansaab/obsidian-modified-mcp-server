/**
 * Vault management tools: list vaults, get vault info
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const VAULT_TOOLS: Tool[] = [
  {
    name: 'list_vaults',
    description: 'List all configured Obsidian vaults with their IDs and capabilities.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];
