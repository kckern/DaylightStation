// The two AI-calling CLIs whose main() is not exported run it under their
// `cli:<name>` origin at the entry call. They open real config and the real
// provider when imported, so this reads the entry line rather than running
// them; the origin mechanism itself is exercised in aiContext.test.mjs and
// through finance-jev-replay's exported main.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

describe.each([
  ['backfill-toc-offset.cli.mjs', 'cli:backfill-toc-offset', 'media'],
  ['journalist-debrief-preview.cli.mjs', 'cli:journalist-debrief-preview', 'journalist'],
])('%s', (file, origin, app) => {
  const source = readFileSync(path.join(here, file), 'utf8');

  it('imports runWithOrigin from the AI context', () => {
    expect(source).toMatch(/import \{ runWithOrigin \} from '#system\/runtime\/aiContext\.mjs';/);
  });

  it(`records its AI calls in the usage ledger as ${app}/cli`, () => {
    expect(source).toContain('aiUsageLedger: createCliAiUsageLedger(');
    expect(source).toContain(`.scoped(cliUsageTags('${app}'))`);
  });

  it(`enters main under ${origin}, and never calls main bare`, () => {
    expect(source).toContain(`runWithOrigin('${origin}', main)`);
    expect(source).not.toMatch(/^main\(\)/m);
  });
});

describe('finance-jev-replay.cli.mjs', () => {
  const source = readFileSync(path.join(here, 'finance-jev-replay.cli.mjs'), 'utf8');
  it('records its Jev calls in the usage ledger as finance/cli', () => {
    expect(source).toContain('createCliAiUsageLedger(configService)');
    expect(source).toContain("new JevAdapter({ apiKey }, { httpClient: axios, logger, aiUsageLedger })");
    expect(source).toContain(".scoped(cliUsageTags('finance'))");
  });
});

