/**
 * The single source of truth for where a household app's config lives.
 *
 * Folder = the DOMAIN, named after `backend/src/3_applications/`.
 * Filename = the facet: `config` for domain policy, another name for a
 * surface or a second facet of the same domain.
 *
 * This replaces the directory scan that `configLoader` used to do. A scan
 * cannot express grouping (`hardware/scales.yml` is not `<app>/config.yml`),
 * and — more importantly — it left `AppsConfigService.APP_CONFIGS` and
 * `YamlConfigFileService.ALLOWED_FILES` to be maintained BY HAND. Both drifted:
 * ALLOWED_FILES shipped covering 3 of the 11 files task-13 created, silently
 * 403ing the rest in the admin YAML browser. Both now derive from this map, so
 * adding an app here is the only edit an app needs.
 *
 * SECURITY: this registry is a security boundary. Adding an entry grants the
 * admin YAML browser read/write on that file, because
 * YamlConfigFileService.ALLOWED_FILES derives from it. That is the intended
 * trade — drift-proof beats hand-maintained — but never register a path under
 * an auth directory. (MASKED_DIRS is checked before the allowlist, so a mask
 * would still win, but do not rely on that as the only defence.)
 *
 * Paths are relative to the household folder, WITHOUT extension — callers
 * resolve .yml/.yaml via `resolveYamlPath`.
 *
 * This map is now the ONLY way a household app config is found. The retiring
 * flat `<household>/config/<app>.yml` fallback was deleted in Phase E, after
 * `backend/tests/unit/system/config/registryCompleteness.test.mjs` proved every
 * registered path resolves on disk and no unregistered colocated config exists.
 * An app missing from this map no longer degrades to a flat file — it simply
 * has no config. Add the entry here; that is the only edit an app needs.
 *
 * WHY THIS LIVES IN shared/contracts/ RATHER THAN 0_system/config/:
 * it is a naming CONTRACT, not config internals. It declares where files live;
 * it holds no logic and does no I/O. Three layers need it — the config loader
 * (`0_system`), the admin apps service (`3_applications`), and later the admin
 * frontend, which already reaches into shared/ by relative path and today keeps
 * its OWN duplicate copy of these paths. `3_applications/` is forbidden from
 * importing `#system/config/*` (layer rule `apps-no-config-internals`), which is
 * what put this file here; `shared/contracts/media/` is the same pattern.
 */
export const HOUSEHOLD_APP_CONFIGS = Object.freeze({
  agents:           'agents/config',
  ambient:          'ambient/config',
  art:              'art/config',
  artmode:          'art/artmode',
  barcode:          'hardware/barcode/config',
  'barcode-relay':  'hardware/barcode/relay',
  'camera-archive': 'camera/archive',
  chess:            'gaming/chess',
  concierge:        'agents/concierge',
  donow:            'donow/config',
  entropy:          'entropy/config',
  finance:          'finance/config',
  fitness:          'fitness/config',
  games:            'gaming/games',
  'party-games':     'gaming/party-games/config',
  gratitude:        'gratitude/config',
  harvest:          'harvest/config',
  livestream:       'livestream/config',
  // `media` is the DOMAIN (plex host, protocol, infinity board ids) and
  // `media-app` is the MediaApp SURFACE (browse menu, searchScopes). The files
  // on disk were named the other way round before this migration.
  media:            'media/config',
  'media-app':      'media/app',
  newsreporter:     'newsreporter/config',
  notifications:    'notifications/config',
  'omr-readers':    'hardware/omr/readers',
  piano:            'piano/config',
  'playback-hub':   'playback-hub/config',
  'pressure-mats':  'hardware/pressure-mats/config',
  retroarch:        'gaming/retroarch/config',
  requirements:     'requirements/config',
  scales:           'hardware/scales',
  // A named policy file reads better than a generic config.yml sitting beside
  // records/ and runtime/.
  school:           'school/school',
  // Shared, durable safety policy for public kiosk shutdown.  Runtime state
  // remains beside it in shutdown/lockdown.yml so a parent can inspect or
  // revoke it by editing/removing that one record.
  shutdown:         'shutdown/config',
  sheets:           'sheets/config',
  vehicles:         'automotive/vehicles',
});

/** Grouped path for an app, or null when the app is not registered. */
export function appConfigRelPath(appName) {
  return HOUSEHOLD_APP_CONFIGS[appName] ?? null;
}

/** Every registered app name. */
export function allAppNames() {
  return Object.keys(HOUSEHOLD_APP_CONFIGS);
}
