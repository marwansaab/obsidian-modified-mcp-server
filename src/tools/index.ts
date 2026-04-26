/**
 * Tool registration and exports
 */

import { FILE_TOOLS } from './file-tools.js';
import { GRAPH_TOOLS } from './graph-tools.js';
import { OBSIDIAN_TOOLS } from './obsidian-tools.js';
import { PERIODIC_TOOLS } from './periodic-tools.js';
import { SEARCH_TOOLS } from './search-tools.js';
import { SEMANTIC_TOOLS } from './semantic-tools.js';
import { SURGICAL_READ_TOOLS } from './surgical-reads/tool.js';
import { VAULT_TOOLS } from './vault-tools.js';
import { WRITE_TOOLS } from './write-tools.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/** All available tools */
export const ALL_TOOLS: Tool[] = [
  ...VAULT_TOOLS,
  ...FILE_TOOLS,
  ...WRITE_TOOLS,
  ...SEARCH_TOOLS,
  ...PERIODIC_TOOLS,
  ...OBSIDIAN_TOOLS,
  ...GRAPH_TOOLS,
  ...SEMANTIC_TOOLS,
  ...SURGICAL_READ_TOOLS,
];

export {
  VAULT_TOOLS,
  FILE_TOOLS,
  WRITE_TOOLS,
  SEARCH_TOOLS,
  PERIODIC_TOOLS,
  OBSIDIAN_TOOLS,
  GRAPH_TOOLS,
  SEMANTIC_TOOLS,
  SURGICAL_READ_TOOLS,
};
