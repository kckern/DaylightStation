#!/usr/bin/env node
/**
 * cli/school/koreanVocab.mjs — `school korean-vocab` — word-ladder operations.
 *
 *   quiz         write the printed quiz SOURCE for a lexicon deck
 *                (then: `school docs publish <file>`, render with variety=omr)
 *   enroll-plan  write an `ops assign` plan file adding the word-ladder
 *                program to a learner's CURRENT assignment (then:
 *                `school ops assign <learner> --file <plan> … --apply`)
 *
 * A composition root: adapters are wired here, the rules are in
 * `#domains/school/wordLadder`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { YamlLearningContentRepository } from '#adapters/school/catalog/YamlLearningContentRepository.mjs';
import { YamlLexiconRepository } from '#adapters/school/catalog/YamlLexiconRepository.mjs';
import { LexiconDeckLoader } from '#adapters/school/catalog/LexiconDeckLoader.mjs';
import { buildWordQuizSource, hashString } from '#domains/school/wordLadder/index.mjs';

const ENTRYPOINT = fileURLToPath(import.meta.url);
const DEFAULT_BASE_URL = process.env.SCHOOL_BASE_URL || 'http://localhost:3111/api/v1/school';
const HELP = `school korean-vocab — word-ladder operations

Usage:
  school.mjs korean-vocab quiz --deck <deckId|slug> [--seed N] [--force]
                               [--data-dir P] [--media-dir P] [--source-root P]
  school.mjs korean-vocab enroll-plan --learner <id> --deck <deckId|slug> --out <file>
                               [--title TEXT] [--base-url URL]

A bare slug resolves to language/korean/<slug>.
quiz writes <source-root>/<deckId>-quiz.yml (default source root:
content/school/learning-catalog/documents under --data-dir). An identical file
is left alone; a different one is refused unless --force.
enroll-plan reads GET <base-url>/lifecycle/assignments/<learner> and writes a
plan for 'school ops assign' with the word-ladder program appended (or
replacing that learner's existing word-ladder program).
`;

export function resolveDeckId(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('--deck is required');
  return value.includes('/') ? value.trim() : `language/korean/${value.trim()}`;
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}

function roots(argv, env = process.env) {
  const base = env.DAYLIGHT_BASE_PATH || '/usr/src/app';
  const dataDir = path.resolve(option(argv, '--data-dir') ?? path.join(base, 'data'));
  const mediaDir = path.resolve(option(argv, '--media-dir') ?? path.join(base, 'media'));
  const sourceRoot = path.resolve(dataDir, option(argv, '--source-root') ?? 'content/school/learning-catalog/documents');
  return { dataDir, mediaDir, sourceRoot };
}

async function quiz(argv, io) {
  const deckId = resolveDeckId(option(argv, '--deck'));
  const { dataDir, mediaDir, sourceRoot } = roots(argv);
  const lexicons = new YamlLexiconRepository({ mediaRoot: path.join(mediaDir, 'school') });
  const decks = new LexiconDeckLoader({
    content: new YamlLearningContentRepository({
      documentDirectories: [path.join(dataDir, 'content/school/learning-catalog/documents')],
      bankDirectories: [path.join(dataDir, 'content/school/learning-catalog/question-banks')],
      deckDirectories: [path.join(dataDir, 'content/school/learning-catalog/flashcard-decks')],
    }),
    lexicons,
  });
  const deck = await decks.getFlashcardDeck(deckId);
  if (!deck || !Array.isArray(deck.words)) throw new Error(`'${deckId}' is not a lexicon deck`);
  const seedFlag = option(argv, '--seed');
  const seed = seedFlag !== undefined ? Number(seedFlag) : hashString(deckId) % 100000;
  if (!Number.isInteger(seed) || seed < 0) throw new Error('--seed must be a whole number');
  const source = buildWordQuizSource({ deck, lexicon: lexicons.getLexicon(deck.lexicon), seed });
  const file = path.join(sourceRoot, `${source.id}.yml`);
  const text = yaml.dump(source, { lineWidth: -1, noRefs: true });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') === text) { io.stdout.write(`unchanged: ${file}\n`); return 0; }
    if (!argv.includes('--force')) { io.stderr.write(`${file} differs; pass --force to overwrite\n`); return 1; }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  io.stdout.write(`wrote ${file}\nnext: node cli/school.mjs docs publish ${path.relative(sourceRoot, file)}\n`);
  return 0;
}

export function buildEnrollPlan(current, { deckId, title = 'Korean words' }) {
  const programs = (current?.programs ?? []).filter((row) => !(row?.programId === 'flashcards' && row.policy?.mode === 'word-ladder'));
  programs.push({
    programId: 'flashcards', deckId, ...(title ? { title } : {}),
    policy: { mode: 'word-ladder' }, schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
  });
  return { courses: current?.courses ?? [], units: current?.units ?? [], programs };
}

async function enrollPlan(argv, io, fetchImpl = globalThis.fetch) {
  const learner = option(argv, '--learner');
  const out = option(argv, '--out');
  if (!learner || !out) throw new Error('enroll-plan requires --learner and --out');
  const deckId = resolveDeckId(option(argv, '--deck'));
  const baseUrl = (option(argv, '--base-url') ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const response = await fetchImpl(`${baseUrl}/lifecycle/assignments/${encodeURIComponent(learner)}`);
  if (!response.ok) throw new Error(`could not read ${learner}'s assignment (HTTP ${response.status})`);
  const plan = buildEnrollPlan(await response.json(), { deckId, title: option(argv, '--title') ?? 'Korean words' });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, yaml.dump(plan, { lineWidth: -1, noRefs: true }), 'utf8');
  io.stdout.write(`wrote ${out} (${plan.programs.length} programs)\n`);
  return 0;
}

export async function main(argv = process.argv.slice(2), io = process, deps = {}) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') { io.stdout.write(HELP); return command ? 0 : 2; }
  try {
    if (command === 'quiz') return await quiz(rest, io);
    if (command === 'enroll-plan') return await enrollPlan(rest, io, deps.fetch);
    io.stderr.write(HELP);
    return 2;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main().then((code) => { process.exitCode = code; });
}
