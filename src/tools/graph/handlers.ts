/**
 * Graph tool handlers.
 *
 * Each handler is a thin wrapper that:
 *   1. validates `args` at the boundary via the matching `assertValid*Request` (Principle III)
 *   2. delegates to the corresponding `GraphService` method
 *   3. for aggregation tools, wraps the result in an `AggregationEnvelope<T>`
 *      using `service.getLastSkipped()` and `service.getLastSkippedPaths().slice(0, 50)` (FR-011)
 *   4. for per-note tools, decorates `note not found:` errors with ` (vault: <id>)`
 *      when the validated args carried an explicit `vaultId` (FR-012, R5)
 *   5. returns `{ content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] }`
 */

import {
  assertValidDetectNoteClustersRequest,
  assertValidFindOrphanNotesRequest,
  assertValidFindPathBetweenNotesRequest,
  assertValidGetMostConnectedNotesRequest,
  assertValidGetNoteConnectionsRequest,
  assertValidGetVaultStatsRequest,
  assertValidGetVaultStructureRequest,
} from './schemas.js';
import { toOsNativePath } from '../../utils/path-normalisation.js';

import type { GraphService } from '../../services/graph-service.js';
import type { AggregationEnvelope } from '../../types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const SKIPPED_PATHS_CAP = 50;

function envelope<T>(payload: T, service: GraphService): AggregationEnvelope<T> {
  return {
    ...payload,
    skipped: service.getLastSkipped(),
    skippedPaths: service.getLastSkippedPaths().slice(0, SKIPPED_PATHS_CAP),
  };
}

function asJson(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * If `err.message` starts with `note not found:` / `notes not found:` and the
 * caller supplied an explicit vaultId, append ` (vault: <id>)` (FR-012).
 * Otherwise rethrow unchanged.
 */
function rethrowWithVaultSuffix(err: unknown, vaultId: string | undefined): never {
  if (err instanceof Error && vaultId) {
    if (err.message.startsWith('note not found:') || err.message.startsWith('notes not found:')) {
      throw new Error(`${err.message} (vault: ${vaultId})`);
    }
  }
  throw err;
}

export async function handleGetVaultStats(
  args: Record<string, unknown>,
  service: GraphService
): Promise<CallToolResult> {
  assertValidGetVaultStatsRequest(args);
  const stats = await service.getVaultStats();
  return asJson(envelope(stats, service));
}

export async function handleGetVaultStructure(
  args: Record<string, unknown>,
  service: GraphService
): Promise<CallToolResult> {
  const req = assertValidGetVaultStructureRequest(args);
  const tree = await service.getVaultStructure(req.maxDepth, req.includeFiles);
  return asJson(envelope({ tree }, service));
}

export async function handleFindOrphanNotes(
  args: Record<string, unknown>,
  service: GraphService
): Promise<CallToolResult> {
  const req = assertValidFindOrphanNotesRequest(args);
  const orphans = await service.findOrphanNotes(req.includeBacklinks);
  return asJson(envelope({ orphans }, service));
}

export async function handleGetNoteConnections(
  args: Record<string, unknown>,
  service: GraphService
): Promise<CallToolResult> {
  const req = assertValidGetNoteConnectionsRequest(args);
  const filepath = toOsNativePath(req.filepath);
  try {
    const connections = await service.getNoteConnections(filepath);
    return asJson(connections);
  } catch (err) {
    rethrowWithVaultSuffix(err, req.vaultId);
  }
}

export async function handleFindPathBetweenNotes(
  args: Record<string, unknown>,
  service: GraphService
): Promise<CallToolResult> {
  const req = assertValidFindPathBetweenNotesRequest(args);
  const source = toOsNativePath(req.source);
  const target = toOsNativePath(req.target);
  try {
    const path = await service.findPathBetweenNotes(source, target, req.maxDepth);
    return asJson({ path });
  } catch (err) {
    rethrowWithVaultSuffix(err, req.vaultId);
  }
}

export async function handleGetMostConnectedNotes(
  args: Record<string, unknown>,
  service: GraphService
): Promise<CallToolResult> {
  const req = assertValidGetMostConnectedNotesRequest(args);
  const notes = await service.getMostConnectedNotes(req.limit, req.metric);
  return asJson(envelope({ notes }, service));
}

export async function handleDetectNoteClusters(
  args: Record<string, unknown>,
  service: GraphService
): Promise<CallToolResult> {
  const req = assertValidDetectNoteClustersRequest(args);
  const clusters = await service.detectNoteClusters(req.minClusterSize);
  return asJson(envelope({ clusters }, service));
}
