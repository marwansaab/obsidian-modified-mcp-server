/**
 * Semantic search tools via Smart Connections API.
 *
 * `find_similar_notes` is registered with a zod-derived `inputSchema` so the
 * published JSON Schema and the runtime validator share a single source of
 * truth (Constitution Principle III). The dispatcher case for this tool lives
 * in [src/index.ts](../index.ts) and wires through `assertValidFindSimilarNotesRequest`
 * + `toForwardSlashPath` before delegating to `SmartConnectionsService.findSimilar`.
 *
 * `semantic_search` retains its hand-written JSON schema and is intentionally
 * still unwired in the dispatcher — see specs/006-normalise-graph-paths/research.md
 * R5. Bringing it in scope is a separate latent fix.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ZodTypeAny } from 'zod';

export const FindSimilarNotesRequestSchema = z.object({
  filepath: z
    .string()
    .min(1, 'filepath must be a non-empty string')
    .describe(
      'Path to the source note (relative to vault root). Forward-slash or backslash separators both accepted.'
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum similar notes to return (default: 10).'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Similarity threshold 0-1 (default: 0.5).'),
  vaultId: z
    .string()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export type FindSimilarNotesRequest = z.infer<typeof FindSimilarNotesRequestSchema>;

export function assertValidFindSimilarNotesRequest(args: unknown): FindSimilarNotesRequest {
  return FindSimilarNotesRequestSchema.parse(args);
}

function toJsonSchema(schema: ZodTypeAny): Tool['inputSchema'] {
  return zodToJsonSchema(schema, { $refStrategy: 'none' }) as Tool['inputSchema'];
}

export const SEMANTIC_TOOLS: Tool[] = [
  {
    name: 'semantic_search',
    description: 'Concept-based search via Smart Connections. Finds conceptually related content using meaning/context similarity rather than keyword matching.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language concept query.',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 10).',
        },
        threshold: {
          type: 'number',
          description: 'Similarity threshold 0-1 (default: 0.7). Higher = more precise.',
        },
        filters: {
          type: 'object',
          properties: {
            folders: {
              type: 'array',
              items: { type: 'string' },
              description: 'Folder paths to search in.',
            },
            excludeFolders: {
              type: 'array',
              items: { type: 'string' },
              description: 'Folder paths to exclude.',
            },
          },
        },
        vaultId: {
          type: 'string',
          description: 'Optional vault ID (defaults to configured default vault).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_similar_notes',
    description: 'Find notes semantically similar to a given note.',
    inputSchema: toJsonSchema(FindSimilarNotesRequestSchema),
  },
];
