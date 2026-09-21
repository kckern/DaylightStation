#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_JOURNEY_DIRECTORY = 'tests/live/flow/media';

export const ACCEPTED_STORIES = Object.freeze([
  { story: 'FIND.1b', criteria: ['FIND.1b/AC1', 'FIND.1b/AC2'], file: 'media-app-result-play-now.runtime.test.mjs', grep: 'FIND.1b' },
  { story: 'FIND.2a', criteria: ['FIND.2a/AC1', 'FIND.2a/AC2', 'FIND.2a/AC3', 'FIND.2a/AC4'], file: 'media-app-search-scopes.runtime.test.mjs', grep: 'FIND.2a' },
  { story: 'PLAY.1b', criteria: ['PLAY.1b/AC1', 'PLAY.1b/AC2'], file: 'media-app-play-now-local-entrypoints.runtime.test.mjs', grep: 'PLAY.1b' },
  { story: 'PLACE.2b', criteria: ['PLACE.2b/AC1', 'PLACE.2b/AC2', 'PLACE.2b/AC3'], file: 'media-app-aim-journey.runtime.test.mjs', grep: 'PLACE.2b' },
  { story: 'PLACE.3b', criteria: ['PLACE.3b/AC1', 'PLACE.3b/AC2'], file: 'media-app-result-play-now.runtime.test.mjs', grep: 'FIND.1b' },
  { story: 'STEER.1c', criteria: ['STEER.1c/AC1', 'STEER.1c/AC2'], file: 'media-app-remote-controls.runtime.test.mjs', grep: 'STEER.1c' },
  { story: 'STEER.2a', criteria: ['STEER.2a/AC1', 'STEER.2a/AC2', 'STEER.2a/AC3'], file: 'media-app-playback-journey.runtime.test.mjs', grep: 'STEER.2a' },
  { story: 'HOUSE.1a', criteria: ['HOUSE.1a/AC1', 'HOUSE.1a/AC2', 'HOUSE.1a/AC3'], file: 'media-app-house-indicator.runtime.test.mjs', grep: 'HOUSE.1a' },
  { story: 'HOUSE.2b', criteria: ['HOUSE.2b/AC1', 'HOUSE.2b/AC2'], file: 'media-app-house-browser-session.runtime.test.mjs', grep: 'HOUSE.2b' },
  { story: 'RELY.9a', criteria: ['RELY.9a/AC1', 'RELY.9a/AC2'], file: 'media-app-navigation-history.runtime.test.mjs', grep: 'RELY.9a' },
  { story: 'RELY.10a', criteria: ['RELY.10a/AC1', 'RELY.10a/AC2', 'RELY.10a/AC3'], file: 'media-app-navigation-history.runtime.test.mjs', grep: 'RELY.10a' },
]);

export const SUPPORTING_ACCEPTED_CRITERIA = Object.freeze([
  { story: 'PLACE.2a', criteria: ['PLACE.2a/AC1', 'PLACE.2a/AC2', 'PLACE.2a/AC3'], file: 'media-app-aim-persistence.runtime.test.mjs', grep: 'PLACE\\.2a/AC1-3' },
  { story: 'PLACE.2a', criteria: ['PLACE.2a/AC5'], file: 'media-app-aim-journey.runtime.test.mjs', grep: 'a closed app restores' },
]);

