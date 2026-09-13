import path from 'node:path';
import YAML from 'yaml';
import { fileExists, readTextFromPath, resolveRealPath } from '#system/utils/FileIO.mjs';

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
  const ids = new Set();
  const challenges = bank.clues.map((clue) => {
    if (!/^[a-z][a-z0-9-]*$/.test(clue?.id || '')) throw new Error('clue requires a stable id');
    if (ids.has(clue.id)) throw new Error(`duplicate clue id: ${clue.id}`);
    ids.add(clue.id);
    if (typeof clue.text !== 'string' || !clue.text.trim()) throw new Error(`clue ${clue.id} requires text`);
    const challenge = { id: clue.id, activity: 'charades', prompt: clue.text.trim() };
    if (clue.image != null) {
      const imageFile = containedFile(path.dirname(bankFile), clue.image, `clue ${clue.id} image`);
      if (!['.svg', '.png', '.webp', '.jpg', '.jpeg'].includes(path.extname(imageFile).toLowerCase())) throw new Error(`clue ${clue.id} image format is unsupported`);
      const relative = path.relative(contentGamesDir, imageFile).split(path.sep).map(encodeURIComponent).join('/');
      challenge.decoder = { image: `/api/v1/gaming/media/content/${relative}` };
    }
    return challenge;
  });
  const { clue_bank: _source, ...artifact } = content;
  return { ...artifact, challenges };
}
