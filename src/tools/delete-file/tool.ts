/**
 * delete_file tool: MCP `Tool[]` registration entry.
 *
 * The `inputSchema` is derived from `DeleteFileRequestSchema` via
 * `zod-to-json-schema` so the published JSON Schema and the runtime
 * validator cannot drift apart (Constitution Principle III).
 *
 * The description text advertises the recursive-on-directory contract
 * (FR-011) and the timeout-coherence behaviour, so an LLM consumer
 * reading the catalogue can determine the contract without invoking
 * the tool (SC-006).
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

import { DeleteFileRequestSchema } from './schema.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const inputSchema = zodToJsonSchema(DeleteFileRequestSchema, {
  $refStrategy: 'none',
}) as Tool['inputSchema'];

export const DELETE_FILE_TOOLS: Tool[] = [
  {
    name: 'delete_file',
    description:
      'Delete a file or directory from the vault. ' +
      'When the path refers to a directory, the deletion is recursive: every contained file and ' +
      'subdirectory is removed before the directory itself is deleted, in a single tool call. ' +
      'The caller does not need to empty the directory beforehand. ' +
      'On a transport-layer timeout the wrapper performs a verification listing query against the ' +
      'parent before reporting outcome, so the response always reflects the actual post-condition ' +
      'on the vault.',
    inputSchema,
  },
];
