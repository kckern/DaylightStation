#!/usr/bin/env node
/**
 * Read-only audit for the answer-length cue covered by
 * data/content/school/README.md.  It deliberately never edits a bank or its
 * audit record: authoring happens in staging, while this command is the
 * repeatable release gate.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { parseArgv } from '../_argv.mjs';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const RELEASE_TRIALS = 200000;
const DISCOVERY_TRIALS = 20000;
const FINGERPRINT_SCHEMA = 'school.decoy-audit-input/v1';
const MAX_PAIRED_WORD_DIFFERENCE = 1;
const MAX_PAIRED_CHARACTER_DIFFERENCE = 5;
const MAX_UNIQUE_CORRECT_LENGTH_EXTREME_RATE = 0.4;
export const PRACTICAL_LENGTH_AUDIT_METHOD = 'Practical paired-length guardrails: absolute mean answer-minus-decoy difference at most 1 word and 5 visible characters; answer is uniquely longest or shortest in at most 40% of pools per metric.';

const HELP = `school-decoys — read-only audit of multiple-choice answer/decoy cues

Usage:
  school.mjs decoys audit <subject/course|all> [--data-dir <path>] [--trials <n>] [--json]
  school.mjs decoys verify <subject/course> [--data-dir <path>] [--trials <n>] [--json]

audit reads only live worksheet.yml files. It measures each classic
single-answer multiple-choice item as one paired observation: its answer
against the mean of its own decoys. A course passes when mean answer/decoy
length differs by no more than 1 word and 5 visible characters, and the
answer is not a unique length extreme in more than 40% of pools. Deterministic
sign-permutation p-values remain diagnostic, not release gates. Release audits
use 200,000 permutations by default; an all-school discovery scan uses 20,000.

verify additionally checks <course>/decoy-audit.yml has a passing status and
matches the live choice-pool fingerprint.  It never modifies that record.
`;

function dataRoot(flag) {
  if (flag && flag !== true) return path.resolve(flag);
  if (process.env.DAYLIGHT_BASE_PATH) return path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  return path.join(process.cwd(), 'data');
}

function isIgnoredDirectory(name) {
  const lower = name.toLowerCase();
  return name.startsWith('.') || lower.startsWith('_') || lower.includes('.pre-')
    || lower.includes('backup') || lower.includes('staging');
}

function listCourseIds(contentRoot) {
  if (!fs.existsSync(contentRoot)) return [];
  const ids = [];
  for (const subject of fs.readdirSync(contentRoot, { withFileTypes: true })) {
    if (!subject.isDirectory() || isIgnoredDirectory(subject.name)) continue;
    const subjectPath = path.join(contentRoot, subject.name);
    for (const course of fs.readdirSync(subjectPath, { withFileTypes: true })) {
      if (!course.isDirectory() || isIgnoredDirectory(course.name)) continue;
      // Authored courses use _index.yml, while compatibility supports index.yml
      // and a small legacy set uses
      // course.yml. Include both so an all-school audit matches the catalog.
      const coursePath = path.join(subjectPath, course.name);
      if (fs.existsSync(path.join(coursePath, '_index.yml')) || fs.existsSync(path.join(coursePath, 'index.yml')) || fs.existsSync(path.join(coursePath, 'course.yml'))) {
        ids.push(`${subject.name}/${course.name}`);
      }
    }
  }
  return ids.sort();
}

function listWorksheetFiles(courseRoot) {
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!isIgnoredDirectory(entry.name)) visit(path.join(dir, entry.name));
      } else if (entry.isFile() && (entry.name === 'worksheet.yml' || /\.ya?ml$/u.test(entry.name))) {
        const file = path.join(dir, entry.name);
        if (entry.name === 'worksheet.yml') files.push(file);
        else {
          try {
            if (yaml.load(fs.readFileSync(file, 'utf8'))?.lesson) files.push(file);
          } catch {
            // Let analyzeCourse report a compact lesson's parse error with its
            // normal bank-validation diagnostics rather than hiding the file.
            files.push(file);
          }
        }
      }
    }
  };
  if (fs.existsSync(courseRoot)) visit(courseRoot);
  return files.sort();
}

function wordCount(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/**
 * Count characters learners can actually see.  Math choices are authored in
 * TeX, where source punctuation and command names (for example `\\times`)
 * are not visible answer text.  Leaving that markup in the metric would make
 * mathematically equivalent choice shapes look artificially different.
 */
