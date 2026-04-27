import { sep } from 'node:path';
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
    // Post-specs/006: handler normalises filepath to OS-native before delegating.
    expect(getNoteConnections).toHaveBeenCalledWith(`Daily${sep}2026-04-26.md`);

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

// specs/006-normalise-graph-paths regression tests.
// FR-008 requires both separator forms to produce equivalent results for at
// least one of the three affected tools; covering both index-backed handlers
// here exceeds the spec mandate but matches the per-handler test pattern.

describe('handleGetNoteConnections separator regression (specs/006 FR-001/4/5/6/8)', () => {
  const NESTED_OS_NATIVE = `000-Meta${sep}Vault Identity.md`;
  const NESTED_PAYLOAD: NoteConnections = {
    filepath: NESTED_OS_NATIVE,
    outgoingLinks: [`010-Notes${sep}Reference.md`],
    backlinks: [`Index.md`],
    tags: ['meta'],
  };

  function makeService() {
    const getNoteConnections = vi.fn(async (filepath: string) => {
      if (filepath === NESTED_OS_NATIVE) return NESTED_PAYLOAD;
      if (filepath === 'README.md') {
        return {
          filepath: 'README.md',
          outgoingLinks: [],
          backlinks: [],
          tags: [],
        } satisfies NoteConnections;
      }
      throw new Error(`note not found: ${filepath}`);
    });
    return { service: { getNoteConnections } as unknown as GraphService, getNoteConnections };
  }

  it('forward-slash input on a nested existing file returns the connections payload (FR-001)', async () => {
    const { service, getNoteConnections } = makeService();

    const result = await handleGetNoteConnections(
      { filepath: '000-Meta/Vault Identity.md' },
      service
    );

    expect(getNoteConnections).toHaveBeenCalledWith(NESTED_OS_NATIVE);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toEqual(NESTED_PAYLOAD);
  });

  it('backslash input returns the same payload as forward-slash (FR-004 + FR-008)', async () => {
    const { service: serviceA } = makeService();
    const { service: serviceB } = makeService();

    const forwardResult = await handleGetNoteConnections(
      { filepath: '000-Meta/Vault Identity.md' },
      serviceA
    );
    const backslashResult = await handleGetNoteConnections(
      { filepath: '000-Meta\\Vault Identity.md' },
      serviceB
    );

    const forwardParsed = JSON.parse((forwardResult.content[0] as { text: string }).text);
    const backslashParsed = JSON.parse((backslashResult.content[0] as { text: string }).text);
    expect(backslashParsed).toEqual(forwardParsed);
  });

  it('mixed-separator input resolves to the same indexed entry (FR-005)', async () => {
    const { service, getNoteConnections } = makeService();

    const result = await handleGetNoteConnections(
      { filepath: '000-Meta\\Vault Identity.md' },
      service
    );

    expect(getNoteConnections).toHaveBeenCalledWith(NESTED_OS_NATIVE);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toEqual(NESTED_PAYLOAD);
  });

  it('genuinely missing file with forward-slash input still throws note not found (FR-006)', async () => {
    const { service } = makeService();

    await expect(
      handleGetNoteConnections({ filepath: 'does-not-exist.md' }, service)
    ).rejects.toThrow(/note not found:/);
  });

  it('top-level file with no separator is unchanged by normalisation', async () => {
    const { service, getNoteConnections } = makeService();

    const result = await handleGetNoteConnections({ filepath: 'README.md' }, service);

    expect(getNoteConnections).toHaveBeenCalledWith('README.md');
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.filepath).toBe('README.md');
  });

  it('vault-suffix decoration is preserved when vaultId is supplied and lookup misses', async () => {
    const { service } = makeService();

    await expect(
      handleGetNoteConnections(
        { filepath: 'missing/file.md', vaultId: 'work' },
        service
      )
    ).rejects.toThrow(/note not found: .* \(vault: work\)/);
  });
});

