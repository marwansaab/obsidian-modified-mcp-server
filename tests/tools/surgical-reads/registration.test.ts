import { describe, it, expect } from 'vitest';

import { ALL_TOOLS } from '../../../src/tools/index.js';

describe('get_heading_contents tool registration (HR)', () => {
  it('appears in ALL_TOOLS', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'get_heading_contents');
    expect(entry).toBeDefined();
  });

  it('description names all five testable phrases (FR-001)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'get_heading_contents');
    expect(entry).toBeDefined();
    const description = (entry?.description ?? '').toLowerCase();

    // (i) full-path requirement
    expect(description).toContain('h1::h2');
    // (ii) top-level-unreachable note
    expect(description).toContain('top-level');
    // (iii) literal-:: unreachable note (distinguishable from (i) because
    // a bare "::" would be trivially satisfied by H1::H2).
    expect(description).toContain('literal text contains');
    // (iv) documented fallback is named in the schema
    expect(description).toContain('get_file_contents');
    // (v) metadata-exclusion clause from clarification Q1
    expect(description).toContain('frontmatter, tags');
  });

  it('exposes a JSON Schema inputSchema (derived from zod)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'get_heading_contents');
    expect(entry?.inputSchema).toBeDefined();
    expect(entry?.inputSchema.type).toBe('object');
    const properties = (entry?.inputSchema as { properties?: Record<string, unknown> })
      .properties;
    expect(properties).toBeDefined();
    expect(properties).toHaveProperty('filepath');
    expect(properties).toHaveProperty('heading');
    expect(properties).toHaveProperty('vaultId');
  });
});

describe('get_frontmatter_field tool registration (FR)', () => {
  it('appears in ALL_TOOLS', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'get_frontmatter_field');
    expect(entry).toBeDefined();
  });

  it('description names all three testable phrases (FR-006)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'get_frontmatter_field');
    expect(entry).toBeDefined();
    const description = (entry?.description ?? '').toLowerCase();

    // (i) typed-value contract from clarification Q2
    expect(description).toContain('original type preserved');
    // (ii) missing-field-as-error contract
    expect(description).toContain('4xx');
    // (iii) all-frontmatter fallback
    expect(description).toContain('get_file_contents');
  });

  it('exposes a JSON Schema inputSchema (derived from zod)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'get_frontmatter_field');
    expect(entry?.inputSchema).toBeDefined();
    expect(entry?.inputSchema.type).toBe('object');
    const properties = (entry?.inputSchema as { properties?: Record<string, unknown> })
      .properties;
    expect(properties).toBeDefined();
    expect(properties).toHaveProperty('filepath');
    expect(properties).toHaveProperty('field');
    expect(properties).toHaveProperty('vaultId');
  });
});
