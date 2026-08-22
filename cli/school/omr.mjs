#!/usr/bin/env node
/**
 * Rebuild decoded quiz day files from the raw OMR manifest.
 *
 * The relay keeps the byte-faithful record in household/history/omr/; this
 * regenerates the decoded version (test ID + answers) in
 * household/apps/quizzes/. Whole-file rebuild — idempotent, safe to re-run
 * after any form-layout fix. Live decoding is createQuizScanRecorder in
 * backend/src/3_applications/quizzes/; this CLI shares its decoder.
 *
 * Usage:
 *   node cli/school.mjs omr                 # uses DAYLIGHT_BASE_PATH/data
 *   node cli/school.mjs omr --data-dir DIR  # explicit data dir
 *
 * @module cli/omr-quiz-backfill
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path, { join } from 'path';
import { readFileSync } from 'fs';
import yaml from 'js-yaml';

import { rebuildQuizDayFiles } from '#apps/quizzes/quizScanRecorder.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

export async function main(argv = process.argv.slice(2)) {
const argIdx = argv.indexOf('--data-dir');
const dataDir = argIdx !== -1
  ? path.resolve(argv[argIdx + 1])
  : process.env.DAYLIGHT_BASE_PATH
    ? join(process.env.DAYLIGHT_BASE_PATH, 'data')
    : null;
if (!dataDir) {
  console.error('ERROR: pass --data-dir or set DAYLIGHT_BASE_PATH in .env');
  return 1;
}

// Same config file the live recorder gets (dir overrides); defaults if absent.
// The grouped path (hardware/omr/readers.yml per shared/contracts/householdConfig.mjs)
// is the only location — Phase E deleted the retiring flat config/ fallback.
// Getting this wrong is not cosmetic: the `persistence.dir` / `quizzes.dir`
// overrides below come from this file, so a miss silently rebuilds history into
// the DEFAULT directories instead of the household's configured ones.
const CONFIG_PATH = join(dataDir, 'household', 'hardware', 'omr', 'readers.yml');
let config = {};
try {
  config = yaml.load(readFileSync(CONFIG_PATH, 'utf8')) || {};
} catch { /* defaults */ }

// The CLI is its own composition root here: it resolves both roots and passes
// them down, the same way app.mjs does for the live recorder.
const resolveRoot = (override, fallback) => (override
  ? join(dataDir, ...String(override).replace(/^\/+/, '').split('/'))
  : join(dataDir, 'household', fallback));
const result = await rebuildQuizDayFiles({
  historyRoot: resolveRoot(config?.persistence?.dir, 'hardware/omr/log'),
  // MUST match app.mjs's live default for the recorder (school/records/assessments/omr). These
  // are two composition roots writing the same tree, so a drift here silently
  // rebuilds history into a directory nothing reads — which is what happened
  // when `quizzes/` was folded under `school/` and only app.mjs was updated.
  outRoot: resolveRoot(config?.quizzes?.dir, 'school/records/assessments/omr'),
  config,
  logger: console,
});
console.log(`Rebuilt ${result.days} day file(s), ${result.sheets} sheet(s), across ${result.readers} reader(s).`);
  return 0;
}

const ENTRYPOINT = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
