import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';

const DEFAULT_MEDIA_MEMORY_RELATIVE = path.join('household', 'history', 'media_memory');

function resolveMediaMemoryPath(inputPath) {
  if (!inputPath) return null;

  const candidates = [
    inputPath,
    path.join(inputPath, DEFAULT_MEDIA_MEMORY_RELATIVE),
    path.join(inputPath, 'history', 'media_memory')
  ];

  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function loadYamlFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parse(raw) || {};
}

function writeYamlFile(filePath, data) {
  fs.writeFileSync(filePath, stringify(data));
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const backupPath = `${filePath}.bak`;
  if (fs.existsSync(backupPath)) return;
  fs.copyFileSync(filePath, backupPath);
}

function remapKeys(data, transformKey) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    return data.map(entry => {
      if (!entry || typeof entry !== 'object') return entry;
      if (entry.itemId) {
        return { ...entry, itemId: transformKey(entry.itemId) };
      }
      return entry;
    });
  }

  const mapped = {};
  for (const [key, value] of Object.entries(data)) {
    mapped[transformKey(key)] = value;
  }
  return mapped;
}

async function migrateWatchState(dataPath) {
  const mediaMemoryPath = resolveMediaMemoryPath(dataPath);

  if (!mediaMemoryPath) {
    console.log('No media_memory directory found, skipping migration');
    return;
  }

  const singingPath = path.join(mediaMemoryPath, 'singing.yml');
  const singalongPath = path.join(mediaMemoryPath, 'singalong.yml');
  const narratedPath = path.join(mediaMemoryPath, 'narrated.yml');
  const readalongPath = path.join(mediaMemoryPath, 'readalong.yml');
  const scripturesPath = path.join(mediaMemoryPath, 'scriptures.yml');

  // 1) singing.yml -> singalong.yml (rename keys)
  if (fs.existsSync(singingPath)) {
    console.log('Migrating singing.yml → singalong.yml');
    backupFile(singingPath);

    const singingData = loadYamlFile(singingPath) || {};
    const migrated = remapKeys(singingData, (key) => key.replace(/^singing:/, 'singalong:'));

    const existing = loadYamlFile(singalongPath) || {};
    const merged = Array.isArray(migrated)
      ? [...(Array.isArray(existing) ? existing : []), ...migrated]
      : { ...existing, ...migrated };

    writeYamlFile(singalongPath, merged);
  }

  // 2) narrated.yml -> readalong.yml (rename keys)
  if (fs.existsSync(narratedPath)) {
    console.log('Migrating narrated.yml → readalong.yml');
    backupFile(narratedPath);

    const narratedData = loadYamlFile(narratedPath) || {};
    const migrated = remapKeys(narratedData, (key) => key.replace(/^narrated:/, 'readalong:'));

    const existing = loadYamlFile(readalongPath) || {};
    const merged = Array.isArray(migrated)
      ? [...(Array.isArray(existing) ? existing : []), ...migrated]
      : { ...existing, ...migrated };

    writeYamlFile(readalongPath, merged);
  }

  // 3) scriptures.yml -> readalong:scripture/* keys (keep plex:* keys)
  if (fs.existsSync(scripturesPath)) {
    console.log('Migrating scriptures.yml narrated keys → readalong');
    backupFile(scripturesPath);

    const scripturesData = loadYamlFile(scripturesPath) || {};
    const migrated = remapKeys(scripturesData, (key) => key.replace(/^narrated:scripture\//, 'readalong:scripture/'));
    writeYamlFile(scripturesPath, migrated);
  }

  console.log('Watch history migration complete');
}

// Run
const dataPath = process.argv[2] || process.env.DATA_PATH;
if (!dataPath) {
  console.error('Usage: node migrate-watch-state.mjs <data-path-or-media_memory>');
  process.exit(1);
}

migrateWatchState(dataPath);
