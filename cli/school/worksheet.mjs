#!/usr/bin/env node
/**
 * `school worksheet` — the coursework path, on the command line.
 *
 * This namespace existed only inside the running app until now, which is why
 * it was easy to reach for `school docs` and get a sheet laid out the wrong
 * way. A course lesson's bank is `school.question-bank/v2`; it becomes a
 * printable sheet through the SAME domain functions the app uses:
 *
 *   worksheet.yml (school.question-bank/v2)
 *     -> issueWorksheet()            pick items for a profile, SHUFFLE choices
 *     -> worksheetInstanceDocument() emit the print document
 *     -> DocumentPdfRenderer         render, choices inline ("A. A pure heart")
 *
 * Nothing here re-implements selection, shuffling or layout — that all lives
 * in `#domains/school/questionBankV2.mjs`. This file resolves a lesson to its
 * bank, calls those functions, and writes bytes.
 *
 * Profiles come from the domain, not from flags:
 *   lower  6 questions, 3-4 visible choices, no multi-select
 *   upper  10 questions, 5 visible choices, 1-2 multi-select
 *
 * Commands:
 *   validate <lesson|bank>   parse + validateQuestionBank; render-free
 *   issue <lesson|bank>      issue one worksheet, print it as JSON/text
 *   render <lesson|bank>     issue and write a PDF (--out required)
 *
 * A lesson argument may be either a path to a worksheet.yml or a course-
 * relative lesson id (`<subject>/<course>/<lesson>`), resolved against the
 * school content tree.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { parseArgv } from '../_argv.mjs';
import {
  issueWorksheet,
  createWorksheetInstance,
  worksheetInstanceDocument,
} from '#domains/school/questionBankV2.mjs';
import { validateQuestionBank } from '#domains/school/questionBankValidation.mjs';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const PROFILES = ['lower', 'upper'];

const HELP = `school worksheet — issue a course lesson worksheet

Usage:
  node cli/school.mjs worksheet <command> <lesson> [options]

Commands:
  validate <lesson>   parse the bank and run validateQuestionBank. Render-free.
  issue <lesson>      issue one worksheet and report its questions + key.
  render <lesson>     issue one worksheet and write a PDF.

Options:
  --profile <p>       lower | upper (default: upper). Sets question count and
                      visible-choice count; both come from the domain.
  --learner <id>      learner id, part of the default seed (default: preview)
  --seed <s>          override the seed for a reproducible sheet
  --out <path>        (render) output PDF path — required
  --teacher           (render) append the answer key
  --data-dir <path>   data root (default: $DAYLIGHT_BASE_PATH/data)

Notes:
  Choice ORDER is shuffled by the domain, never authored. A bank that pins the
  answer to first position still renders shuffled.
  Sheets never print fillable bubbles — answers ride the physical OMR card.
`;

function dataRoot(flag) {
  if (flag && flag !== true) return path.resolve(flag);
  if (process.env.DAYLIGHT_BASE_PATH) return path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  return path.join(process.cwd(), 'data');
}

/**
 * A lesson may arrive as a direct path or as `<subject>/<course>/<lesson>`.
 * The id form is searched under the school content tree rather than guessed,
 * so a renamed unit folder surfaces as "not found" instead of a wrong bank.
 */
