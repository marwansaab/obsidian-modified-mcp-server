import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import {
  assertValidDetectNoteClustersRequest,
  assertValidFindOrphanNotesRequest,
  assertValidFindPathBetweenNotesRequest,
  assertValidGetMostConnectedNotesRequest,
  assertValidGetNoteConnectionsRequest,
  assertValidGetVaultStatsRequest,
  assertValidGetVaultStructureRequest,
} from '../../../src/tools/graph/schemas.js';

describe('graph schema validators (Constitution Principle II)', () => {
  describe('happy paths return typed objects', () => {
    it('get_vault_stats accepts {} and {} with vaultId', () => {
      expect(assertValidGetVaultStatsRequest({})).toEqual({});
      expect(assertValidGetVaultStatsRequest({ vaultId: 'work' })).toEqual({ vaultId: 'work' });
    });

    it('get_vault_structure accepts maxDepth + includeFiles', () => {
      const out = assertValidGetVaultStructureRequest({ maxDepth: 3, includeFiles: true });
      expect(out).toEqual({ maxDepth: 3, includeFiles: true });
    });

    it('find_orphan_notes accepts includeBacklinks', () => {
      expect(assertValidFindOrphanNotesRequest({ includeBacklinks: false })).toEqual({
        includeBacklinks: false,
      });
    });

    it('get_note_connections accepts a filepath', () => {
      const out = assertValidGetNoteConnectionsRequest({ filepath: 'a.md' });
      expect(out.filepath).toBe('a.md');
    });

    it('find_path_between_notes accepts source + target', () => {
      const out = assertValidFindPathBetweenNotesRequest({ source: 'a.md', target: 'b.md' });
      expect(out).toMatchObject({ source: 'a.md', target: 'b.md' });
    });

    it('get_most_connected_notes accepts limit + metric', () => {
      const out = assertValidGetMostConnectedNotesRequest({ limit: 5, metric: 'pagerank' });
      expect(out).toEqual({ limit: 5, metric: 'pagerank' });
    });

    it('detect_note_clusters accepts minClusterSize', () => {
      expect(assertValidDetectNoteClustersRequest({ minClusterSize: 4 })).toEqual({
        minClusterSize: 4,
      });
    });
  });

  describe('validation-failure paths throw ZodError with the field path', () => {
    it('get_vault_stats: vaultId of wrong type', () => {
      try {
        assertValidGetVaultStatsRequest({ vaultId: 42 });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ZodError);
        expect((err as ZodError).issues[0].path).toContain('vaultId');
      }
    });

    it('get_vault_structure: negative maxDepth', () => {
      try {
        assertValidGetVaultStructureRequest({ maxDepth: -1 });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ZodError);
        expect((err as ZodError).issues[0].path).toContain('maxDepth');
      }
    });

    it('find_orphan_notes: includeBacklinks of wrong type', () => {
      try {
        assertValidFindOrphanNotesRequest({ includeBacklinks: 'yes' });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ZodError);
        expect((err as ZodError).issues[0].path).toContain('includeBacklinks');
      }
    });

    it('get_note_connections: missing filepath', () => {
      try {
        assertValidGetNoteConnectionsRequest({});
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ZodError);
        expect((err as ZodError).issues[0].path).toContain('filepath');
      }
    });

    it('find_path_between_notes: missing source', () => {
      try {
        assertValidFindPathBetweenNotesRequest({ target: 'b.md' });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ZodError);
        expect((err as ZodError).issues[0].path).toContain('source');
      }
    });

    it('find_path_between_notes: missing target', () => {
      try {
        assertValidFindPathBetweenNotesRequest({ source: 'a.md' });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ZodError);
        expect((err as ZodError).issues[0].path).toContain('target');
      }
    });

    it('get_most_connected_notes: invalid metric enum', () => {
      try {
        assertValidGetMostConnectedNotesRequest({ metric: 'centrality' });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ZodError);
        expect((err as ZodError).issues[0].path).toContain('metric');
      }
    });

    it('detect_note_clusters: minClusterSize of zero', () => {
      try {
        assertValidDetectNoteClustersRequest({ minClusterSize: 0 });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ZodError);
        expect((err as ZodError).issues[0].path).toContain('minClusterSize');
      }
    });
  });
});
