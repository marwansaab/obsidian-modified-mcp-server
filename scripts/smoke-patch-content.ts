/**
 * Smoke test for the patch_content tool against a real Obsidian instance.
 *
 * Required env vars:
 *   OBSIDIAN_API_KEY       — from Local REST API plugin settings (or data.json)
 *
 * Optional env vars (defaults match Local REST API plugin defaults):
 *   OBSIDIAN_HOST          — default 127.0.0.1
 *   OBSIDIAN_PORT          — default 27124
 *   OBSIDIAN_PROTOCOL      — default https
 *   OBSIDIAN_VERIFY_SSL    — default false (Local REST API uses self-signed cert)
 *   SMOKE_TEST_FILEPATH    — default _smoke-patch-content.md
 *
 * Run with:
 *   npx tsx scripts/smoke-patch-content.ts
 *
 * This is a one-shot script — feel free to delete after T019 is checked off.
 */

import { ObsidianRestService } from '../src/services/obsidian-rest.js';
import { handlePatchContent } from '../src/tools/patch-content/handler.js';

import type { VaultConfig } from '../src/types.js';

const FILEPATH = process.env.SMOKE_TEST_FILEPATH ?? '_smoke-patch-content.md';

const NOTE_INITIAL_CONTENT = [
  '# Weekly Review',
  '',
  '## Action Items',
  '',
  '- pre-existing item',
  '',
].join('\n');

function buildVault(): VaultConfig {
  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!apiKey) {
    throw new Error('OBSIDIAN_API_KEY environment variable is required');
  }
  const protocol = process.env.OBSIDIAN_PROTOCOL?.toLowerCase() === 'http' ? 'http' : 'https';
  return {
    id: 'smoke',
    apiKey,
    host: process.env.OBSIDIAN_HOST ?? '127.0.0.1',
    port: parseInt(process.env.OBSIDIAN_PORT ?? '27124', 10),
    protocol,
    verifySsl: process.env.OBSIDIAN_VERIFY_SSL === 'true',
  };
}

type CheckResult = { name: string; ok: boolean; detail: string };

function pass(name: string, detail: string): CheckResult {
  return { name, ok: true, detail };
}
function fail(name: string, detail: string): CheckResult {
  return { name, ok: false, detail };
}

async function main(): Promise<void> {
  const vault = buildVault();
  const rest = new ObsidianRestService(vault);

  const baseValid = {
    filepath: FILEPATH,
    operation: 'append' as const,
    targetType: 'heading' as const,
    content: '- smoke test entry',
  };

  console.log(`[smoke] target: ${vault.protocol}://${vault.host}:${vault.port}`);
  console.log(`[smoke] file:   ${FILEPATH}`);
  console.log('');

  const results: CheckResult[] = [];

  // Setup — overwrite the test note with a known structure
  try {
    await rest.putContent(FILEPATH, NOTE_INITIAL_CONTENT);
    results.push(pass('setup', `wrote ${FILEPATH} with H1::H2 structure`));
  } catch (e) {
    results.push(fail('setup', `putContent failed: ${(e as Error).message}`));
    printAndExit(results);
  }

  // Test 1 — valid heading path → expect success and the bullet to appear
  try {
    const result = await handlePatchContent(
      { ...baseValid, target: 'Weekly Review::Action Items' },
      rest
    );
    const text = result.content?.[0] && 'text' in result.content[0] ? result.content[0].text : '';
    if (result.isError) {
      results.push(fail('T1 valid heading patch', `unexpectedly returned isError: ${text}`));
    } else if (text !== 'Content patched successfully') {
      results.push(fail('T1 valid heading patch', `unexpected response text: ${text}`));
    } else {
      // Verify the bullet actually landed under "Action Items"
      const after = await rest.getFileContents(FILEPATH);
      const actionItemsSection = after.split(/^##\s+/m).find((s) => s.startsWith('Action Items'));
      if (!actionItemsSection || !actionItemsSection.includes('- smoke test entry')) {
        results.push(
          fail(
            'T1 valid heading patch',
            'success returned but new bullet not found under Action Items'
          )
        );
      } else {
        results.push(pass('T1 valid heading patch', 'bullet appended under Action Items'));
      }
    }
  } catch (e) {
    results.push(fail('T1 valid heading patch', `threw: ${(e as Error).message}`));
  }

  // Test 2 — bare target → expect rejection with the rule message; verify the
  // file did not gain a second smoke bullet (proving no upstream call had any
  // effect).
  let beforeBareCall = '';
  try {
    beforeBareCall = await rest.getFileContents(FILEPATH);
  } catch (e) {
    results.push(fail('T2 setup', `getFileContents failed: ${(e as Error).message}`));
  }

  try {
    await handlePatchContent({ ...baseValid, target: 'Action Items' }, rest);
    results.push(fail('T2 bare-target rejection', 'expected throw, but call resolved'));
  } catch (e) {
    const msg = (e as Error).message;
    const hasRule = /full H1::H2.*path/.test(msg);
    const hasReceived = msg.includes('received: "Action Items"');
    const hasExample = msg.includes('e.g.,');

    let afterBareCall = '';
    try {
      afterBareCall = await rest.getFileContents(FILEPATH);
    } catch {
      /* ignore */
    }
    const fileUnchanged = beforeBareCall === afterBareCall;

    if (hasRule && hasReceived && hasExample && fileUnchanged) {
      results.push(
        pass(
          'T2 bare-target rejection',
          'rejected with all 3 message components; file unchanged (no upstream effect)'
        )
      );
    } else {
      const reasons = [
        hasRule ? null : 'missing rule phrase',
        hasReceived ? null : 'missing received: "..." substring',
        hasExample ? null : 'missing e.g., substring',
        fileUnchanged ? null : 'file changed despite rejection (validator did NOT run before HTTP)',
      ].filter(Boolean);
      results.push(fail('T2 bare-target rejection', reasons.join('; ')));
    }
  }

  // Test 3 — valid path that the upstream cannot resolve → expect upstream
  // error surfaced with status code and message (Constitution Principle IV).
  try {
    await handlePatchContent(
      { ...baseValid, target: 'Weekly Review::Nonexistent Heading' },
      rest
    );
    results.push(
      fail('T3 upstream-error propagation', 'expected throw on unknown heading, but call resolved')
    );
  } catch (e) {
    const msg = (e as Error).message;
    if (/Obsidian API Error\s+\S+/.test(msg)) {
      results.push(
        pass('T3 upstream-error propagation', `surfaced upstream error: ${truncate(msg, 120)}`)
      );
    } else {
      results.push(
        fail(
          'T3 upstream-error propagation',
          `unexpected error shape (no "Obsidian API Error" prefix): ${msg}`
        )
      );
    }
  }

  printAndExit(results);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function printAndExit(results: CheckResult[]): never {
  console.log('');
  console.log('--- smoke test results ---');
  let failed = 0;
  for (const r of results) {
    const tag = r.ok ? 'PASS' : 'FAIL';
    if (!r.ok) failed += 1;
    console.log(`  [${tag}] ${r.name} — ${r.detail}`);
  }
  console.log('');
  console.log(`${results.length} checks; ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('[smoke] unexpected error:', e);
  process.exit(2);
});
