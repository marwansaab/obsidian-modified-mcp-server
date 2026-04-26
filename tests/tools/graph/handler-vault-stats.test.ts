import { describe, expect, it, vi } from 'vitest';

import { handleGetVaultStats } from '../../../src/tools/graph/handlers.js';

import type { GraphService } from '../../../src/services/graph-service.js';
import type { VaultStats } from '../../../src/types.js';

function buildStubService(opts: {
  stats: VaultStats;
  skipped: number;
  skippedPaths: string[];
}): GraphService {
  return {
    getVaultStats: vi.fn().mockResolvedValue(opts.stats),
    getLastSkipped: vi.fn().mockReturnValue(opts.skipped),
    getLastSkippedPaths: vi.fn().mockReturnValue(opts.skippedPaths),
  } as unknown as GraphService;
}

describe('handleGetVaultStats (FR-006)', () => {
  it('invokes service.getVaultStats once with no args and wraps result in the envelope', async () => {
    const stats: VaultStats = {
      totalNotes: 42,
      totalLinks: 100,
      orphanCount: 3,
      tagCount: 17,
      clusterCount: 5,
    };
    const service = buildStubService({
      stats,
      skipped: 2,
      skippedPaths: ['bad1.md', 'bad2.md'],
    });

    const result = await handleGetVaultStats({}, service);

    expect(service.getVaultStats).toHaveBeenCalledTimes(1);
    expect((service.getVaultStats as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([]);

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toEqual({
      totalNotes: 42,
      totalLinks: 100,
      orphanCount: 3,
      tagCount: 17,
      clusterCount: 5,
      skipped: 2,
      skippedPaths: ['bad1.md', 'bad2.md'],
    });
  });

  it('truncates skippedPaths to 50 entries while preserving the full skipped count', async () => {
    const sixty = Array.from({ length: 60 }, (_, i) => `bad-${i}.md`);
    const service = buildStubService({
      stats: {
        totalNotes: 0,
        totalLinks: 0,
        orphanCount: 0,
        tagCount: 0,
        clusterCount: 0,
      },
      skipped: 60,
      skippedPaths: sixty,
    });

    const result = await handleGetVaultStats({}, service);
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
      skipped: number;
      skippedPaths: string[];
    };

    expect(parsed.skipped).toBe(60);
    expect(parsed.skippedPaths).toHaveLength(50);
    expect(parsed.skippedPaths[0]).toBe('bad-0.md');
    expect(parsed.skippedPaths[49]).toBe('bad-49.md');
  });
});
