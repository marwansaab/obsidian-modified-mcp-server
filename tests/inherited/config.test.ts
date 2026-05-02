/**
 * AS-IS characterization tests for `src/config.ts` (T019).
 *
 * Encodes the env-var loading matrix as the contract:
 *  - OBSIDIAN_API_KEY (single-vault path)
 *  - OBSIDIAN_VAULTS_JSON (multi-vault inline JSON, array form and object form)
 *  - OBSIDIAN_VAULTS_FILE (multi-vault from file)
 *  - Missing apiKey raises "Vault ... missing apiKey" or "OBSIDIAN_API_KEY ... required"
 *  - OBSIDIAN_DEFAULT_VAULT — set / unset / pointing at non-existent vault
 *  - OBSIDIAN_PROTOCOL=http vs default https
 *  - OBSIDIAN_VERIFY_SSL=true vs other-than-true (false default)
 *  - getConfig() singleton + resetConfig()
 *  - normalizeVaultConfig fallback paths via inline JSON entries with
 *    missing/partial fields
 *
 * No HTTP — no `nock`.
 */

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getConfig, loadConfig, resetConfig } from '../../src/config.js';

describe('config.ts — AS-IS characterization', () => {
  const ENV_KEYS = [
    'OBSIDIAN_VAULTS_FILE',
    'OBSIDIAN_VAULTS_JSON',
    'OBSIDIAN_API_KEY',
    'OBSIDIAN_HOST',
    'OBSIDIAN_PORT',
    'OBSIDIAN_PROTOCOL',
    'OBSIDIAN_VAULT_PATH',
    'OBSIDIAN_VERIFY_SSL',
    'OBSIDIAN_DEFAULT_VAULT',
    'SMART_CONNECTIONS_PORT',
    'GRAPH_CACHE_TTL',
  ] as const;

  beforeEach(() => {
    // Vitest's vi.stubEnv only affects keys we explicitly stub. To ensure
    // tests don't see real environment values, clear all relevant keys via
    // stubbing them to undefined first; each test then sets the keys it
    // needs.
    for (const k of ENV_KEYS) {
      vi.stubEnv(k, undefined as unknown as string);
    }
    resetConfig();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfig();
  });

  describe('OBSIDIAN_API_KEY (single-vault) path', () => {
    it('loads a default vault from API_KEY only (other env vars use built-in defaults)', () => {
      vi.stubEnv('OBSIDIAN_API_KEY', 'k');
      const cfg = loadConfig();
      expect(cfg.defaultVaultId).toBe('default');
      expect(cfg.vaults).toEqual({
        default: {
          id: 'default',
          apiKey: 'k',
          host: '127.0.0.1',
          port: 27124,
          protocol: 'https',
          vaultPath: undefined,
          smartConnectionsPort: undefined,
          verifySsl: false,
        },
      });
      expect(cfg.graphCacheTtl).toBe(300);
      expect(cfg.verifySsl).toBe(false);
    });

    it('parses OBSIDIAN_PORT as int and respects OBSIDIAN_HOST / OBSIDIAN_VAULT_PATH', () => {
      vi.stubEnv('OBSIDIAN_API_KEY', 'k');
      vi.stubEnv('OBSIDIAN_HOST', 'example.invalid');
      vi.stubEnv('OBSIDIAN_PORT', '8080');
      vi.stubEnv('OBSIDIAN_VAULT_PATH', '/vault/path');
      const cfg = loadConfig();
      expect(cfg.vaults.default.host).toBe('example.invalid');
      expect(cfg.vaults.default.port).toBe(8080);
      expect(cfg.vaults.default.vaultPath).toBe('/vault/path');
    });

    it('OBSIDIAN_PROTOCOL=http selects http, anything else selects https (case-insensitive)', () => {
      vi.stubEnv('OBSIDIAN_API_KEY', 'k');
      vi.stubEnv('OBSIDIAN_PROTOCOL', 'HTTP');
      expect(loadConfig().vaults.default.protocol).toBe('http');

      resetConfig();
      vi.stubEnv('OBSIDIAN_PROTOCOL', 'https');
      expect(loadConfig().vaults.default.protocol).toBe('https');

      resetConfig();
      vi.stubEnv('OBSIDIAN_PROTOCOL', 'gopher');
      expect(loadConfig().vaults.default.protocol).toBe('https');
    });

    it('OBSIDIAN_VERIFY_SSL=true sets verifySsl to true', () => {
      vi.stubEnv('OBSIDIAN_API_KEY', 'k');
      vi.stubEnv('OBSIDIAN_VERIFY_SSL', 'true');
      const cfg = loadConfig();
      expect(cfg.verifySsl).toBe(true);
      expect(cfg.vaults.default.verifySsl).toBe(true);
    });

    it('OBSIDIAN_VERIFY_SSL anything-not-equal-to-"true" is treated as false', () => {
      vi.stubEnv('OBSIDIAN_API_KEY', 'k');
      vi.stubEnv('OBSIDIAN_VERIFY_SSL', 'TRUE'); // case-sensitive: not strict-equal "true"
      const cfg = loadConfig();
      expect(cfg.verifySsl).toBe(false);
    });

    it('SMART_CONNECTIONS_PORT is parsed as int', () => {
      vi.stubEnv('OBSIDIAN_API_KEY', 'k');
      vi.stubEnv('SMART_CONNECTIONS_PORT', '37121');
      expect(loadConfig().vaults.default.smartConnectionsPort).toBe(37121);
    });

    it('SMART_CONNECTIONS_PORT absent → undefined', () => {
      vi.stubEnv('OBSIDIAN_API_KEY', 'k');
      expect(loadConfig().vaults.default.smartConnectionsPort).toBeUndefined();
    });

    it('GRAPH_CACHE_TTL is parsed as int (defaults to 300)', () => {
      vi.stubEnv('OBSIDIAN_API_KEY', 'k');
      vi.stubEnv('GRAPH_CACHE_TTL', '60');
      expect(loadConfig().graphCacheTtl).toBe(60);
    });
  });

  describe('missing apiKey error', () => {
    it('throws when OBSIDIAN_API_KEY / OBSIDIAN_VAULTS_JSON / OBSIDIAN_VAULTS_FILE all unset', () => {
      expect(() => loadConfig()).toThrow(
        /OBSIDIAN_API_KEY environment variable is required/
      );
    });
  });

  describe('OBSIDIAN_VAULTS_JSON (multi-vault inline)', () => {
    it('accepts an array form and registers each vault by id', () => {
      vi.stubEnv(
        'OBSIDIAN_VAULTS_JSON',
        JSON.stringify([
          { id: 'work', apiKey: 'kw', host: 'w' },
          { id: 'home', apiKey: 'kh', port: 9999 },
        ])
      );
      const cfg = loadConfig();
      expect(Object.keys(cfg.vaults).sort()).toEqual(['home', 'work']);
      expect(cfg.vaults.work.host).toBe('w');
      expect(cfg.vaults.home.port).toBe(9999);
    });

    it('accepts an object form (entries via Object.values) and registers each vault', () => {
      vi.stubEnv(
        'OBSIDIAN_VAULTS_JSON',
        JSON.stringify({
          a: { id: 'a', apiKey: 'ka' },
          b: { id: 'b', apiKey: 'kb' },
        })
      );
      const cfg = loadConfig();
      expect(Object.keys(cfg.vaults).sort()).toEqual(['a', 'b']);
    });

    it('falls back to "vault-<index>" id when entry omits id', () => {
      vi.stubEnv('OBSIDIAN_VAULTS_JSON', JSON.stringify([{ apiKey: 'ka' }]));
      const cfg = loadConfig();
      expect(Object.keys(cfg.vaults)).toEqual(['vault-0']);
    });

    it('throws "missing apiKey" when an entry omits apiKey', () => {
      vi.stubEnv('OBSIDIAN_VAULTS_JSON', JSON.stringify([{ id: 'x' }]));
      expect(() => loadConfig()).toThrow(/Vault "x" is missing apiKey/);
    });

    it('throws "must describe at least one vault" on empty array', () => {
      vi.stubEnv('OBSIDIAN_VAULTS_JSON', '[]');
      expect(() => loadConfig()).toThrow(
        /OBSIDIAN_VAULTS_JSON must describe at least one vault/
      );
    });

    it('throws "Failed to parse" on malformed JSON', () => {
      vi.stubEnv('OBSIDIAN_VAULTS_JSON', '{ not json');
      expect(() => loadConfig()).toThrow(/Failed to parse OBSIDIAN_VAULTS_JSON/);
    });

    it('respects partial fields: applies fork-defaults for host/port/protocol/verifySsl', () => {
      vi.stubEnv(
        'OBSIDIAN_VAULTS_JSON',
        JSON.stringify([{ id: 'x', apiKey: 'k' }])
      );
      const cfg = loadConfig();
      const v = cfg.vaults.x;
      expect(v.host).toBe('127.0.0.1');
      expect(v.port).toBe(27124);
      expect(v.protocol).toBe('https');
      expect(v.verifySsl).toBe(false);
    });
  });

  describe('OBSIDIAN_VAULTS_FILE (multi-vault from disk)', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'spec009-config-'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('reads JSON from a file path and registers vaults', () => {
      const file = join(tmpDir, 'vaults.json');
      writeFileSync(file, JSON.stringify([{ id: 'fileA', apiKey: 'kf' }]), 'utf-8');
      vi.stubEnv('OBSIDIAN_VAULTS_FILE', file);
      const cfg = loadConfig();
      expect(cfg.vaults.fileA.apiKey).toBe('kf');
    });

    it('takes precedence over OBSIDIAN_VAULTS_JSON', () => {
      const file = join(tmpDir, 'vaults.json');
      writeFileSync(file, JSON.stringify([{ id: 'fromFile', apiKey: 'kf' }]), 'utf-8');
      vi.stubEnv('OBSIDIAN_VAULTS_FILE', file);
      vi.stubEnv('OBSIDIAN_VAULTS_JSON', JSON.stringify([{ id: 'fromInline', apiKey: 'ki' }]));
      const cfg = loadConfig();
      expect(Object.keys(cfg.vaults)).toEqual(['fromFile']);
    });
  });

  describe('OBSIDIAN_DEFAULT_VAULT', () => {
    it('uses the requested default when present', () => {
      vi.stubEnv(
        'OBSIDIAN_VAULTS_JSON',
        JSON.stringify([
          { id: 'a', apiKey: 'ka' },
          { id: 'b', apiKey: 'kb' },
        ])
      );
      vi.stubEnv('OBSIDIAN_DEFAULT_VAULT', 'b');
      expect(loadConfig().defaultVaultId).toBe('b');
    });

    it('throws when OBSIDIAN_DEFAULT_VAULT names a non-existent vault id', () => {
      vi.stubEnv(
        'OBSIDIAN_VAULTS_JSON',
        JSON.stringify([{ id: 'a', apiKey: 'ka' }])
      );
      vi.stubEnv('OBSIDIAN_DEFAULT_VAULT', 'nonexistent');
      expect(() => loadConfig()).toThrow(
        /OBSIDIAN_DEFAULT_VAULT "nonexistent" not found/
      );
    });

    it('falls back to the well-known "default" id when present and OBSIDIAN_DEFAULT_VAULT is unset', () => {
      vi.stubEnv(
        'OBSIDIAN_VAULTS_JSON',
        JSON.stringify([
          { id: 'a', apiKey: 'ka' },
          { id: 'default', apiKey: 'kd' },
          { id: 'z', apiKey: 'kz' },
        ])
      );
      expect(loadConfig().defaultVaultId).toBe('default');
    });

    it('falls back to the first registered vault id when no "default" id exists', () => {
      vi.stubEnv(
        'OBSIDIAN_VAULTS_JSON',
        JSON.stringify([
          { id: 'first', apiKey: 'k1' },
          { id: 'second', apiKey: 'k2' },
        ])
      );
      expect(loadConfig().defaultVaultId).toBe('first');
    });
  });

  describe('getConfig singleton + resetConfig', () => {
    it('caches the loaded config and returns the same instance until resetConfig', () => {
      vi.stubEnv('OBSIDIAN_API_KEY', 'k');
      const a = getConfig();
      const b = getConfig();
      expect(b).toBe(a);

      resetConfig();
      vi.stubEnv('OBSIDIAN_API_KEY', 'k2');
      const c = getConfig();
      expect(c).not.toBe(a);
      expect(c.vaults.default.apiKey).toBe('k2');
    });
  });
});
