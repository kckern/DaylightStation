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
  ['backfill-toc-offset.cli.mjs', 'cli:backfill-toc-offset'],
  ['journalist-debrief-preview.cli.mjs', 'cli:journalist-debrief-preview'],
])('%s', (file, origin) => {
  const source = readFileSync(path.join(here, file), 'utf8');

  it('imports runWithOrigin from the AI context', () => {
    expect(source).toMatch(/import \{ runWithOrigin \} from '#system\/runtime\/aiContext\.mjs';/);
  });

  it(`enters main under ${origin}, and never calls main bare`, () => {
    expect(source).toContain(`runWithOrigin('${origin}', main)`);
    expect(source).not.toMatch(/^main\(\)/m);
  });
});
