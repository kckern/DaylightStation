#!/usr/bin/env node
/**
 * `school worksheet` — the coursework path, on the command line.
 *
 * This namespace existed only inside the running app until now, which is why
 * it was easy to reach for `school docs` and get a sheet laid out the wrong
 * way. A course lesson's bank is `school.question-bank/v2`; it becomes a
 * printable sheet through the SAME domain functions the app uses:
 *
 *   <lesson-id>.yml (school.question-bank/v2)
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
 * A lesson argument may be either a path to a lesson bank YAML or a course-
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
  composedWorksheetDocument,
} from '#domains/school/questionBankV2.mjs';
import { validateQuestionBank } from '#domains/school/questionBankValidation.mjs';
import { worksheetPresentation } from '#domains/school/curriculum/worksheetPresentation.mjs';

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
  compose             render several lesson sections into one flowed PDF.

Options:
  --profile <p>       lower | upper (default: upper). Sets question count and
                      visible-choice count; both come from the domain.
  --learner <id>      learner id, part of the default seed (default: preview)
  --seed <s>          override the seed for a reproducible sheet
  --out <path>        (render) output PDF path — required
  --teacher           (render) append the answer key
  --lesson <id>       (compose) lesson id; repeat for multiple sections
  --sample <course:N> (compose) choose N lessons from a course; repeatable
  --data-dir <path>   data root (default: $DAYLIGHT_BASE_PATH/data)

Notes:
  Choice ORDER is shuffled by the domain, never authored. A bank that pins the
  answer to first position still renders shuffled.
  Sheets never print fillable bubbles — answers ride the physical OMR card.
  compose is preview-only: it creates no enrollment, session, code, instance,
  published artifact, or card allocation.  Use --seed to reproduce it.
`;

function repeatedFlagValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === `--${name}` && typeof argv[index + 1] === 'string' && !argv[index + 1].startsWith('--')) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

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
  // Compact packages store a one-artifact lesson as `<lessonId>.yml` with
  // metadata in `lesson:`. Rich packages retain a lesson directory whose
  // `_index.yml` identifies its worksheet. Search semantic identifiers instead
  // of rebuilding either physical layout from the requested lesson id.
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const candidate = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = visit(candidate);
        if (found) return found;
      } else if (/\.ya?ml$/u.test(entry.name)) {
        let raw;
        try { raw = yaml.load(fs.readFileSync(candidate, 'utf8')); } catch { continue; }
        if (raw?.lesson?.unitId === lesson) return candidate;
        if (['_index.yml', 'index.yml'].includes(entry.name) && raw?.unitId === lesson) {
          const worksheet = path.join(dir, 'worksheet.yml');
          if (fs.existsSync(worksheet)) return worksheet;
        }
      }
    }
    return null;
  };
  const compact = visit(courseRoot);
  if (compact) return compact;
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
 * A lesson's `_index.yml` already records which printed pages its reading
 * occupies; the sheet header is the natural place for them, so read them
 * rather than making the author repeat them in the bank.
 */
function lessonProvenance(bankFile) {
  const compact = yaml.load(fs.readFileSync(bankFile, 'utf8'))?.lesson;
  if (compact) {
    // The individual lesson provenance often records the extraction sidecar
    // (`… EPUB`) rather than the book a child holds. Prefer the course's
    // paper-source title for learner-facing output.
    const courseIndex = path.join(path.dirname(bankFile), '_index.yml');
    let courseSource = null;
    try { courseSource = yaml.load(fs.readFileSync(courseIndex, 'utf8'))?.source?.title ?? null; } catch { /* fall back */ }
    return {
      sourceTitle: courseSource ?? learnerSourceTitle(compact.provenance?.source),
      printedPages: compact.provenance?.printed_pages ?? [],
    };
  }
  const indexFile = ['_index.yml', 'index.yml'].map((name) => path.join(path.dirname(bankFile), name)).find(fs.existsSync);
  if (!indexFile) return { sourceTitle: null, printedPages: [] };
  const unit = yaml.load(fs.readFileSync(indexFile, 'utf8')) || {};
  return {
    sourceTitle: unit.provenance?.source ?? null,
    printedPages: unit.provenance?.printed_pages ?? [],
  };
}

function learnerSourceTitle(value) {
  if (typeof value !== 'string') return null;
  return value
    .replace(/\s+\b(?:EPUB|PDF|MOBI|HTML)\b/giu, '')
    .replace(/\.(?:epub|pdf|mobi|html?)$/iu, '')
    .trim() || null;
}

