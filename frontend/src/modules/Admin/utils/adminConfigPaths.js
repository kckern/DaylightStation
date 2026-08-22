/**
 * Admin YAML-browser paths for household app configs — DERIVED, never typed.
 *
 * The admin UI routes config reads/writes through
 * `/api/v1/admin/config/files/{path}` (YamlConfigFileService), whose allowlist
 * derives from `shared/contracts/householdConfig.mjs`. Before this module the
 * frontend kept its own hand-typed copy of those paths, which is the copy most
 * likely to drift — it is a different allowlist from the backend's APP_CONFIGS,
 * so it did not follow backend renames. Everything here computes from the
 * registry instead: adding an app to the registry is the only edit needed.
 *
 * Mirrors `AppsConfigService.ADMIN_ID_TO_APP` on the backend.
 */
import { HOUSEHOLD_APP_CONFIGS } from '../../../../../shared/contracts/householdConfig.mjs';

/**
 * Admin friendly ID → registered app name. Only two IDs differ from the app
 * name they edit:
 *   shopping → harvest    (the admin calls it Shopping)
 *   media    → media-app  (the admin edits the SURFACE: browse + searchScopes,
 *                          NOT the media DOMAIN config that holds the Plex host)
 */
export const ADMIN_ID_TO_APP = Object.freeze({
  fitness: 'fitness',
  finance: 'finance',
  gratitude: 'gratitude',
  shopping: 'harvest',
  media: 'media-app',
  entropy: 'entropy',
  piano: 'piano',
});

/**
 * Admin YAML-browser path for a registered app.
 * @param {string} app - app name as registered in HOUSEHOLD_APP_CONFIGS
 * @returns {string} data-root-relative path, e.g. 'household/finance/config.yml'
 * @throws {Error} when the app is not registered — a typo must fail loudly
 *   rather than silently 403 at the API.
 */
export function configPath(app) {
  const relPath = HOUSEHOLD_APP_CONFIGS[app];
  if (!relPath) throw new Error(`Unregistered household app config: ${app}`);
  return `household/${relPath}.yml`;
}

/**
 * Admin YAML-browser path for an admin friendly ID, or null when the ID is not
 * one the admin edits (callers render an "Unknown App" state).
 * @param {string} adminId
 * @returns {string|null}
 */
export function adminConfigPath(adminId) {
  const app = ADMIN_ID_TO_APP[adminId];
  return app ? configPath(app) : null;
}
