import { describe, it, expect } from 'vitest';

import { ALL_TOOLS } from '../../../src/tools/index.js';

describe('patch_content tool registration (C12)', () => {
  it('appears in ALL_TOOLS', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'patch_content');
    expect(entry).toBeDefined();
  });

  it('description names all three testable phrases (FR-001)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'patch_content');
    expect(entry).toBeDefined();
    const description = (entry?.description ?? '').toLowerCase();

    // (i) full-path requirement
    expect(description).toContain('h1::h2');
    // (ii) top-level-unreachable note
    expect(description).toContain('top-level');
    // (iii) literal-:: unreachable note — distinguishable from (i) because
    // a bare "::" substring would be trivially satisfied by H1::H2.
    expect(description).toContain('literal text contains');
  });

  it('exposes a JSON Schema inputSchema (derived from zod)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'patch_content');
    expect(entry?.inputSchema).toBeDefined();
    expect(entry?.inputSchema.type).toBe('object');
    const properties = (entry?.inputSchema as { properties?: Record<string, unknown> }).properties;
    expect(properties).toBeDefined();
    expect(properties).toHaveProperty('filepath');
    expect(properties).toHaveProperty('operation');
    expect(properties).toHaveProperty('targetType');
    expect(properties).toHaveProperty('target');
    expect(properties).toHaveProperty('content');
    expect(properties).toHaveProperty('vaultId');
  });
});
