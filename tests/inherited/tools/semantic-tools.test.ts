/**
 * AS-IS characterization tests for `src/tools/semantic-tools.ts` (T015).
 *
 * The fork-authored `tests/tools/semantic-tools/` already covers:
 *   - `assertValidFindSimilarNotesRequest` (schema.test.ts)
 *   - the `find_similar_notes` dispatcher arm (find-similar-handler.test.ts)
 *   - the registration of `find_similar_notes` (registration.test.ts)
 *
 * Per the spec edge case "Existing feature-spec tests already cover a
 * tool fully" + the FR-009 don't-duplicate rule, those paths are NOT
 * re-tested here.
 *
 * What this file adds (AS-IS behaviour not exercised by existing tests):
 *   - The `semantic_search` tool is registered in `SEMANTIC_TOOLS` and
 *     therefore appears in `ALL_TOOLS` / `tools/list`, but per the file's
 *     own docstring it is "intentionally still unwired in the dispatcher"
 *     — see specs/006-normalise-graph-paths/research.md R5. The current
 *     observable behaviour is that calling `semantic_search` via the MCP
 *     dispatcher throws "Unknown tool: semantic_search" (i.e., it falls
 *     through to the `default` arm). This file encodes that quirk.
 *   - Sanity assertion on the SEMANTIC_TOOLS metadata (both tool names
 *     present, find_similar_notes has a zod-derived inputSchema).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/config.js', () => ({
  getConfig: () => ({
    defaultVaultId: 'test',
    vaults: {
      test: {
        id: 'test',
        apiKey: 'test-api-key',
        host: 'localhost',
        port: 27123,
        protocol: 'https' as const,
        verifySsl: false,
        smartConnectionsPort: 8765,
      },
    },
    graphCacheTtl: 300,
    verifySsl: false,
  }),
}));

import { ObsidianMCPServer } from '../../../src/index.js';
import { SEMANTIC_TOOLS } from '../../../src/tools/semantic-tools.js';

describe('semantic-tools.ts — AS-IS characterization', () => {
  describe('SEMANTIC_TOOLS registration', () => {
    it('exports both tool definitions in declaration order', () => {
      expect(SEMANTIC_TOOLS.map((t) => t.name)).toEqual([
        'semantic_search',
        'find_similar_notes',
      ]);
    });

    it('semantic_search has a hand-written JSON schema with required:["query"]', () => {
      const tool = SEMANTIC_TOOLS.find((t) => t.name === 'semantic_search');
      expect(tool?.inputSchema?.required).toEqual(['query']);
    });

    it('find_similar_notes has a zod-derived JSON schema', () => {
      const tool = SEMANTIC_TOOLS.find((t) => t.name === 'find_similar_notes');
      // The zod-to-json-schema output places filepath in required and
      // includes per-property descriptions sourced from the zod .describe() calls.
      const properties = tool?.inputSchema?.properties as
        | Record<string, { description?: string }>
        | undefined;
      expect(properties?.filepath).toBeDefined();
      expect(properties?.filepath?.description).toMatch(/Path to the source note/);
      expect(tool?.inputSchema?.required).toContain('filepath');
    });
  });

  describe('semantic_search dispatcher arm (AS-IS: still unwired — falls to default)', () => {
    it('dispatching `semantic_search` through MCP throws "Unknown tool: semantic_search"', async () => {
      const server = new ObsidianMCPServer();
      let captured: unknown;
      try {
        await server.handleToolCall('semantic_search', { query: 'philosophy' });
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).message).toBe('Unknown tool: semantic_search');
    });
  });
});
