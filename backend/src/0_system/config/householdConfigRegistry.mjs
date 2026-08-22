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
 * Paths are relative to the household folder, WITHOUT extension — callers
 * resolve .yml/.yaml via `resolveYamlPath`.
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
  gameshow:         'gaming/gameshow/config',
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
  scales:           'hardware/scales',
  // A named policy file reads better than a generic config.yml sitting beside
  // records/ and runtime/.
  school:           'school/school',
  sheets:           'sheets/config',
  vehicles:         'automotive/vehicles',
});

/** Grouped path for an app, or null when the app is not registered. */
export function appConfigRelPath(appName) {
  return HOUSEHOLD_APP_CONFIGS[appName] ?? null;
}

/**
 * The retiring flat path. Kept ONLY so a tree that has not synced the data move
 * yet still resolves. Deleted in a later phase.
 */
export function legacyAppConfigRelPath(appName) {
  return `config/${appName}`;
}

/** Every registered app name. */
export function allAppNames() {
  return Object.keys(HOUSEHOLD_APP_CONFIGS);
}
