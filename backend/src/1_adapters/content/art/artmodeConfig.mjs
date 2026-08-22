// artmodeConfig.mjs — the single reader for the ArtMode catalogs.
//
// Both the screens router (screensaver preset expansion) and the art router
// (/preset/:key) load through here, so the file paths, YAML parse, and
// missing-file handling live in exactly one place instead of being copy-pasted
// per router. Missing files are non-fatal (an unconfigured install just gets
// empty catalogs).
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

async function readYamlDoc(filePath, logger, event) {
  try {
    return yaml.load(await fs.readFile(filePath, 'utf-8')) || {};
  } catch (err) {
    if (err.code !== 'ENOENT') logger?.warn?.(event, { error: err.message });
    return {};
  }
}

// artmode.yml → { presets, defaults, frames }. `defaults` are merged beneath
// every preset; `frames` is the named frame-variety catalog (insets + mat + crop).
// `householdDir` is the resolved household base dir (ConfigService.getHouseholdPath('')).
export async function loadArtmodeConfig(householdDir, logger = console) {
  // Grouped path first, flat `config/` second. This adapter may not import the
  // config registry (layer rule `adapters-no-config-singleton` bans
  // `#system/config/*`), so the grouped path is spelled literally here — it must
  // stay in step with HOUSEHOLD_APP_CONFIGS.artmode ('art/artmode').
  const candidates = [
    path.join(householdDir, 'art', 'artmode.yml'),
    path.join(householdDir, 'config', 'artmode.yml'), // retiring — a later phase deletes this
  ];
  const target = candidates.find((p) => existsSync(p)) ?? candidates[0];
  const doc = await readYamlDoc(target, logger, 'artmode.config.read_failed');
  return {
    presets: doc.presets || {}, defaults: doc.defaults || {}, frames: doc.frames || {},
    schedule: Array.isArray(doc.schedule) ? doc.schedule : [],
  };
}

// art.yml → the named collection catalog (the query definitions). Used to let a
// bare collection name resolve as a preset, so `art:baroque` needs no passthrough
// preset in artmode.yml. `householdDir` is the resolved household base dir.
export async function loadArtCollections(householdDir, logger = console) {
  // Same grouped-first rule as loadArtmodeConfig. HOUSEHOLD_APP_CONFIGS.art is
  // 'art/config', so the collection catalog lands at art/config.yml.
  const candidates = [
    path.join(householdDir, 'art', 'config.yml'),
    path.join(householdDir, 'config', 'art.yml'), // retiring — a later phase deletes this
  ];
  const target = candidates.find((p) => existsSync(p)) ?? candidates[0];
  const doc = await readYamlDoc(target, logger, 'art.collections.read_failed');
  return doc.collections || {};
}

export default { loadArtmodeConfig, loadArtCollections };
