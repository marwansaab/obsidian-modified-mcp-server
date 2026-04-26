import { describe, expect, it, vi } from 'vitest';

import {
  handleFindPathBetweenNotes,
  handleGetNoteConnections,
} from '../../../src/tools/graph/handlers.js';

import type { GraphService } from '../../../src/services/graph-service.js';
import type { NoteConnections } from '../../../src/types.js';

describe('handleGetNoteConnections (Constitution Principle II + FR-012)', () => {
  it('happy path: forwards filepath to the service and returns the connections payload', async () => {
    const connections: NoteConnections = {
      filepath: 'Daily/2026-04-26.md',
      outgoingLinks: ['Projects/Inbox.md'],
      backlinks: ['Index.md'],
      tags: ['daily'],
    };
    const getNoteConnections = vi.fn().mockResolvedValue(connections);
    const service = { getNoteConnections } as unknown as GraphService;

    const result = await handleGetNoteConnections({ filepath: 'Daily/2026-04-26.md' }, service);

    expect(getNoteConnections).toHaveBeenCalledTimes(1);
    expect(getNoteConnections).toHaveBeenCalledWith('Daily/2026-04-26.md');

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toEqual(connections);
  });

  it('appends "(vault: <id>)" when an explicit vaultId is supplied and the note is missing', async () => {
    const getNoteConnections = vi.fn().mockRejectedValue(new Error('note not found: missing.md'));
    const service = { getNoteConnections } as unknown as GraphService;

    await expect(
      handleGetNoteConnections({ filepath: 'missing.md', vaultId: 'work' }, service)
    ).rejects.toThrow('note not found: missing.md (vault: work)');
  });

  it('does not append vault suffix when no vaultId is supplied', async () => {
    const getNoteConnections = vi.fn().mockRejectedValue(new Error('note not found: missing.md'));
    const service = { getNoteConnections } as unknown as GraphService;

    await expect(
      handleGetNoteConnections({ filepath: 'missing.md' }, service)
    ).rejects.toThrow(/^note not found: missing\.md$/);
  });
});

describe('handleFindPathBetweenNotes (Constitution Principle II + FR-012)', () => {
  it('happy path: returns the resolved path array', async () => {
    const findPathBetweenNotes = vi.fn().mockResolvedValue(['a.md', 'b.md', 'c.md']);
    const service = { findPathBetweenNotes } as unknown as GraphService;

    const result = await handleFindPathBetweenNotes({ source: 'a.md', target: 'c.md' }, service);

    expect(findPathBetweenNotes).toHaveBeenCalledWith('a.md', 'c.md', undefined);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toEqual({ path: ['a.md', 'b.md', 'c.md'] });
  });

  it('no-path-found: surfaces null path (distinct from a not-found error)', async () => {
    const findPathBetweenNotes = vi.fn().mockResolvedValue(null);
    const service = { findPathBetweenNotes } as unknown as GraphService;

    const result = await handleFindPathBetweenNotes({ source: 'a.md', target: 'c.md' }, service);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toEqual({ path: null });
  });
});
