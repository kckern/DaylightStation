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
 *   node cli/omr-quiz-backfill.cli.mjs                 # uses DAYLIGHT_BASE_PATH/data
 *   node cli/omr-quiz-backfill.cli.mjs --data-dir DIR  # explicit data dir
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
dotenv.config({ path: join(__dirname, '..', '.env') });

const argIdx = process.argv.indexOf('--data-dir');
const dataDir = argIdx !== -1
  ? path.resolve(process.argv[argIdx + 1])
  : process.env.DAYLIGHT_BASE_PATH
    ? join(process.env.DAYLIGHT_BASE_PATH, 'data')
    : null;
if (!dataDir) {
  console.error('ERROR: pass --data-dir or set DAYLIGHT_BASE_PATH in .env');
  process.exit(1);
}

// Same config file the live recorder gets (dir overrides); defaults if absent.
let config = {};
try {
  config = yaml.load(readFileSync(join(dataDir, 'household', 'config', 'omr-readers.yml'), 'utf8')) || {};
} catch { /* defaults */ }

// The CLI is its own composition root here: it resolves both roots and passes
// them down, the same way app.mjs does for the live recorder.
const resolveRoot = (override, fallback) => (override
  ? join(dataDir, ...String(override).replace(/^\/+/, '').split('/'))
  : join(dataDir, 'household', fallback));
const result = await rebuildQuizDayFiles({
  historyRoot: resolveRoot(config?.persistence?.dir, 'hardware/omr/log'),
  // MUST match app.mjs's live default for the recorder (school/quizzes). These
  // are two composition roots writing the same tree, so a drift here silently
  // rebuilds history into a directory nothing reads — which is what happened
  // when `quizzes/` was folded under `school/` and only app.mjs was updated.
  outRoot: resolveRoot(config?.quizzes?.dir, 'school/quizzes'),
  config,
  logger: console,
});
console.log(`Rebuilt ${result.days} day file(s), ${result.sheets} sheet(s), across ${result.readers} reader(s).`);