function lessonReading(bank, provenance) {
  // The authoring sidecar's `source.page` can be an EPUB XHTML filename
  // (`chapter042.xhtml`), not a page in the printed book. Only accept an
  // unambiguously human page reference here; printed_pages is the preferred,
  // curated field.
  const pages = (bank.items ?? [])
    .map((item) => String(item?.source?.page ?? '').trim())
    .filter((value) => /^(?:p(?:age)?\.?\s*)?\d+(?:\s*[,–-]\s*\d+)*$/iu.test(value))
    .flatMap((value) => value.match(/\d+/g) ?? [])
    .map(Number).filter(Number.isFinite);
  if (pages.length) {
    const unique = [...new Set(pages)].sort((a, b) => a - b);
    const label = unique.length === 1 ? `page ${unique[0]}` : `pages ${unique[0]}–${unique.at(-1)}`;
    return `Read: ${label}`;
  }
  if (Array.isArray(provenance.printedPages) && provenance.printedPages.length) {
    return `Read: pages ${provenance.printedPages.join(', ')}`;
  }
  // In a chapter-organised print book the lesson title is already the section
  // locator. A generic instruction adds noise, not information.
  return typeof bank.lesson?.reading === 'string' && bank.lesson.reading.trim()
    ? `Read: ${bank.lesson.reading.trim()}`
    : null;
}

function courseLabel(subject, course, dataDir) {
  const index = path.join(dataDir, 'content', 'school', subject, course, '_index.yml');
  try {
    const raw = yaml.load(fs.readFileSync(index, 'utf8'));
    return raw?.title ?? course.replaceAll('-', ' ');
  } catch {
    return course.replaceAll('-', ' ');
  }
}

function loadBank(file) {
  const bank = yaml.load(fs.readFileSync(file, 'utf8'));
  const result = validateQuestionBank(bank);
  return { bank, result };
}

function listCourseLessons(courseId, dataDir) {
  const [subject, course, ...extra] = String(courseId).split('/').filter(Boolean);
  if (!subject || !course || extra.length) return [];
  const root = path.join(dataDir, 'content', 'school', subject, course);
  const found = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.ya?ml$/u.test(entry.name)) {
        try {
          const raw = yaml.load(fs.readFileSync(file, 'utf8'));
          if (raw?.lesson?.unitId && raw?.schema === 'school.question-bank/v2') {
            found.push({ id: `${subject}/${course}/${raw.lesson.unitId}`, file, sequence: raw.lesson.sequence ?? Number.MAX_SAFE_INTEGER });
          }
        } catch { /* a malformed candidate is rejected when selected */ }
      }
    }
  };
  if (fs.existsSync(root)) visit(root);
  return found.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}

function sample(values, count, seed) {
  const random = (() => {
    let state = 0;
    for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 2654435761) >>> 0;
    return () => ((state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0) / 0x100000000);
  })();
  const pool = [...values];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, count);
}

function outputForPart(out, part, total) {
  if (total === 1) return path.resolve(out);
  const parsed = path.parse(path.resolve(out));
  return path.join(parsed.dir, `${parsed.name}-${String(part + 1).padStart(2, '0')}${parsed.ext || '.pdf'}`);
}

