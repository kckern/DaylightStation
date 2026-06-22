// artmodeConfig.mjs — the single reader for the ArtMode catalogs.
//
// Both the screens router (screensaver preset expansion) and the art router
// (/preset/:key) load through here, so the file paths, YAML parse, and
// missing-file handling live in exactly one place instead of being copy-pasted
// per router. Missing files are non-fatal (an unconfigured install just gets
// empty catalogs).
import { promises as fs } from 'fs';
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
export async function loadArtmodeConfig(dataPath, logger = console) {
  const doc = await readYamlDoc(
    path.join(dataPath, 'household', 'config', 'artmode.yml'), logger, 'artmode.config.read_failed');
  return {
    presets: doc.presets || {}, defaults: doc.defaults || {}, frames: doc.frames || {},
    schedule: Array.isArray(doc.schedule) ? doc.schedule : [],
  };
}

// art.yml → the named collection catalog (the query definitions). Used to let a
// bare collection name resolve as a preset, so `art:baroque` needs no passthrough
// preset in artmode.yml.
export async function loadArtCollections(dataPath, logger = console) {
  const doc = await readYamlDoc(
    path.join(dataPath, 'household', 'config', 'art.yml'), logger, 'art.collections.read_failed');
  return doc.collections || {};
}

export default { loadArtmodeConfig, loadArtCollections };
