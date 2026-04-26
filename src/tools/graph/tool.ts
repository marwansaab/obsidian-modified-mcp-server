/**
 * Graph tools: MCP `Tool[]` registration entries.
 *
 * The `inputSchema` for each tool is derived from the matching zod
 * schema in ./schemas.ts via `zod-to-json-schema`, so the published
 * schema and the runtime validator cannot drift apart (Principle III).
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  DetectNoteClustersRequestSchema,
  FindOrphanNotesRequestSchema,
  FindPathBetweenNotesRequestSchema,
  GetMostConnectedNotesRequestSchema,
  GetNoteConnectionsRequestSchema,
  GetVaultStatsRequestSchema,
  GetVaultStructureRequestSchema,
} from './schemas.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ZodTypeAny } from 'zod';

const PRECONDITION = 'Requires OBSIDIAN_VAULT_PATH to be set for the targeted vault.';
const PER_NOTE_NOT_FOUND =
  "Returns a precondition-style error 'note not found: <path>' when the target note is not present in the vault — distinct from 'found but no connections'/'no path between endpoints'.";

function toJsonSchema(schema: ZodTypeAny): Tool['inputSchema'] {
  return zodToJsonSchema(schema, { $refStrategy: 'none' }) as Tool['inputSchema'];
}

export const GRAPH_TOOLS: Tool[] = [
  {
    name: 'get_vault_stats',
    description:
      'Get overview statistics about the vault: total notes, links, orphans, tags, clusters. ' +
      PRECONDITION,
    inputSchema: toJsonSchema(GetVaultStatsRequestSchema),
  },
  {
    name: 'get_vault_structure',
    description: 'Get the folder tree structure of the vault. ' + PRECONDITION,
    inputSchema: toJsonSchema(GetVaultStructureRequestSchema),
  },
  {
    name: 'find_orphan_notes',
    description: 'Find notes with no incoming or outgoing links. ' + PRECONDITION,
    inputSchema: toJsonSchema(FindOrphanNotesRequestSchema),
  },
  {
    name: 'get_note_connections',
    description:
      'Get all connections for a note: outgoing links, backlinks, tags. ' +
      PRECONDITION +
      ' ' +
      PER_NOTE_NOT_FOUND,
    inputSchema: toJsonSchema(GetNoteConnectionsRequestSchema),
  },
  {
    name: 'find_path_between_notes',
    description:
      'Find the shortest link path between two notes. ' +
      PRECONDITION +
      ' ' +
      PER_NOTE_NOT_FOUND,
    inputSchema: toJsonSchema(FindPathBetweenNotesRequestSchema),
  },
  {
    name: 'get_most_connected_notes',
    description:
      'Get the most connected notes by link count or PageRank. ' + PRECONDITION,
    inputSchema: toJsonSchema(GetMostConnectedNotesRequestSchema),
  },
  {
    name: 'detect_note_clusters',
    description:
      'Detect communities/clusters of related notes using graph analysis. ' + PRECONDITION,
    inputSchema: toJsonSchema(DetectNoteClustersRequestSchema),
  },
];
