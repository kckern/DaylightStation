/**
 * UserDataService household path resolution
 * @module tests/isolated/assembly/config/UserDataService.test
 *
 * Regression cover for the household calendar bug: `getHouseholdSharedPath`
 * hardcoded the segment `shared`, so `readHouseholdSharedData(hid, 'calendar')`
 * resolved to `household/shared/calendar.yml` — a file that has never existed.
 * The real store is `household/common/calendar.yml`, which is where the
 * datastores (e.g. YamlGratitudeDatastore) already read and write.
 *
 * The legacy `household/shared/` root still holds content-filter/, komga/ and
 * retroarch/. Those are reached by callers that spell the `shared/` prefix
 * themselves via `dataService.household.read('shared/...')`, never through this
 * helper — so they are asserted here to stay put.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  initConfigService,
  resetConfigService,
  resetDataService,
  dataService,
  userDataService,
} from '#backend/src/0_system/config/index.mjs';

describe('UserDataService household path resolution', () => {
  let dataDir;

  beforeAll(async () => {
    // Minimal on-disk config tree: system defaults + one household + one user.
    // ConfigService validates cross-references, so all three must be present.
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-data-service-'));

    fs.mkdirSync(path.join(dataDir, 'system', 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'system', 'config', 'system.yml'),
      'households:\n  default: default\ntimezone: America/Los_Angeles\n'
    );

    fs.mkdirSync(path.join(dataDir, 'household', 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'household', 'config', 'household.yml'),
      'name: Test Household\nhead: test-user\nusers:\n  - test-user\n'
    );

    fs.mkdirSync(path.join(dataDir, 'users', 'test-user'), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'users', 'test-user', 'profile.yml'),
      'name: Test User\nhousehold_id: default\n'
    );

    resetConfigService();
    resetDataService();
    await initConfigService(dataDir);
  });

  afterAll(() => {
    resetConfigService();
    resetDataService();
    if (dataDir && fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  describe('getHouseholdSharedPath', () => {
    // Regression: this resolver has pointed at the wrong root twice. First
    // shared/, which the calendar has never lived in — every household
    // calendar read returned null. Then common/, correct until the
    // domain-first reorganization retired that root too. It now resolves to
    // the household directory itself, so a domain segment IS the path.
    it('resolves household shared data to the household root, where the data actually lives', () => {
      const resolved = userDataService.getHouseholdSharedPath('default', 'calendar');

      expect(resolved).toMatch(/household[^/]*\/calendar$/);
      expect(resolved).not.toContain('/shared/');
      expect(resolved).not.toContain('/common/');
    });

    it('resolves nested segments as a domain path', () => {
      const resolved = userDataService.getHouseholdSharedPath('default', 'gratitude', 'options.gratitude');

      expect(resolved).toMatch(/household[^/]*\/gratitude\/options\.gratitude$/);
    });
  });

  describe('readHouseholdSharedData', () => {
    it('reads a household calendar stored at calendar.yml', () => {
      fs.writeFileSync(
        path.join(dataDir, 'household', 'calendar.yml'),
        'events:\n  - title: Test Event\n    date: 2026-01-21\n'
      );

      const calendar = userDataService.readHouseholdSharedData('default', 'calendar');

      expect(calendar).not.toBeNull();
      expect(calendar.events).toHaveLength(1);
      expect(calendar.events[0].title).toBe('Test Event');
    });

    it('does not read from the legacy shared/ root', () => {
      const sharedDir = path.join(dataDir, 'household', 'shared');
      fs.mkdirSync(sharedDir, { recursive: true });
      fs.writeFileSync(path.join(sharedDir, 'decoy.yml'), 'value: from-shared\n');

      expect(userDataService.readHouseholdSharedData('default', 'decoy')).toBeNull();
    });
  });

  describe('caller-supplied domain prefixes', () => {
    it('resolves a domain prefix verbatim — retroarch now sits at the household root', () => {
      // app.mjs reads these as dataService.household.read('retroarch/catalog').
      // The literal prefix is supplied by the caller, so it must survive
      // unchanged; this test used to pin the shared/ root that retroarch was
      // filed under before the domain-first reorganization.
      const resolved = dataService.household.resolveDir('retroarch/catalog', 'default');

      expect(resolved).toMatch(/household[^/]*\/retroarch\/catalog$/);
      expect(resolved).not.toContain('/shared/');
    });
  });
});
