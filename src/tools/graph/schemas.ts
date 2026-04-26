/**
 * Zod schemas for the seven graph tools.
 *
 * Single source of truth for both runtime validation (handlers) and the
 * MCP `inputSchema` (derived via `zod-to-json-schema` in ./tool.ts) so
 * the published schema and the validator cannot drift apart
 * (Constitution Principle III).
 */

import { z } from 'zod';

export const GetVaultStatsRequestSchema = z.object({
  vaultId: z
    .string()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export const GetVaultStructureRequestSchema = z.object({
  maxDepth: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Maximum folder depth to return (default: unlimited).'),
  includeFiles: z
    .boolean()
    .optional()
    .describe('Include files in the tree, not just folders (default: false).'),
  vaultId: z
    .string()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export const FindOrphanNotesRequestSchema = z.object({
  includeBacklinks: z
    .boolean()
    .optional()
    .describe('Consider backlinks when determining orphan status (default: true).'),
  vaultId: z
    .string()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export const GetNoteConnectionsRequestSchema = z.object({
  filepath: z
    .string()
    .min(1, 'filepath must be a non-empty string')
    .describe('Path to the note (relative to vault root).'),
  depth: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('How many levels of connections to traverse (default: 1).'),
  vaultId: z
    .string()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export const FindPathBetweenNotesRequestSchema = z.object({
  source: z
    .string()
    .min(1, 'source must be a non-empty string')
    .describe('Source note path.'),
  target: z
    .string()
    .min(1, 'target must be a non-empty string')
    .describe('Target note path.'),
  maxDepth: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum path length to search (default: 5).'),
  vaultId: z
    .string()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export const GetMostConnectedNotesRequestSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Number of notes to return (default: 10).'),
  metric: z
    .enum(['links', 'backlinks', 'pagerank'])
    .optional()
    .describe('Metric to rank by (default: backlinks).'),
  vaultId: z
    .string()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export const DetectNoteClustersRequestSchema = z.object({
  minClusterSize: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Minimum notes per cluster (default: 3).'),
  vaultId: z
    .string()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export type GetVaultStatsRequest = z.infer<typeof GetVaultStatsRequestSchema>;
export type GetVaultStructureRequest = z.infer<typeof GetVaultStructureRequestSchema>;
export type FindOrphanNotesRequest = z.infer<typeof FindOrphanNotesRequestSchema>;
export type GetNoteConnectionsRequest = z.infer<typeof GetNoteConnectionsRequestSchema>;
export type FindPathBetweenNotesRequest = z.infer<typeof FindPathBetweenNotesRequestSchema>;
export type GetMostConnectedNotesRequest = z.infer<typeof GetMostConnectedNotesRequestSchema>;
export type DetectNoteClustersRequest = z.infer<typeof DetectNoteClustersRequestSchema>;

export function assertValidGetVaultStatsRequest(args: unknown): GetVaultStatsRequest {
  return GetVaultStatsRequestSchema.parse(args);
}

export function assertValidGetVaultStructureRequest(args: unknown): GetVaultStructureRequest {
  return GetVaultStructureRequestSchema.parse(args);
}

export function assertValidFindOrphanNotesRequest(args: unknown): FindOrphanNotesRequest {
  return FindOrphanNotesRequestSchema.parse(args);
}

export function assertValidGetNoteConnectionsRequest(args: unknown): GetNoteConnectionsRequest {
  return GetNoteConnectionsRequestSchema.parse(args);
}

export function assertValidFindPathBetweenNotesRequest(args: unknown): FindPathBetweenNotesRequest {
  return FindPathBetweenNotesRequestSchema.parse(args);
}

export function assertValidGetMostConnectedNotesRequest(args: unknown): GetMostConnectedNotesRequest {
  return GetMostConnectedNotesRequestSchema.parse(args);
}

export function assertValidDetectNoteClustersRequest(args: unknown): DetectNoteClustersRequest {
  return DetectNoteClustersRequestSchema.parse(args);
}
