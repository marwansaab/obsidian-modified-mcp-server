import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../../../src/tools/index.js';

const ALL_GRAPH_TOOL_NAMES = [
  'get_vault_stats',
  'get_vault_structure',
  'find_orphan_notes',
  'get_note_connections',
  'find_path_between_notes',
  'get_most_connected_notes',
  'detect_note_clusters',
] as const;

const PER_NOTE_TOOL_NAMES = ['get_note_connections', 'find_path_between_notes'] as const;

describe('graph tool registration (FR-008, FR-012)', () => {
  for (const name of ALL_GRAPH_TOOL_NAMES) {
    describe(name, () => {
      const entry = ALL_TOOLS.find((t) => t.name === name);

      it('appears in ALL_TOOLS', () => {
        expect(entry).toBeDefined();
      });

      it('exposes a JSON Schema inputSchema with type: "object"', () => {
        expect(entry?.inputSchema).toBeDefined();
        expect(entry?.inputSchema.type).toBe('object');
      });

      it('description states the OBSIDIAN_VAULT_PATH precondition (FR-008)', () => {
        expect(entry?.description ?? '').toContain('OBSIDIAN_VAULT_PATH');
      });
    });
  }

  for (const name of PER_NOTE_TOOL_NAMES) {
    describe(`${name} (per-note FR-012 contract)`, () => {
      const entry = ALL_TOOLS.find((t) => t.name === name);

      it('description names the not-found contract', () => {
        expect(entry?.description ?? '').toContain('note not found:');
      });

      it('description disambiguates not-found from "found but no connections"', () => {
        expect(entry?.description ?? '').toContain("distinct from 'found but no connections'");
      });
    });
  }
});
