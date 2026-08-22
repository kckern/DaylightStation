import fs from 'fs';
import path from 'path';
import { HOUSEHOLD_APP_CONFIGS } from '#shared/contracts/householdConfig.mjs';

it('every registered app config exists on disk at its registered path', () => {
  const dataDir = process.env.DAYLIGHT_DATA_PATH
    || path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  const missing = Object.entries(HOUSEHOLD_APP_CONFIGS).filter(
    ([, rel]) => !['', '.yml', '.yaml'].some((ext) =>
      ext && fs.existsSync(path.join(dataDir, 'household', `${rel}${ext}`))),
  );
  expect(missing).toEqual([]);
});

// The retained config/ scan catches a forgotten FLAT file, but nothing catches
// a forgotten COLOCATED one: since Task 3, `household/foo/config.yml` with no
// registry entry silently does not load. Verified clean on 2026-08-21 (all 9
// colocated dirs are registered) — this keeps it that way.
it('no colocated <subdir>/config.yml exists outside the registry', () => {
  const dataDir = process.env.DAYLIGHT_DATA_PATH
    || path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  const root = path.join(dataDir, 'household');
  const registered = new Set(Object.values(HOUSEHOLD_APP_CONFIGS));
  const orphans = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => fs.existsSync(path.join(root, e.name, 'config.yml')))
    .map((e) => `${e.name}/config`)
    .filter((rel) => !registered.has(rel));
  expect(orphans).toEqual([]);
});

it('household/config/ holds no app config the registry does not know', () => {
  const dataDir = process.env.DAYLIGHT_DATA_PATH
    || path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  const dir = path.join(dataDir, 'household', 'config');
  const leftover = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.yml'))
    : [];
  expect(leftover).toEqual([]);
});
