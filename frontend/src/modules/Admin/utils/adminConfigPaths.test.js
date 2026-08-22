/**
 * Drift guard: the admin UI no longer keeps its own copy of household config
 * paths, so the only way it can break is an app leaving the shared registry.
 * These tests fail loudly if that happens.
 */
import { HOUSEHOLD_APP_CONFIGS } from '../../../../../shared/contracts/householdConfig.mjs';
import { ADMIN_ID_TO_APP, configPath, adminConfigPath } from './adminConfigPaths.js';

it('every admin editor path is a registered app config', () => {
  const used = ['finance', 'fitness', 'gratitude', 'harvest', 'media-app', 'art', 'games'];
  const unregistered = used.filter((a) => !HOUSEHOLD_APP_CONFIGS[a]);
  expect(unregistered).toEqual([]);
});

it('every admin friendly ID maps to a registered app', () => {
  const unregistered = Object.values(ADMIN_ID_TO_APP).filter((a) => !HOUSEHOLD_APP_CONFIGS[a]);
  expect(unregistered).toEqual([]);
});

it('derives the household-relative path from the registry', () => {
  expect(configPath('finance')).toBe(`household/${HOUSEHOLD_APP_CONFIGS.finance}.yml`);
  expect(configPath('games')).toBe(`household/${HOUSEHOLD_APP_CONFIGS.games}.yml`);
});

it('throws rather than emitting a path the API would 403', () => {
  expect(() => configPath('not-an-app')).toThrow(/Unregistered household app config/);
});

it('resolves the two admin IDs that differ from the app name', () => {
  // The admin calls harvest "shopping"...
  expect(adminConfigPath('shopping')).toBe(`household/${HOUSEHOLD_APP_CONFIGS.harvest}.yml`);
  // ...and "media" means the MediaApp SURFACE, not the media domain config.
  expect(adminConfigPath('media')).toBe(`household/${HOUSEHOLD_APP_CONFIGS['media-app']}.yml`);
  expect(adminConfigPath('media')).not.toBe(`household/${HOUSEHOLD_APP_CONFIGS.media}.yml`);
});

it('returns null for an ID the admin does not edit', () => {
  expect(adminConfigPath('nope')).toBeNull();
});