function chunksForCard(sections, capacity = 50) {
  const chunks = [];
  let current = [];
  let count = 0;
  for (const section of sections) {
    const size = section.instance.questions.length;
    if (size > capacity) throw new Error(`lesson '${section.title}' has ${size} questions, exceeding one OMR card`);
    if (current.length && count + size > capacity) {
      chunks.push(current); current = []; count = 0;
    }
    current.push(section); count += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
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

async function composePreview({ argv, flags, dataDir }) {
  const out = flags.out;
  if (!out || out === true) {
    process.stderr.write('ERROR: compose needs --out <path.pdf>\n');
    return EXIT_USAGE;
  }
  const profile = flags.profile && flags.profile !== true ? String(flags.profile) : 'upper';
  if (!PROFILES.includes(profile)) {
    process.stderr.write(`ERROR: --profile must be one of ${PROFILES.join('|')}\n`);
    return EXIT_USAGE;
  }
  const seed = flags.seed && flags.seed !== true ? String(flags.seed) : 'preview';
  const learner = flags.learner && flags.learner !== true ? String(flags.learner) : 'preview';
  const requested = repeatedFlagValues(argv, 'lesson');
  for (const spec of repeatedFlagValues(argv, 'sample')) {
    const split = spec.lastIndexOf(':');
    const courseId = split > 0 ? spec.slice(0, split) : '';
    const count = Number(spec.slice(split + 1));
    if (!courseId || !Number.isInteger(count) || count < 1) {
      process.stderr.write(`ERROR: --sample must be <subject/course>:<positive-count>, got '${spec}'\n`);
      return EXIT_USAGE;
    }
    const candidates = listCourseLessons(courseId, dataDir);
    if (candidates.length < count) {
      process.stderr.write(`ERROR: '${courseId}' has ${candidates.length} available lesson bank(s), cannot sample ${count}\n`);
      return EXIT_FAIL;
    }
    requested.push(...sample(candidates.map((candidate) => candidate.id), count, `${seed}:${spec}`));
  }
  if (!requested.length) {
    process.stderr.write('ERROR: compose needs one or more --lesson or --sample selections\n');
    return EXIT_USAGE;
  }

  const sections = [];
  for (let index = 0; index < requested.length; index += 1) {
    const target = requested[index];
    const file = resolveBankFile(target, dataDir);
    if (!file) {
      process.stderr.write(`ERROR: no worksheet bank found for '${target}' under ${dataDir}\n`);
      return EXIT_FAIL;
    }
    const { bank, result } = loadBank(file);
    if (!result.ok) {
      process.stderr.write(`FAILED ${file}\n${result.errors.map((error) => `  - ${error}`).join('\n')}\n`);
      return EXIT_FAIL;
    }
    const [subject, course] = target.split('/');
    const lessonId = bank.lesson?.unitId ?? bank.unit ?? path.basename(file, path.extname(file));
    const instance = createWorksheetInstance({
      id: `ws-cli-compose-${index + 1}`, sessionId: 'cli-preview', issuedAt: new Date(0).toISOString(),
      bank, learnerId: learner, enrollmentId: 'cli-preview', lessonId, profile, seed: `${seed}:${index + 1}`,
      worksheet: bank.lesson?.worksheet ?? null,
    });
    const provenance = lessonProvenance(file);
    const presentation = worksheetPresentation({ unit: bank.lesson });
    sections.push({
      id: `section-${index + 1}`, instance,
      subject: subject.replaceAll('-', ' '), subjectId: subject,
      course: courseLabel(subject, course, dataDir), courseId: course,
      breadcrumb: [subject, ...(bank.topics ?? []).slice(0, 2)].map((part) => String(part).replaceAll('-', ' ').toUpperCase()).join(' › '),
      title: bank.title || lessonId,
      sourceTitle: presentation.sourceTitle ?? provenance.sourceTitle,
      printedPages: presentation.printedPages.length ? presentation.printedPages : provenance.printedPages,
      reading: presentation.reading ?? lessonReading(bank, provenance),
      passPercent: bank.lesson?.passing?.percent ?? null,
    });
  }

  const chunks = chunksForCard(sections);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'school-worksheet-compose-'));
  const outputs = [];
  try {
    const docs = await import('./docs.mjs');
    for (let index = 0; index < chunks.length; index += 1) {
      const composed = composedWorksheetDocument({
        id: `ws-cli-compose-${index + 1}`, seed: `${seed}:${index + 1}`,
        // The composed document deliberately suppresses its generic title:
        // each lesson card is the usable orientation header.
        title: 'Worksheet',
        subtitle: chunks.length > 1 ? `Part ${index + 1} of ${chunks.length}` : null,
        sections: chunks[index],
      });
      const sourceFile = path.join(scratch, `part-${index + 1}.yml`);
      fs.writeFileSync(sourceFile, yaml.dump(composed.source, { lineWidth: 120, noRefs: true }), 'utf8');
      const output = outputForPart(out, index, chunks.length);
      const args = ['render', sourceFile, '--out', output, '--data-dir', dataDir, '--content-root', scratch, '--source-root', scratch, '--preview-card', '1234567'];
      if (flags.teacher === true) args.push('--teacher');
      if (flags['learner-name'] && flags['learner-name'] !== true) args.push('--learner-name', String(flags['learner-name']));
      if (flags.date && flags.date !== true) args.push('--date', String(flags.date));
      const code = await docs.main(args);
      if (code !== EXIT_OK) return code;
      outputs.push({ out: output, sections: chunks[index].map((section) => section.instance.lessonId), questions: chunks[index].reduce((sum, section) => sum + section.instance.questions.length, 0) });
    }
    process.stdout.write(`${JSON.stringify({ outputs, profile, preview: true })}\n`);
    return EXIT_OK;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { subcommand, positional, flags, help } = parseArgv(argv);
  if (help || !subcommand) {
    process.stdout.write(HELP);
    return help ? EXIT_OK : EXIT_USAGE;
  }
  if (!['validate', 'issue', 'render', 'compose'].includes(subcommand)) {
    process.stderr.write(`Unknown command: ${subcommand}\n\n`);
    process.stdout.write(HELP);
    return EXIT_USAGE;
  }

  const dataDir = dataRoot(flags['data-dir']);
  if (subcommand === 'compose') return composePreview({ argv, flags, dataDir });

  const target = positional[0];
  if (!target) {
    process.stderr.write('ERROR: name a lesson or a worksheet.yml path\n');
    return EXIT_USAGE;
  }
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
    const authoredGrades = Array.isArray(bank.lesson?.grades) ? bank.lesson.grades : [];
    const profiles = authoredGrades.length ? PROFILES.filter((profile) => authoredGrades.includes(profile)) : PROFILES;
    for (const profile of profiles) {
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
    process.stdout.write(`OK  ${file}\n  ${bank.items.length} items; profiles ${profiles.join(', ')} issue\n`);
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
    worksheet: bank.lesson?.worksheet ?? null,
  });
  const provenance = lessonProvenance(file);
  const presentation = worksheetPresentation({ unit: bank.lesson });
  const source = worksheetInstanceDocument(instance, {
    title: bank.title || lessonId,
    sourceTitle: presentation.sourceTitle ?? provenance.sourceTitle,
    printedPages: presentation.printedPages.length ? presentation.printedPages : provenance.printedPages,
    reading: presentation.reading,
    subjectIcon: bank.subject ?? target.split('/').filter(Boolean)[0] ?? 'school',
    subjectName: bank.subject ? bank.subject[0].toUpperCase() + bank.subject.slice(1) : null,
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
