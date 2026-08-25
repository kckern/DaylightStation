#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfigService } from '../_bootstrap.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedRoot = path.resolve(here, '../../content/seeds/school/flashcards');
const HELP = `school-flashcards — install tracked example decks\n\nUsage:\n  school.mjs flashcards install-seeds [--data-dir <path>]\n\nInstalls missing seed files into content/school/learning-catalog/flashcard-decks.\nExisting byte-identical files are skipped; conflicting files are never overwritten.\n`;

export async function installSeeds({ dataDir, stdout = process.stdout } = {}) {
  const destination = path.join(dataDir, 'content', 'school', 'learning-catalog', 'flashcard-decks');
  const sources = fs.readdirSync(seedRoot, { recursive: true }).filter((entry) => entry.endsWith('.yml')).sort();
  const result = { installed: [], skipped: [], conflicts: [] };
  for (const relative of sources) {
    const source = path.join(seedRoot, relative); const target = path.join(destination, relative);
    const bytes = fs.readFileSync(source);
    if (fs.existsSync(target)) {
      if (Buffer.compare(bytes, fs.readFileSync(target)) === 0) result.skipped.push(relative);
      else result.conflicts.push(relative);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); result.installed.push(relative);
  }
  stdout.write(`flashcard seeds: ${result.installed.length} installed, ${result.skipped.length} unchanged, ${result.conflicts.length} conflicts\n`);
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h') || !argv.length) { process.stdout.write(HELP); return argv.length ? 0 : 2; }
  if (argv[0] !== 'install-seeds') { process.stderr.write(HELP); return 2; }
  const index = argv.indexOf('--data-dir'); const dataDir = index >= 0 ? argv[index + 1] : (await getConfigService()).getDataDir();
  if (index >= 0 && !dataDir) { process.stderr.write('--data-dir requires a value\n'); return 2; }
  const result = await installSeeds({ dataDir: path.resolve(dataDir) });
  if (result.conflicts.length) { process.stderr.write(`refused to overwrite: ${result.conflicts.join(', ')}\n`); return 1; }
  return 0;
}
