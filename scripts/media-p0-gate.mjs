#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCEPTED_STORIES,
  SUPPORTING_ACCEPTED_CRITERIA,
  validateReport,
} from './media-stable-core-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_JOURNEY_DIRECTORY = 'tests/live/flow/media';

export const P0_EXTENSION_ENTRIES = Object.freeze([
  {
    story: 'PLACE.8a',
    criteria: ['PLACE.8a/AC1'],
    file: 'media-app-handoff-picker.runtime.test.mjs',
    grep: 'NowPlaying hand-off shows truthful aim plus explicit move/keep choices',
  },
  {
    story: 'STEER.1a',
    criteria: ['STEER.1a/AC2', 'STEER.1a/AC3'],
    file: 'media-app-handoff-picker.runtime.test.mjs',
    grep: 'NowPlaying hand-off shows truthful aim plus explicit move/keep choices',
  },
  {
    story: 'STEER.6a',
    criteria: ['STEER.6a/AC3'],
    file: 'media-app-stop-flow.runtime.test.mjs',
    grep: 'Stop keeps the queue reachable and separates Clear',
  },
  {
    story: 'RELY.4a',
    criteria: ['RELY.4a/AC1', 'RELY.4a/AC2'],
    file: 'media-app-queue-journey.runtime.test.mjs',
    grep: 'Undo restores the previous paused native position and queue generation',
  },
  {
    story: 'PLAY.6a',
    criteria: ['PLAY.6a/AC3'],
    file: 'media-app-remote-controls.runtime.test.mjs',
    grep: 'Add preserves playback and reports its position before Peek Next and Previous traverse the receiver queue',
  },
  {
    story: 'FIND.3a',
    criteria: ['FIND.3a/AC3'],
    file: 'media-app-search-states.runtime.test.mjs',
    grep: 'a failed source is named before a truthful widened result',
  },
  {
    story: 'FIND.4a',
    criteria: ['FIND.4a/AC2'],
    file: 'media-app-search-states.runtime.test.mjs',
    grep: 'a failed source is named before a truthful widened result',
  },
  {
    story: 'FIND.5a',
    criteria: ['FIND.5a/AC2'],
    file: 'media-app-browse-breadcrumb.runtime.test.mjs',
    grep: 'browse shows pictures, natural order, every parent, and collection actions',
  },
  {
    story: 'FIND.5a',
    criteria: ['FIND.5a/AC3'],
    file: 'media-app-browse-breadcrumb.runtime.test.mjs',
    grep: 'scrolling to the end loads the next page without a button hunt',
  },
  {
    story: 'FIND.5a',
    criteria: ['FIND.5a/AC4'],
    file: 'media-app-browse-breadcrumb.runtime.test.mjs',
    grep: 'browser Back restores the exact browse scroll and focused collection',
  },
  {
    story: 'FIND.6a',
    criteria: ['FIND.6a/AC1', 'FIND.6a/AC2', 'FIND.6a/AC3'],
    file: 'media-app-browse-breadcrumb.runtime.test.mjs',
    grep: 'browse shows pictures, natural order, every parent, and collection actions',
  },
  {
    story: 'HOUSE.2a',
    criteria: ['HOUSE.2a/AC3'],
    file: 'media-app-browser-control.runtime.test.mjs',
    grep: 'stable browser identities route a queue command through the actual receiver and return its ack',
  },
  {
    story: 'HOUSE.3a',
    criteria: ['HOUSE.3a/AC1', 'HOUSE.3a/AC3'],
    file: 'media-app-house-browser-session.runtime.test.mjs',
    grep: 'two browser devices agree on the local player title and state',
  },
  {
    story: 'HOUSE.4a',
    criteria: ['HOUSE.4a/AC2', 'HOUSE.4a/AC4'],
    file: 'media-app-browser-control.runtime.test.mjs',
    grep: 'stable browser identities route a queue command through the actual receiver and return its ack',
  },
  {
    story: 'AUTO.3a',
    criteria: ['AUTO.3a/AC1'],
    file: 'media-app-browser-control.runtime.test.mjs',
    grep: 'stable browser identities route a queue command through the actual receiver and return its ack',
  },
  {
    story: 'AUTO.3a',
    criteria: ['AUTO.3a/AC2'],
    file: 'media-app-house-browser-session.runtime.test.mjs',
    grep: 'two browser devices agree on the local player title and state',
  },  // Task 7 — outcomes, retry, paused restore, Start fresh. Only criteria with
  // exact runtime evidence; see the acceptance ledger for the rest.
  {
    story: 'RELY.3a',
    criteria: ['RELY.3a/AC1', 'RELY.3a/AC2', 'RELY.3a/AC3', 'RELY.3a/AC4'],
    file: 'media-app-outcomes.runtime.test.mjs',
    grep: 'RELY\\.3a',
  },
  {
    story: 'RELY.6a',
    criteria: ['RELY.6a/AC1'],
    file: 'media-app-outcomes.runtime.test.mjs',
    grep: 'RELY\\.3a',
  },
  {
    story: 'RELY.2a',
    criteria: ['RELY.2a/AC2'],
    file: 'media-app-outcomes.runtime.test.mjs',
    grep: 'RELY\\.2a',
  },
  {
    story: 'RELY.5a',
    criteria: ['RELY.5a/AC1', 'RELY.5a/AC2', 'RELY.5a/AC3'],
    file: 'media-app-local-failure.runtime.test.mjs',
    grep: 'RELY\\.5a',
  },
  {
    story: 'RELY.7a',
    criteria: ['RELY.7a/AC1', 'RELY.7a/AC5'],
    file: 'media-app-resume.runtime.test.mjs',
    grep: 'RELY\\.7a',
  },
  {
    story: 'RELY.7a',
    criteria: ['RELY.7a/AC2'],
    file: 'media-app-aim-journey.runtime.test.mjs',
    grep: 'a closed app restores',
  },
  {
    story: 'RELY.8a',
    criteria: ['RELY.8a/AC1', 'RELY.8a/AC2', 'RELY.8a/AC3'],
    file: 'media-app-reset-confirm.runtime.test.mjs',
    grep: 'RELY\\.8a',
  },
]);

