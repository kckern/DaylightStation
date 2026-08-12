#!/usr/bin/env node
/**
 * Acceptance gate for Presentation V2 rendered output.
 *
 * Runs the `/evaluate-presentation` command on a Fable agent, which reads the QA
 * scene PNGs and rules on whether they are production-ready. Exits non-zero when
 * they are not, so an implementing agent cannot declare completion on its own say-so.
 *
 *   node cli/evaluate-presentation.mjs [bundle]     # default bundle: showcase-v2
 *
 * Exit codes: 0 = PASS, 1 = FAIL, 2 = STALE artifacts, 3 = harness error.
 */

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXIT = { PASS: 0, FAIL: 1, STALE: 2, HARNESS: 3 };

function basePath() {
  if (process.env.DAYLIGHT_BASE_PATH) return process.env.DAYLIGHT_BASE_PATH;
  const envFile = resolve(REPO_ROOT, '.env');
  if (!existsSync(envFile)) return null;
  const match = readFileSync(envFile, 'utf8').match(/^DAYLIGHT_BASE_PATH=(.*)$/m);
  return match ? match[1].trim() : null;
}

function fail(message) {
  process.stderr.write(`evaluate-presentation: ${message}\n`);
  process.exit(EXIT.HARNESS);
}

const bundle = process.argv[2] ?? 'showcase-v2';
const root = basePath() ?? fail('DAYLIGHT_BASE_PATH is not set and .env does not define it');
const qaDir = resolve(root, 'media/games/_common/previews/qa', bundle);

if (!existsSync(qaDir)) fail(`no QA bundle at ${qaDir} — regenerate it with \`scene-qa-set\` before evaluating`);
if (!existsSync(resolve(qaDir, 'report.yml'))) fail(`${qaDir} has no report.yml — the bundle is incomplete`);

const child = spawn('claude', [
  '-p', `/evaluate-presentation ${bundle}`,
  '--model', 'claude-fable-5',
  '--allowed-tools', 'Read', 'Grep', 'Glob', 'Bash',
  '--permission-mode', 'bypassPermissions',
], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'inherit'] });

let critique = '';
child.stdout.on('data', (chunk) => { critique += chunk; process.stdout.write(chunk); });
child.on('error', (error) => fail(`could not launch claude: ${error.message}`));

child.on('close', (code) => {
  if (code !== 0 && !critique.trim()) fail(`claude exited ${code} without producing a critique`);

  const verdict = critique.match(/===\s*VERDICT\s*===\s*([\s\S]*)$/);
  const status = verdict?.[1].match(/^\s*status:\s*(PASS|FAIL|STALE)/m)?.[1];
  const blocking = Number(verdict?.[1].match(/^\s*blocking:\s*(\d+)/m)?.[1] ?? 0);

  const stamp = new Date().toISOString();
  writeFileSync(resolve(qaDir, 'SCENE_CRITIQUE.md'), `<!-- ${stamp} · bundle ${bundle} -->\n\n${critique.trim()}\n`);
  appendFileSync(
    resolve(qaDir, '..', 'evaluate-presentation.log'),
    `${stamp}\t${bundle}\t${status ?? 'UNPARSEABLE'}\tblocking=${blocking}\n`,
  );

  if (!status) {
    process.stderr.write('\nevaluate-presentation: no parseable verdict block — treating as FAIL.\n');
    process.exit(EXIT.FAIL);
  }

  const banner = {
    PASS: 'PASS — the rendered scenes are production-ready.',
    FAIL: `FAIL — ${blocking} blocking defect(s). Fix them, regenerate the QA bundle, and run this again.`,
    STALE: 'STALE — the QA artifacts predate the source. Regenerate the bundle and run this again.',
  }[status];

  process.stderr.write(`\nevaluate-presentation: ${banner}\nCritique: ${resolve(qaDir, 'SCENE_CRITIQUE.md')}\n`);
  process.exit(EXIT[status]);
});
