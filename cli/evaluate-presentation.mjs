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
 * Exit codes:
 *   0  PASS    — the scenes are production-ready
 *   1  FAIL    — the reviewer found blocking defects in the rendered output
 *   2  STALE   — the QA artifacts predate the source; regenerate and re-run
 *   3  HARNESS — the review never happened (auth, network, bad bundle, crash)
 *
 * Exit 3 is NOT a verdict on the artwork. Nothing was reviewed. Do not act on it
 * as if defects were found, and do not attempt to repair it by authenticating —
 * see the guidance printed with the error.
 */

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXIT = { PASS: 0, FAIL: 1, STALE: 2, HARNESS: 3 };

function harnessFailure(reason, guidance) {
  process.stderr.write(`\nevaluate-presentation: HARNESS FAILURE — ${reason}\n`);
  process.stderr.write('Nothing was reviewed. This is not a verdict on the rendered scenes.\n');
  if (guidance) process.stderr.write(`${guidance}\n`);
  process.exit(EXIT.HARNESS);
}

function basePath() {
  if (process.env.DAYLIGHT_BASE_PATH) return process.env.DAYLIGHT_BASE_PATH;
  const envFile = resolve(REPO_ROOT, '.env');
  if (!existsSync(envFile)) return null;
  const match = readFileSync(envFile, 'utf8').match(/^DAYLIGHT_BASE_PATH=(.*)$/m);
  return match ? match[1].trim() : null;
}

function run(command, args) {
  return new Promise((done) => {
    const proc = spawn(command, args, { cwd: REPO_ROOT });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', (error) => done({ code: null, stdout, stderr: error.message }));
    proc.on('close', (code) => done({ code, stdout, stderr }));
  });
}

const bundle = process.argv[2] ?? 'showcase-v2';
const root = basePath();
if (!root) harnessFailure('DAYLIGHT_BASE_PATH is not set and .env does not define it');

const qaDir = resolve(root, 'media/games/_common/previews/qa', bundle);
if (!existsSync(qaDir)) {
  harnessFailure(`no QA bundle at ${qaDir}`, 'Regenerate it with `scene-qa-set` before evaluating.');
}
if (!existsSync(resolve(qaDir, 'report.yml'))) {
  harnessFailure(`${qaDir} has no report.yml`, 'The bundle is incomplete. Re-run `scene-qa-set`.');
}

// Preflight: the reviewer needs a working Claude CLI. Catching this here keeps an
// environment problem from masquerading as a scene defect further down.
const auth = await run('claude', ['auth', 'status']);
if (auth.code === null) {
  harnessFailure(
    `the \`claude\` CLI could not be launched (${auth.stderr})`,
    'Install it, or put it on PATH for whatever process invokes this script.',
  );
}
if (!/"loggedIn"\s*:\s*true/.test(auth.stdout)) {
  harnessFailure(
    'the `claude` CLI reports no authenticated session in this environment',
    [
      'DO NOT run `claude auth login` or open an OAuth URL to work around this.',
      'The credentials already exist for this user; the calling process cannot reach them',
      '(they live in ~/.claude/.credentials.json and the macOS keychain, outside a sandbox).',
      'This is an environment problem for a human to resolve. Stop and report it.',
    ].join('\n'),
  );
}

const child = spawn('claude', [
  '-p', `/evaluate-presentation ${bundle}`,
  '--model', 'claude-fable-5',
  '--allowed-tools', 'Read', 'Grep', 'Glob', 'Bash',
  '--permission-mode', 'bypassPermissions',
], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

let critique = '';
let errors = '';
child.stdout.on('data', (chunk) => { critique += chunk; process.stdout.write(chunk); });
child.stderr.on('data', (chunk) => { errors += chunk; process.stderr.write(chunk); });
child.on('error', (error) => harnessFailure(`could not launch claude: ${error.message}`));

child.on('close', (code) => {
  const verdict = critique.match(/===\s*VERDICT\s*===\s*([\s\S]*)$/);
  const status = verdict?.[1].match(/^\s*status:\s*(PASS|FAIL|STALE)/m)?.[1];

  // No parseable verdict means the review did not complete. That is a harness
  // failure, never a FAIL — reporting it as FAIL sends the implementing agent
  // hunting for defects that were never found.
  if (!status) {
    const detail = errors.trim() || critique.trim().slice(-400) || `claude exited ${code} with no output`;
    harnessFailure(
      `the reviewer produced no verdict block (claude exited ${code})`,
      `Last output from the reviewer:\n${detail}`,
    );
  }

  const blocking = Number(verdict[1].match(/^\s*blocking:\s*(\d+)/m)?.[1] ?? 0);
  const stamp = new Date().toISOString();

  // Only written on a completed review, so a broken run cannot destroy the prior
  // critique — the next review reads it to catch repeat offenses.
  writeFileSync(resolve(qaDir, 'SCENE_CRITIQUE.md'), `<!-- ${stamp} · bundle ${bundle} -->\n\n${critique.trim()}\n`);
  appendFileSync(
    resolve(qaDir, '..', 'evaluate-presentation.log'),
    `${stamp}\t${bundle}\t${status}\tblocking=${blocking}\n`,
  );

  const banner = {
    PASS: 'PASS — the rendered scenes are production-ready.',
    FAIL: `FAIL — ${blocking} blocking defect(s) in the rendered scenes. Fix them, regenerate the QA bundle, and run this again.`,
    STALE: 'STALE — the QA artifacts predate the source. Regenerate the bundle and run this again.',
  }[status];

  process.stderr.write(`\nevaluate-presentation: ${banner}\nCritique: ${resolve(qaDir, 'SCENE_CRITIQUE.md')}\n`);
  process.exit(EXIT[status]);
});