const STABLE_ENTRIES = [...ACCEPTED_STORIES, ...SUPPORTING_ACCEPTED_CRITERIA];

function stableJourneyByCriterion() {
  return new Map(STABLE_ENTRIES.flatMap((entry) => entry.criteria.map((criterion) => [
    criterion,
    { story: entry.story, file: entry.file, grep: entry.grep },
  ])));
}

export function validateP0Manifest(entries) {
  if (!Array.isArray(entries)) throw new Error('P0 manifest must be an array');

  const criteria = new Set();
  const stories = new Set();
  const stableJourneys = stableJourneyByCriterion();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') throw new Error('P0 manifest entry must be an object');
    if (typeof entry.story !== 'string' || !entry.story) throw new Error('story is required');
    if (!entry.file || !entry.grep) throw new Error(`journey required for ${entry.story}`);
    if (!Array.isArray(entry.criteria) || entry.criteria.length === 0) {
      throw new Error(`criteria required for ${entry.story}`);
    }

    stories.add(entry.story);

    for (const criterion of entry.criteria) {
      if (typeof criterion !== 'string' || !criterion) throw new Error(`invalid criterion for ${entry.story}`);
      if (criteria.has(criterion)) throw new Error(`duplicate ${criterion}`);
      criteria.add(criterion);

      const stableJourney = stableJourneys.get(criterion);
      if (stableJourney && (entry.story !== stableJourney.story
        || entry.file !== stableJourney.file
        || entry.grep !== stableJourney.grep)) {
        throw new Error(`invalid journey for ${criterion}`);
      }
    }
  }

  for (const [criterion] of stableJourneys) {
    if (!criteria.has(criterion)) throw new Error(`missing ${criterion}`);
  }

  return { stories: stories.size, criteria: criteria.size };
}

function requiredDirectory(env) {
  const evidenceDir = env.MEDIA_P0_EVIDENCE_DIR;
  if (!env.BASE_URL) throw new Error('BASE_URL is required');
  if (!evidenceDir) throw new Error('MEDIA_P0_EVIDENCE_DIR is required');
  if (!existsSync(evidenceDir)) throw new Error(`evidence directory does not exist: ${evidenceDir}`);
  return evidenceDir;
}

function groupedJourneys(entries) {
  const journeys = new Map();
  for (const entry of entries) {
    const key = `${entry.file}\u0000${entry.grep}`;
    const journey = journeys.get(key) || { file: entry.file, grep: entry.grep, stories: [] };
    journey.stories.push(entry);
    journeys.set(key, journey);
  }
  return [...journeys.values()];
}

function logName(index, journey) {
  return `${String(index + 1).padStart(2, '0')}-${journey.file.replace(/[^a-zA-Z0-9._-]/g, '_')}-${journey.grep.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

export function runP0Gate({ env = process.env } = {}) {
  const entries = [...STABLE_ENTRIES, ...P0_EXTENSION_ENTRIES];
  const manifest = validateP0Manifest(entries);
  const evidenceDir = requiredDirectory(env);
  const reports = [];

  for (const [index, journey] of groupedJourneys(entries).entries()) {
    const target = path.join(MEDIA_JOURNEY_DIRECTORY, journey.file);
    const args = ['playwright', 'test', target, '--grep', journey.grep, '--workers=1', '--reporter=json'];
    const result = spawnSync('npx', args, {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const stem = logName(index, journey);
    const jsonPath = path.join(evidenceDir, `${stem}.json`);
    const textPath = path.join(evidenceDir, `${stem}.log`);
    writeFileSync(jsonPath, result.stdout || '');
    writeFileSync(textPath, [
      `$ npx ${args.join(' ')}`,
      `exit=${result.status ?? 'null'} signal=${result.signal ?? 'none'}`,
      result.stderr || '',
    ].join('\n'));
    if (result.error) throw new Error(`Playwright could not start for ${journey.file}: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`Playwright failed for ${journey.file} (${journey.grep}), exit ${result.status}`);

    let report;
    try {
      report = JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(`invalid Playwright JSON for ${journey.file} (${journey.grep}): ${error.message}`);
    }
    reports.push({ journey, paths: { jsonPath, textPath }, ...validateReport(report) });
  }

  return { manifest, reports };
}

function main() {
  const { manifest, reports } = runP0Gate();
  const output = [`media-p0: ${manifest.stories} stories / ${manifest.criteria} criteria`];
  for (const { journey, tests, paths } of reports) {
    const supported = journey.stories.map(({ story, criteria }) => `${story} (${criteria.join(', ')})`).join(', ');
    output.push(
      `PASS ${journey.file} --grep ${journey.grep}: ${tests} tests; ${supported}`,
      `  json=${paths.jsonPath} text=${paths.textPath}`,
    );
  }
  process.stdout.write(`${output.join('\n')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`media-p0: FAIL: ${error.message}\n`);
    process.exitCode = 1;
  }
}
