import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(HERE, 'seed.yml');

let cached = null;

export async function readSeedFile() {
  if (cached) return cached;
  const text = await readFile(SEED_PATH, 'utf8');
  cached = yaml.load(text);
  return cached;
}

export async function loadSeedIfEmpty(memory) {
  const existing = memory.get('playbooks');
  if (Array.isArray(existing) && existing.length > 0) return { loaded: false };
  const seed = await readSeedFile();
  memory.set('playbooks', seed);
  return { loaded: true, count: seed.length };
}
