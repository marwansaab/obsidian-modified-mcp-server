/**
 * Tool registration and exports
 */

import { DELETE_FILE_TOOLS } from './delete-file/tool.js';
import { FILE_TOOLS } from './file-tools.js';
import { FIND_AND_REPLACE_TOOLS } from './find-and-replace/tool.js';
import { GRAPH_TOOLS } from './graph/tool.js';
import { LIST_TAGS_TOOLS } from './list-tags/tool.js';
import { OBSIDIAN_TOOLS } from './obsidian-tools.js';
import { PERIODIC_TOOLS } from './periodic-tools.js';
import { RENAME_FILE_TOOLS } from './rename-file/tool.js';
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
  ...DELETE_FILE_TOOLS,
  ...WRITE_TOOLS,
  ...SEARCH_TOOLS,
  ...PERIODIC_TOOLS,
  ...OBSIDIAN_TOOLS,
  ...GRAPH_TOOLS,
  ...SEMANTIC_TOOLS,
  ...SURGICAL_READ_TOOLS,
  ...LIST_TAGS_TOOLS,
  ...FIND_AND_REPLACE_TOOLS,
  // RENAME_FILE_TOOLS intentionally NOT included until 012's
  // rename_file handler ships (it's gated on this feature's
  // rest.findAndReplace, which is now available — see
  // specs/012-safe-rename/plan.md §"Implementation order constraint").
  // The 012 unblock work is tracked in 012's tasks file.
];

export {
  VAULT_TOOLS,
  FILE_TOOLS,
  DELETE_FILE_TOOLS,
  WRITE_TOOLS,
  SEARCH_TOOLS,
  PERIODIC_TOOLS,
  OBSIDIAN_TOOLS,
  GRAPH_TOOLS,
  SEMANTIC_TOOLS,
  SURGICAL_READ_TOOLS,
  LIST_TAGS_TOOLS,
  RENAME_FILE_TOOLS,
  FIND_AND_REPLACE_TOOLS,
};