export function resolveBankFile(target, dataDir) {
  if (target.endsWith('.yml') || target.endsWith('.yaml')) {
    const direct = path.resolve(target);
    if (fs.existsSync(direct)) return direct;
  }
  const parts = target.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [subject, course, ...restId] = parts;
  const courseRoot = path.join(dataDir, 'content', 'school', subject, course);
  if (!fs.existsSync(courseRoot)) return null;
  const lesson = restId.join('/');
  const unitsRoot = path.join(courseRoot, 'units');
  if (!fs.existsSync(unitsRoot)) return null;
  for (const unit of fs.readdirSync(unitsRoot)) {
    const lessonsRoot = path.join(unitsRoot, unit, 'lessons');
    if (!fs.existsSync(lessonsRoot)) continue;
    for (const dir of fs.readdirSync(lessonsRoot)) {
      if (lesson && dir !== lesson) continue;
      const candidate = path.join(lessonsRoot, dir, 'worksheet.yml');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * A lesson's `index.yml` already records which printed pages its reading
 * occupies; the sheet header is the natural place for them, so read them
 * rather than making the author repeat them in the bank.
 */
function lessonProvenance(bankFile) {
  const indexFile = path.join(path.dirname(bankFile), 'index.yml');
  if (!fs.existsSync(indexFile)) return { sourceTitle: null, printedPages: [] };
  const unit = yaml.load(fs.readFileSync(indexFile, 'utf8')) || {};
  return {
    sourceTitle: unit.provenance?.source ?? null,
    printedPages: unit.provenance?.printed_pages ?? [],
  };
}

function loadBank(file) {
  const bank = yaml.load(fs.readFileSync(file, 'utf8'));
  const result = validateQuestionBank(bank);
  return { bank, result };
}

function issue({ bank, profile, learner, seed, lessonId }) {
  return issueWorksheet({
    bank,
    learnerId: learner,
    enrollmentId: 'cli-preview',
    lessonId,
    profile,
    seed,
  });
}

export async function main(argv = process.argv.slice(2)) {
  const { subcommand, positional, flags, help } = parseArgv(argv);
  if (help || !subcommand) {
    process.stdout.write(HELP);
    return help ? EXIT_OK : EXIT_USAGE;
  }
  if (!['validate', 'issue', 'render'].includes(subcommand)) {
    process.stderr.write(`Unknown command: ${subcommand}\n\n`);
    process.stdout.write(HELP);
    return EXIT_USAGE;
  }

  const target = positional[0];
  if (!target) {
    process.stderr.write('ERROR: name a lesson or a worksheet.yml path\n');
    return EXIT_USAGE;
  }
  const dataDir = dataRoot(flags['data-dir']);
  const file = resolveBankFile(target, dataDir);
  if (!file) {
    process.stderr.write(`ERROR: no worksheet bank found for '${target}' under ${dataDir}\n`);
    return EXIT_FAIL;
  }

  const { bank, result } = loadBank(file);
  if (!result.ok) {
    process.stderr.write(`FAILED ${file}\n`);
    for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
    return EXIT_FAIL;
  }
  if (subcommand === 'validate') {
    // `validateQuestionBank` alone is too loose to be useful here: it accepts
    // shapes `issueWorksheet` cannot consume, so a bank could validate and
    // then fail to issue with an internal TypeError. Prove BOTH profiles
    // actually issue — that is what "valid" has to mean for a lesson bank.
    const problems = [];
    if (bank.schema !== 'school.question-bank/v2') {
      problems.push(`schema is ${bank.schema ?? 'absent'}; a lesson bank must be school.question-bank/v2`);
    }
    for (const profile of PROFILES) {
      try {
        issue({ bank, profile, learner: 'validate', seed: 'validate', lessonId: bank.unit || 'validate' });
      } catch (err) {
        problems.push(`profile '${profile}': ${err.message}`);
      }
    }
    if (problems.length) {
      process.stderr.write(`FAILED ${file}\n`);
      for (const p of problems) process.stderr.write(`  - ${p}\n`);
      return EXIT_FAIL;
    }
    process.stdout.write(`OK  ${file}\n  ${bank.items.length} items; both profiles issue\n`);
    return EXIT_OK;
  }

  const profile = flags.profile && flags.profile !== true ? String(flags.profile) : 'upper';
  if (!PROFILES.includes(profile)) {
    process.stderr.write(`ERROR: --profile must be one of ${PROFILES.join('|')}\n`);
    return EXIT_USAGE;
  }
  const learner = flags.learner && flags.learner !== true ? String(flags.learner) : 'preview';
  const seed = flags.seed && flags.seed !== true ? String(flags.seed) : undefined;
  const lessonId = bank.unit || path.basename(path.dirname(file));

  let worksheet;
  try {
    worksheet = issue({ bank, profile, learner, seed, lessonId });
  } catch (err) {
    // The domain throws when a profile cannot be satisfied — too few eligible
    // items, or more correct answers than visible choices. Report it as the
    // authoring problem it is.
    process.stderr.write(`FAILED to issue a '${profile}' worksheet from ${file}\n  - ${err.message}\n`);
    return EXIT_FAIL;
  }

  if (subcommand === 'issue') {
    // `issueWorksheet` returns `items`, each option already carrying the
    // letter the sheet will print — never re-letter them here, or the CLI
    // preview and the PDF could disagree.
    const items = worksheet.items ?? [];
    process.stdout.write(`${file}\n  profile ${profile} · ${items.length} questions\n\n`);
    items.forEach((q, i) => {
      process.stdout.write(`  ${i + 1}. ${q.prompt}\n`);
      for (const opt of q.options ?? []) {
        process.stdout.write(`       ${opt.letter}. ${opt.label}${opt.correct ? '   <- key' : ''}\n`);
      }
      process.stdout.write('\n');
    });
    const key = items.map((q) => (q.options ?? []).filter((o) => o.correct).map((o) => o.letter).join('')).join(' ');
    process.stdout.write(`  key: ${key}\n`);
    return EXIT_OK;
  }

  const out = flags.out;
  if (!out || out === true) {
    process.stderr.write('ERROR: render needs --out <path.pdf>\n');
    return EXIT_USAGE;
  }

  // The two pipelines JOIN here: an issued instance becomes a
  // `school.document-source/v1`, which publish compiles into the printable
  // document plus its derived answer bank. Rendering the source directly
  // would skip the bank the choice text is read from.
  const issuedAt = flags['issued-at'] && flags['issued-at'] !== true
    ? String(flags['issued-at'])
    : new Date(0).toISOString();
  const instance = createWorksheetInstance({
    id: `ws-cli-${lessonId}-${profile}`,
    sessionId: 'cli-preview',
    issuedAt,
    bank,
    learnerId: learner,
    enrollmentId: 'cli-preview',
    lessonId,
    profile,
    seed,
  });
  const provenance = lessonProvenance(file);
  const source = worksheetInstanceDocument(instance, {
    title: bank.title || lessonId,
    sourceTitle: provenance.sourceTitle,
    printedPages: provenance.printedPages,
  });

  // Rendering is NOT reimplemented here. The issued instance is a
  // `school.document-source/v1`, which is exactly what `school docs render`
  // already takes — and that path is the tested one (publish, fit, card
  // attachment, teacher key). Write the source to a scratch file and hand it
  // over, so there is only ever one renderer wiring in this CLI.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'school-worksheet-'));
  try {
    const sourceFile = path.join(scratch, `${instance.id}.yml`);
    fs.writeFileSync(sourceFile, yaml.dump(source, { lineWidth: 120, noRefs: true }), 'utf8');
    const docs = await import('./docs.mjs');
    const argvOut = [
      'render', sourceFile,
      '--out', path.resolve(out),
      '--data-dir', dataDir,
      '--content-root', scratch,
      '--source-root', scratch,
    ];
    if (flags.teacher === true) argvOut.push('--teacher');
    if (flags['learner-name'] && flags['learner-name'] !== true) {
      argvOut.push('--learner-name', String(flags['learner-name']));
    }
    if (flags.date && flags.date !== true) argvOut.push('--date', String(flags.date));
    const code = await docs.main(argvOut);
    if (code === EXIT_OK) {
      process.stdout.write(`${JSON.stringify({
        out: path.resolve(out), profile, questions: instance.questions.length,
      })}\n`);
    }
    return code;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return EXIT_OK;
}

const ENTRYPOINT = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`${err.stack || err.message}\n`);
      process.exit(EXIT_FAIL);
    });
}
