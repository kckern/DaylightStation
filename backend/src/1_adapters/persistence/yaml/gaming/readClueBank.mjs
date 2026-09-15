import crypto from 'node:crypto';
import path from 'node:path';
import YAML from 'yaml';
import { fileExists, readTextFromPath, readBinaryFromPath, resolveRealPath, ensureDir, writeFileExclusive } from '#system/utils/FileIO.mjs';

function containedFile(root, relative, label) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new Error(`${label} must be a contained relative path`);
  }
  const base = resolveRealPath(root);
  const target = path.resolve(root, relative);
  if (!base || !fileExists(target)) throw new Error(`${label} file is missing`);
  const real = resolveRealPath(target);
  if (!real?.startsWith(`${base}${path.sep}`)) throw new Error(`${label} must be contained in the content root`);
  return target;
}

// Materialize before hashing/pinning so authored edits cannot rewrite a session.
export function readClueBank(content, contentGamesDir) {
  if (content.clue_bank == null) return content;
  if (!contentGamesDir) throw new Error('clue_bank requires a configured content games directory');
  if (content.challenges != null) throw new Error('clue_bank and challenges cannot both be authored');
  const bankFile = containedFile(contentGamesDir, content.clue_bank, 'clue_bank');
  const bank = YAML.parse(readTextFromPath(bankFile), { uniqueKeys: true });
  if (bank?.version !== 1 || !Array.isArray(bank.clues) || !bank.clues.length) throw new Error('clue_bank requires version 1 and nonempty clues');
  const filter = content.clue_filter;
  if (filter != null) {
    if (typeof filter !== 'object' || Array.isArray(filter) || Object.keys(filter).some(key => !['categories', 'levels'].includes(key))) throw new Error('clue_filter supports categories and levels');
    for (const values of Object.values(filter)) {
      if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value))) throw new Error('clue_filter values must be nonempty lists of category or level names');
    }
  }
  const ids = new Set();
  const challenges = bank.clues.map((clue) => {
    if (!/^[a-z][a-z0-9-]*$/.test(clue?.id || '')) throw new Error('clue requires a stable id');
    if (ids.has(clue.id)) throw new Error(`duplicate clue id: ${clue.id}`);
    ids.add(clue.id);
    if (typeof clue.text !== 'string' || !clue.text.trim()) throw new Error(`clue ${clue.id} requires text`);
    const challenge = { id: clue.id, activity: 'charades', prompt: clue.text.trim() };
    for (const field of ['category', 'level']) {
      if (clue[field] != null) {
        if (typeof clue[field] !== 'string' || !/^[a-z][a-z0-9-]*$/.test(clue[field])) throw new Error(`clue ${clue.id} has invalid ${field}`);
        challenge[field] = clue[field];
      }
    }
    if (clue.image != null) {
      const imageFile = containedFile(path.dirname(bankFile), clue.image, `clue ${clue.id} image`);
      if (!['.svg', '.png', '.webp', '.jpg', '.jpeg'].includes(path.extname(imageFile).toLowerCase())) throw new Error(`clue ${clue.id} image format is unsupported`);
      const relative = path.relative(contentGamesDir, imageFile).split(path.sep).map(encodeURIComponent).join('/');
      const hash = crypto.createHash('sha256').update(readBinaryFromPath(imageFile)).digest('hex');
      challenge.decoder = { image: `/api/v1/gaming/media/content/${hash}/${relative}` };
    }
    return challenge;
  });
  const { clue_bank: _source, ...artifact } = content;
  const selected = challenges.filter(clue => (!filter?.categories || filter.categories.includes(clue.category)) && (!filter?.levels || filter.levels.includes(clue.level)));
  if (!selected.length) throw new Error('clue_filter matches no clues');
  return { ...artifact, challenges: selected };
}


// Ordinary sessions archive image bytes; read-only catalog/diagnostic loads do
// not write. If authored art changes between load and pin, retry the new game.
export function pinClueImages(content, contentGamesDir, imageArchiveDir) {
  for (const challenge of content.challenges || []) {
    const match = challenge.decoder?.image?.match(/^\/api\/v1\/gaming\/media\/content\/([a-f0-9]{64})\/(.+)$/);
    if (!match) continue;
    const [, hash, encodedRelative] = match;
    const relative = encodedRelative.split('/').map(decodeURIComponent).join('/');
    const extension = path.extname(relative).toLowerCase();
    const target = path.join(imageArchiveDir, `${hash}${extension}`);
    if (fileExists(target)) continue;
    const source = containedFile(contentGamesDir, relative, 'clue image');
    const bytes = readBinaryFromPath(source);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Clue image changed while preparing the session; retry');
    ensureDir(imageArchiveDir);
    writeFileExclusive(target, bytes);
  }
}