function sameValues(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function validateEntries(entries, expected, kind, allowRepeatedStory = false) {
  if (!Array.isArray(entries)) throw new Error(`${kind} manifest must be an array`);
  const remaining = new Map(expected.map((entry, index) => [`${entry.story}\u0000${index}`, entry]));
  const seenStories = new Set();
  const seenCriteria = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') throw new Error(`${kind} manifest entry must be an object`);
    if (!allowRepeatedStory && seenStories.has(entry.story)) throw new Error(`duplicate ${entry.story}`);
    if (Array.isArray(entry.criteria)) {
      const duplicate = entry.criteria.find((criterion) => seenCriteria.has(criterion));
      if (duplicate) throw new Error(`duplicate ${duplicate}`);
    }
    const matching = [...remaining.entries()].find(([, value]) => value.story === entry.story && sameValues(entry.criteria, value.criteria));
    if (!matching) {
      if (!expected.some((value) => value.story === entry.story)) throw new Error(`unknown ${entry.story}`);
      throw new Error(`criteria mismatch for ${entry.story}`);
    }
    const [key, expectedEntry] = matching;
    if (entry.file !== expectedEntry.file || entry.grep !== expectedEntry.grep) throw new Error(`invalid journey for ${entry.story}`);
    for (const criterion of entry.criteria) {
      if (seenCriteria.has(criterion)) throw new Error(`duplicate ${criterion}`);
      seenCriteria.add(criterion);
    }
    seenStories.add(entry.story);
    remaining.delete(key);
  }
  if (remaining.size) {
    const [missing] = remaining.values();
    throw new Error(`missing ${missing.criteria[0]}`);
  }
  return { stories: seenStories.size, criteria: seenCriteria.size };
}

export function validateManifest(manifest, supporting = SUPPORTING_ACCEPTED_CRITERIA) {
  if (!Array.isArray(manifest)) throw new Error('manifest must be an array');
  const fullyAccepted = validateEntries(manifest, ACCEPTED_STORIES, 'accepted');
  const partial = validateEntries(supporting, SUPPORTING_ACCEPTED_CRITERIA, 'supporting', true);
  if (fullyAccepted.stories !== 11 || fullyAccepted.criteria + partial.criteria !== 32 || partial.stories !== 1) {
    throw new Error('manifest must contain 11 fully accepted stories and 32 accepted criteria');
  }
  return {
    fullyAcceptedStories: fullyAccepted.stories,
    acceptedCriteria: fullyAccepted.criteria + partial.criteria,
    supportingPartialStories: partial.stories,
  };
}

function collectTests(suites, tests = []) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) tests.push(...(spec.tests || []));
    collectTests(suite.suites, tests);
  }
  return tests;
}

export function validateReport(report) {
  if (!report || typeof report !== 'object') throw new Error('report must be an object');
  const tests = collectTests(report.suites);
  if (tests.length === 0) throw new Error('zero tests selected');

  for (const test of tests) {
    const statuses = test.results?.length ? test.results.map(({ status }) => status) : [test.status];
    for (const status of statuses) {
      if (status !== 'passed') throw new Error(`selected test ${status || 'missing status'}`);
    }
  }
  return { tests: tests.length };
}

function requiredDirectory(env) {
  const evidenceDir = env.MEDIA_STABLE_CORE_EVIDENCE_DIR;
  if (!env.BASE_URL) throw new Error('BASE_URL is required');
  if (!evidenceDir) throw new Error('MEDIA_STABLE_CORE_EVIDENCE_DIR is required');
  if (!existsSync(evidenceDir)) throw new Error(`evidence directory does not exist: ${evidenceDir}`);
  return evidenceDir;
}

function groupedJourneys(manifest) {
  const journeys = new Map();
  for (const entry of manifest) {
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

export function runGate({ env = process.env } = {}) {
  const manifest = validateManifest(ACCEPTED_STORIES);
  const evidenceDir = requiredDirectory(env);
  const journeys = groupedJourneys([...ACCEPTED_STORIES, ...SUPPORTING_ACCEPTED_CRITERIA]);
  const reports = [];

  journeys.forEach((journey, index) => {
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
  });

  return { manifest, reports };
}

function main() {
  const { manifest, reports } = runGate();
  console.log(`media-stable-core: ${manifest.fullyAcceptedStories} fully accepted stories / ${manifest.acceptedCriteria} criteria / ${manifest.supportingPartialStories} supporting partial story`);
  for (const { journey, tests, paths } of reports) {
    const supported = journey.stories.map(({ story, criteria }) => `${story} (${criteria.join(', ')})`).join(', ');
    console.log(`PASS ${journey.file} --grep ${journey.grep}: ${tests} tests; ${supported}`);
    console.log(`  json=${paths.jsonPath} text=${paths.textPath}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`media-stable-core: FAIL: ${error.message}\n`);
    process.exitCode = 1;
  }
}