function characterCount(value) {
  const renderMath = (math) => {
    let rendered = math;
    // Resolve the common nested-free forms first; repeating handles a simple
    // fraction inside a numerator or denominator without pretending to be a
    // general TeX renderer.
    let prior;
    do {
      prior = rendered;
      rendered = rendered.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/gu, '$1/$2');
      rendered = rendered.replace(/\\sqrt\{([^{}]*)\}/gu, '√($1)');
      rendered = rendered.replace(/\{([^{}]*)\}/gu, '$1');
    } while (rendered !== prior);
    return rendered
      .replace(/\\times|\\cdot/gu, '×')
      .replace(/\\div/gu, '÷')
      .replace(/\\leq|\\le/gu, '≤')
      .replace(/\\geq|\\ge/gu, '≥')
      .replace(/\\neq/gu, '≠')
      .replace(/\\pm/gu, '±')
      .replace(/\\degree/gu, '°')
      .replace(/[\\^_]/gu, '');
  };
  const visible = String(value ?? '').trim().replace(/\$([^$]*)\$/gu, (_match, math) => renderMath(math));
  return Array.from(visible).length;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

/** Stable, dependency-free PRNG so reports do not flicker between identical runs. */
function seededRandom(seedText) {
  let state = 2166136261;
  for (const char of seedText) {
    state ^= char.codePointAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export function pairedPermutationP(differences, trials, seed) {
  if (!differences.length) return 1;
  const observed = Math.abs(differences.reduce((sum, value) => sum + value, 0));
  const random = seededRandom(seed);
  let extreme = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    let sum = 0;
    for (const difference of differences) sum += random() < 0.5 ? difference : -difference;
    if (Math.abs(sum) >= observed - 1e-12) extreme += 1;
  }
  return (extreme + 1) / (trials + 1);
}

function classicItem(item) {
  return item?.type === 'multiple_choice' && typeof item.answer === 'string'
    && Array.isArray(item.decoys) && item.decoys.length > 0
    && item.decoys.every((decoy) => typeof decoy === 'string' && decoy.trim().length > 0);
}

function canonicalPools(courseId, pools) {
  return JSON.stringify({
    schema: FINGERPRINT_SCHEMA,
    course: courseId,
    items: pools.map((pool) => ({
      bank: pool.bank,
      id: pool.id,
      answer: pool.answer,
      decoys: pool.decoys,
    })),
  });
}

function metricSummary(pools, metric, trials, fingerprint) {
  const answerValues = pools.map((pool) => metric(pool.answer));
  const decoyMeans = pools.map((pool) => mean(pool.decoys.map(metric)));
  const differences = answerValues.map((answer, index) => answer - decoyMeans[index]);
  const uniqueCorrectLongest = pools.filter((pool) => metric(pool.answer) > Math.max(...pool.decoys.map(metric))).length;
  const uniqueCorrectShortest = pools.filter((pool) => metric(pool.answer) < Math.min(...pool.decoys.map(metric))).length;
  return {
    answerMean: Number(mean(answerValues).toFixed(4)),
    answerMedian: median(answerValues),
    decoyMean: Number(mean(decoyMeans).toFixed(4)),
    decoyMedian: median(decoyMeans),
    pairedDifference: Number(mean(differences).toFixed(4)),
    permutationP: pairedPermutationP(differences, trials, `${fingerprint}:${metric.name}:${trials}`),
    uniqueCorrectLongest,
    uniqueCorrectLongestRate: Number((uniqueCorrectLongest / pools.length).toFixed(4)),
    uniqueCorrectShortest,
    uniqueCorrectShortestRate: Number((uniqueCorrectShortest / pools.length).toFixed(4)),
    differences,
  };
}

export function analyzeCourse({ courseId, courseRoot, trials = RELEASE_TRIALS }) {
  const pools = [];
  const skipped = {};
  const issues = [];
  const banks = listWorksheetFiles(courseRoot);
  for (const file of banks) {
    const relative = path.relative(courseRoot, file);
    let bank;
    try {
      bank = yaml.load(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      issues.push(`${relative}: ${error.message}`);
      continue;
    }
    if (bank?.schema !== 'school.question-bank/v2' || !Array.isArray(bank.items)) {
      issues.push(`${relative}: expected school.question-bank/v2 items`);
      continue;
    }
    for (const item of bank.items) {
      if (classicItem(item)) {
        pools.push({ bank: relative, id: item.id, answer: item.answer.trim(), decoys: item.decoys.map((value) => value.trim()) });
      } else {
        const type = item?.type || 'unknown';
        skipped[type] = (skipped[type] ?? 0) + 1;
      }
    }
  }
  const fingerprint = crypto.createHash('sha256').update(canonicalPools(courseId, pools)).digest('hex');
  if (!pools.length) {
    return { course: courseId, banks: banks.length, items: 0, skipped, issues: [...issues, 'no classic multiple-choice pools found'], fingerprint, trials, pass: false };
  }
  const words = metricSummary(pools, wordCount, trials, fingerprint);
  const characters = metricSummary(pools, characterCount, trials, fingerprint);
  const inspect25PercentSkew = pools.flatMap((pool) => {
    const answerWords = wordCount(pool.answer);
    const longestDecoyWords = Math.max(...pool.decoys.map(wordCount));
    const shortestDecoyWords = Math.min(...pool.decoys.map(wordCount));
    const answerCharacters = characterCount(pool.answer);
    const longestDecoyCharacters = Math.max(...pool.decoys.map(characterCount));
    const shortestDecoyCharacters = Math.min(...pool.decoys.map(characterCount));
    const wordLonger = answerWords >= longestDecoyWords * 1.25 && answerWords > longestDecoyWords;
    const wordShorter = answerWords * 1.25 <= shortestDecoyWords && answerWords < shortestDecoyWords;
    const characterLonger = answerCharacters >= longestDecoyCharacters * 1.25 && answerCharacters > longestDecoyCharacters;
    const characterShorter = answerCharacters * 1.25 <= shortestDecoyCharacters && answerCharacters < shortestDecoyCharacters;
    return wordLonger || wordShorter || characterLonger || characterShorter
      ? [{ bank: pool.bank, item: pool.id, wordLonger, wordShorter, characterLonger, characterShorter }] : [];
  });
  const gates = {
    pairedWordDifference_abs_lte_1: Math.abs(words.pairedDifference) <= MAX_PAIRED_WORD_DIFFERENCE,
    pairedCharacterDifference_abs_lte_5: Math.abs(characters.pairedDifference) <= MAX_PAIRED_CHARACTER_DIFFERENCE,
    correctUniqueLengthExtremeRate_lte_0_40: words.uniqueCorrectLongestRate <= MAX_UNIQUE_CORRECT_LENGTH_EXTREME_RATE
      && words.uniqueCorrectShortestRate <= MAX_UNIQUE_CORRECT_LENGTH_EXTREME_RATE
      && characters.uniqueCorrectLongestRate <= MAX_UNIQUE_CORRECT_LENGTH_EXTREME_RATE
      && characters.uniqueCorrectShortestRate <= MAX_UNIQUE_CORRECT_LENGTH_EXTREME_RATE,
    parse: issues.length === 0,
  };
  return {
    schema: 'school.decoy-audit-report/v1', course: courseId, banks: banks.length, items: pools.length,
    skipped, issues, fingerprint, trials, words: { ...words, differences: undefined },
    characters: { ...characters, differences: undefined }, inspect25PercentSkew, gates,
    pass: Object.values(gates).every(Boolean),
  };
}

function reportText(result) {
  const lines = [`${result.course}: ${result.pass ? 'PASS' : 'FAIL'}`, `  banks ${result.banks}; classic pools ${result.items}; trials ${result.trials}`, `  fingerprint ${result.fingerprint}`];
  if (result.words) {
    lines.push(`  words: paired ${result.words.pairedDifference}; p=${result.words.permutationP} (diagnostic); unique-correct-longest ${(result.words.uniqueCorrectLongestRate * 100).toFixed(2)}%; shortest ${(result.words.uniqueCorrectShortestRate * 100).toFixed(2)}%`);
    lines.push(`  characters: paired ${result.characters.pairedDifference}; p=${result.characters.permutationP} (diagnostic); unique-correct-longest ${(result.characters.uniqueCorrectLongestRate * 100).toFixed(2)}%; shortest ${(result.characters.uniqueCorrectShortestRate * 100).toFixed(2)}%`);
    lines.push(`  inspect >=25% length skew: ${result.inspect25PercentSkew.length}`);
  }
  if (Object.keys(result.skipped).length) lines.push(`  non-classic pools: ${JSON.stringify(result.skipped)}`);
  for (const issue of result.issues) lines.push(`  ERROR: ${issue}`);
  return lines.join('\n');
}

function readAuditRecord(courseRoot) {
  const file = path.join(courseRoot, 'decoy-audit.yml');
  if (!fs.existsSync(file)) return { error: `missing ${file}` };
  try { return { record: yaml.load(fs.readFileSync(file, 'utf8')), file }; } catch (error) { return { error: `${file}: ${error.message}` }; }
}

export function verifyCourse(result, courseRoot) {
  const loaded = readAuditRecord(courseRoot);
  if (loaded.error) return { ...result, verification: { pass: false, errors: [loaded.error] }, pass: false };
  const record = loaded.record ?? {};
  const errors = [];
  if (record.schema !== 'school.decoy-audit/v1') errors.push('decoy-audit.yml schema must be school.decoy-audit/v1');
  if (record.status !== 'pass') errors.push('decoy-audit.yml status must be pass');
  if (record.content_fingerprint !== result.fingerprint) errors.push('decoy-audit.yml content_fingerprint does not match live choice pools');
  if (record.length_audit?.method !== PRACTICAL_LENGTH_AUDIT_METHOD) errors.push('decoy-audit.yml length_audit.method does not match this release audit');
  return { ...result, verification: { pass: errors.length === 0, errors }, pass: result.pass && errors.length === 0 };
}

function numericFlag(value, name) {
  if (value === undefined) return undefined;
  if (value === true || !/^\d+$/u.test(String(value)) || Number(value) < 1) throw new Error(`--${name} must be a positive integer`);
  return Number(value);
}

export async function main(argv = process.argv.slice(2)) {
  const { subcommand, positional, flags, help } = parseArgv(argv);
  if (help || !subcommand) { process.stdout.write(HELP); return help ? EXIT_OK : EXIT_USAGE; }
  if (!['audit', 'verify'].includes(subcommand)) { process.stderr.write(`Unknown command: ${subcommand}\n\n`); process.stdout.write(HELP); return EXIT_USAGE; }
  const target = positional[0];
  if (!target) { process.stderr.write('ERROR: name a subject/course or all\n'); return EXIT_USAGE; }
  if (subcommand === 'verify' && target === 'all') { process.stderr.write('ERROR: verify requires one subject/course\n'); return EXIT_USAGE; }
  if (flags['data-dir'] === true) { process.stderr.write('ERROR: --data-dir needs a path\n'); return EXIT_USAGE; }
  let trials;
  try { trials = numericFlag(flags.trials, 'trials'); } catch (error) { process.stderr.write(`ERROR: ${error.message}\n`); return EXIT_USAGE; }
  const root = dataRoot(flags['data-dir']);
  const contentRoot = path.join(root, 'content', 'school');
  const courseIds = target === 'all' ? listCourseIds(contentRoot) : [target];
  if (!courseIds.length) { process.stderr.write(`ERROR: no courses found under ${contentRoot}\n`); return EXIT_FAIL; }
  const results = courseIds.map((courseId) => {
    const courseRoot = path.join(contentRoot, courseId);
    const audit = analyzeCourse({ courseId, courseRoot, trials: trials ?? (target === 'all' ? DISCOVERY_TRIALS : RELEASE_TRIALS) });
    return subcommand === 'verify' ? verifyCourse(audit, courseRoot) : audit;
  });
  if (flags.json === true) process.stdout.write(`${JSON.stringify(target === 'all' ? results : results[0], null, 2)}\n`);
  else results.forEach((result) => {
    process.stdout.write(`${reportText(result)}\n`);
    for (const error of result.verification?.errors ?? []) process.stdout.write(`  VERIFY: ${error}\n`);
  });
  return results.every((result) => result.pass) ? EXIT_OK : EXIT_FAIL;
}

const ENTRYPOINT = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main().then((code) => process.exit(code)).catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(EXIT_FAIL); });
}