describe('handleFindPathBetweenNotes separator regression (specs/006 FR-002/4/5/6)', () => {
  const SOURCE_OS_NATIVE = `000-Meta${sep}A.md`;
  const TARGET_OS_NATIVE = `010-Notes${sep}B.md`;
  const PATH_PAYLOAD = [SOURCE_OS_NATIVE, `010-Notes${sep}Bridge.md`, TARGET_OS_NATIVE];

  function makeService(returns: { path: typeof PATH_PAYLOAD | null } | { miss: Set<string> }) {
    const findPathBetweenNotes = vi.fn(
      async (source: string, target: string) => {
        if ('miss' in returns) {
          const sourceMissing = returns.miss.has(source);
          const targetMissing = returns.miss.has(target);
          if (sourceMissing && targetMissing) {
            throw new Error(`notes not found: ${source}, ${target}`);
          }
          if (sourceMissing) throw new Error(`note not found: ${source}`);
          if (targetMissing) throw new Error(`note not found: ${target}`);
          return null;
        }
        if (source === SOURCE_OS_NATIVE && target === TARGET_OS_NATIVE) {
          return returns.path;
        }
        return null;
      }
    );
    return {
      service: { findPathBetweenNotes } as unknown as GraphService,
      findPathBetweenNotes,
    };
  }

  it('forward-slash on both args returns the resolved path (FR-002)', async () => {
    const { service, findPathBetweenNotes } = makeService({ path: PATH_PAYLOAD });

    const result = await handleFindPathBetweenNotes(
      { source: '000-Meta/A.md', target: '010-Notes/B.md' },
      service
    );

    expect(findPathBetweenNotes).toHaveBeenCalledWith(
      SOURCE_OS_NATIVE,
      TARGET_OS_NATIVE,
      undefined
    );
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toEqual({ path: PATH_PAYLOAD });
  });

  it('forward-slash on both args with no path returns null (FR-002, never note-not-found)', async () => {
    const { service } = makeService({ path: null });

    const result = await handleFindPathBetweenNotes(
      { source: '000-Meta/A.md', target: '010-Notes/B.md' },
      service
    );

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toEqual({ path: null });
  });

  it('backslash on both args returns equivalent payload (FR-004)', async () => {
    const { service } = makeService({ path: PATH_PAYLOAD });

    const result = await handleFindPathBetweenNotes(
      { source: '000-Meta\\A.md', target: '010-Notes\\B.md' },
      service
    );

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toEqual({ path: PATH_PAYLOAD });
  });

  it('mixed-separator input on each arg independently resolves (FR-005)', async () => {
    const { service, findPathBetweenNotes } = makeService({ path: PATH_PAYLOAD });

    await handleFindPathBetweenNotes(
      { source: '000-Meta\\A.md', target: '010-Notes/B.md' },
      service
    );

    expect(findPathBetweenNotes).toHaveBeenCalledWith(
      SOURCE_OS_NATIVE,
      TARGET_OS_NATIVE,
      undefined
    );
  });

  it('source missing only → error names source (FR-006)', async () => {
    const { service } = makeService({ miss: new Set([SOURCE_OS_NATIVE]) });

    await expect(
      handleFindPathBetweenNotes(
        { source: '000-Meta/A.md', target: '010-Notes/B.md' },
        service
      )
    ).rejects.toThrow(new RegExp(`^note not found: ${SOURCE_OS_NATIVE.replace(/\\/g, '\\\\')}$`));
  });

  it('target missing only → error names target (FR-006)', async () => {
    const { service } = makeService({ miss: new Set([TARGET_OS_NATIVE]) });

    await expect(
      handleFindPathBetweenNotes(
        { source: '000-Meta/A.md', target: '010-Notes/B.md' },
        service
      )
    ).rejects.toThrow(new RegExp(`^note not found: ${TARGET_OS_NATIVE.replace(/\\/g, '\\\\')}$`));
  });

  it('both missing → notes not found references both', async () => {
    const { service } = makeService({
      miss: new Set([SOURCE_OS_NATIVE, TARGET_OS_NATIVE]),
    });

    await expect(
      handleFindPathBetweenNotes(
        { source: '000-Meta/A.md', target: '010-Notes/B.md' },
        service
      )
    ).rejects.toThrow(/^notes not found:/);
  });
});
