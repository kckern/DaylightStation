#!/usr/bin/env node
/**
 * Generic math-course generator: renders, validates and publishes a course
 * from a course SOURCE directory. The course itself (units, items, worked
 * examples, figure specs, printed-page study references, titles, book names)
 * is household content and lives in the data mount:
 *
 *   <dataDir>/content/school/course-sources/<course>/
 *     course.yml        id, title, source families, week spans, _index.yml body
 *     source-map.yml    school.study-reference-map/v1 (lesson -> printed pages)
 *     poster.svg        poster artwork
 *     lessons/*.json    one file per lesson: header, workedExample, items, figures
 *
 * Usage: generate-elementary-math-course.mjs --data-dir <dir>
 *          [--course <id>] [--source <dir>] [--check | --refresh]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { renderMathAsset } from "../__app_modules/learning/school/cli/math-assets.mjs";
import { validateQuestionBank } from "../__app_modules/learning/school/server/domain-question-bank-validation.mjs";
import { validateUnit } from "../__app_modules/learning/school/server/domain-curriculum-unit-validation.mjs";
import { lintTex } from "../__app_modules/learning/school/server/rendering-documents-tex-lint.mjs";

export const DEFAULT_COURSE = 'elementary-math-2-3';
const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
const unique = (values) => [...new Set(values.map(String))];

/** Where a course's source lives for a data dir (the default for --source). */
export function defaultSourceDir(dataDir, course = DEFAULT_COURSE) {
  return path.join(dataDir, 'content', 'school', 'course-sources', course);
}

/** Read and shape-check a course source directory. Throws naming the path when absent. */
export function loadCourseSource(sourceDir) {
  const courseFile = path.join(sourceDir, 'course.yml');
  if (!sourceDir || !fs.existsSync(courseFile)) {
    throw new Error(`course source not found: ${courseFile} — the course definition lives in the data mount `
      + `(<dataDir>/content/school/course-sources/<course>/); pass --source <dir> or stage the source there`);
  }
  const course = yaml.load(fs.readFileSync(courseFile, 'utf8'));
  if (course?.schema !== 'school.course-source/v1') throw new Error(`${courseFile}: schema must be school.course-source/v1`);
  for (const field of ['id', 'title', 'sourceFamilies', 'weeks', 'objective', 'index']) {
    if (course[field] === undefined) throw new Error(`${courseFile}: ${field} is required`);
  }
  const lessonDir = path.join(sourceDir, 'lessons');
  const lessonFiles = fs.existsSync(lessonDir) ? fs.readdirSync(lessonDir).filter((f) => f.endsWith('.json')).sort() : [];
  if (!lessonFiles.length) throw new Error(`course source has no lessons: ${lessonDir}`);
  const lessons = lessonFiles.map((file) => JSON.parse(fs.readFileSync(path.join(lessonDir, file), 'utf8')))
    .sort((a, b) => a.sequence - b.sequence);
  const posterFile = path.join(sourceDir, 'poster.svg');
  if (!fs.existsSync(posterFile)) throw new Error(`course source is missing ${posterFile}`);
  return {
    course, lessons, sourceMapPath: path.join(sourceDir, 'source-map.yml'),
    poster: fs.readFileSync(posterFile, 'utf8'),
    modules: course.index.modules.map((m) => ({ id: m.module, title: m.title, weeks: course.weeks[m.module] })),
  };
}

function figureSpec(course, figure) {
  return { schema: 'school.math-svg/v1', ref: figure.ref, kind: figure.kind, alt: figure.alt, params: figure.params };
}

function itemFor(def, entry) {
  const { referenceIndex = 0, ...rest } = entry;
  const { role: _role, ...reviewReference } = def.studyReferences[referenceIndex] ?? def.studyReferences[0];
  const { id, type, prompt, answer, decoys, levels, concepts, feedback, stimulus } = rest;
  return { id, type, prompt, answer, decoys, levels, concepts, reviewReference, feedback, ...(stimulus ? { stimulus } : {}) };
}

function studyReferenceDefinitions(definitions, sourceMapPath, COURSE) {
  const raw = yaml.load(fs.readFileSync(sourceMapPath, 'utf8'));
  if (raw?.schema !== 'school.study-reference-map/v1') throw new Error('source map schema must be school.study-reference-map/v1');
  if (raw?.course !== COURSE) throw new Error(`source map course must be ${COURSE}`);
  if (!raw.materials || typeof raw.materials !== 'object' || Array.isArray(raw.materials)) throw new Error('source map materials must be a mapping');
  if (!raw.lessons || typeof raw.lessons !== 'object' || Array.isArray(raw.lessons)) throw new Error('source map lessons must be a mapping');

  const expected = new Set(definitions.map((definition) => definition.id));
  const actual = new Set(Object.keys(raw.lessons));
  const missing = [...expected].filter((id) => !actual.has(id));
  const extra = [...actual].filter((id) => !expected.has(id));
  if (missing.length || extra.length) throw new Error(`source map lesson mismatch; missing=${missing.join(',') || 'none'}; extra=${extra.join(',') || 'none'}`);

  const referencesByLesson = new Map();
  const usedMaterials = new Set();
  definitions.forEach((definition) => {
    const materialIds = raw.lessons[definition.id];
    if (!Array.isArray(materialIds) || materialIds.length < 1 || materialIds.length > 3) {
      throw new Error(`${definition.id} must name 1..3 study materials`);
    }
    if (definition.kind === 'mastery' && materialIds.length < 2) throw new Error(`${definition.id} mastery must name 2..3 study materials`);
    const references = materialIds.map((materialId, index) => {
      const material = raw.materials[materialId];
      if (!material) throw new Error(`${definition.id} references unknown material ${materialId}`);
      usedMaterials.add(materialId);
      const unknown = Object.keys(material).filter((field) => !['title', 'pages', 'section'].includes(field));
      if (unknown.length) throw new Error(`${materialId} has unknown fields: ${unknown.join(', ')}`);
      if (typeof material.title !== 'string' || !material.title.trim()) throw new Error(`${materialId}.title is required`);
      if (typeof material.section !== 'string' || !material.section.trim()) throw new Error(`${materialId}.section is required`);
      if (!Array.isArray(material.pages) || material.pages.length < 1 || material.pages.length > 12
          || material.pages.some((page) => !Number.isInteger(page) || page < 1)
          || new Set(material.pages).size !== material.pages.length) {
        throw new Error(`${materialId}.pages must contain 1..12 unique positive printed page numbers`);
      }
      return {
        role: index === 0 ? 'primary' : 'alternate', title: material.title.trim(),
        pages: [...material.pages].sort((left, right) => left - right), section: material.section.trim(),
      };
    });
    referencesByLesson.set(definition.id, references);
  });
  const unused = Object.keys(raw.materials).filter((materialId) => !usedMaterials.has(materialId));
  if (unused.length) throw new Error(`source map has unused materials: ${unused.join(', ')}`);
  return referencesByLesson;
}


function courseIndex(src) { return src.course.index; }

function moduleIndex(module, index) {
  return { schema: 'school.course-unit/v1', unit: module.id, title: module.title, sequence: (index + 1) * 10, required: true, overview_first: true, lesson_order: 'sequence' };
}

function bankFor(src, def, items) {
  const COURSE = src.course.id;
  const sourceName = src.course.sourceFamilies[def.source].name;
  const conceptIds = unique(items.flatMap((entry) => entry.concepts ?? []));
  const lower = def.title.toLowerCase();
  return {
    schema: 'school.question-bank/v2', id: `math/${COURSE}/${def.id}/worksheet`, title: def.title, subject: 'math', audience: 'assigned',
    unit: def.id, topics: [def.module, slug(def.title)],
    concepts: conceptIds.map((conceptId) => ({
      conceptId,
      title: conceptId.split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' '),
    })),
    items,
    lesson: {
      schema: 'school.unit/v1', unitId: def.id, title: def.title,
      description: def.required ? `Six-question mastery-oriented worksheet for ${lower}.` : `Optional practice and enrichment for ${lower}.`,
      subject: 'math', courseId: COURSE, sequence: def.sequence, module: def.module, moduleRole: def.moduleRole, required: def.required,
      grades: ['lower'], objectives: [src.course.objective.replace('{title}', lower)],
      bank: `math/${COURSE}/${def.id}/worksheet`, passing: { percent: 80 }, retry: { variants: 12 },
      studyReferences: def.studyReferences,
      worksheet: { examples: [def.workedExample] },
      provenance: { source: sourceName, reviewState: 'approved' },
    },
  };
}

const AMBIGUOUS_PROMPT_PATTERNS = Object.freeze([
  /^(?=.*\bdigit\b)(?=.*\bvalue\b)/iu,
  /Which category has the greatest value/iu,
  /counters are selected\. What fraction of the set is selected/iu,
  /Which multiplication expression has the same product/iu,
  /Which addition checks/iu,
  /Which word names every polygon with four sides/iu,
]);
const GENERIC_FEEDBACK = /^Try the .+ strategy again, then check your work\.$/iu;

function questionSignature(entry) {
  return JSON.stringify({
    prompt: String(entry?.prompt ?? '').replace(/\s+/gu, ' ').trim(),
    answer: String(entry?.answer ?? '').trim(),
    decoys: [...(entry?.decoys ?? [])].map(String).sort(),
    stimulus: String(entry?.stimulus?.alt ?? '').replace(/\s+/gu, ' ').trim(),
  });
}

function elementaryExpressionValue(choice) {
  const normalized = String(choice).replaceAll('$', '').replaceAll('{,}', '').replaceAll(',', '').trim();
  const numeric = /^\d+(?:\.\d+)?$/u.exec(normalized);
  if (numeric) return Number(normalized);
  const fraction = /^(\d+)\/(\d+)$/u.exec(normalized);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const match = /^(\d+)\s*([+−×÷-])\s*(\d+)$/u.exec(normalized);
  if (!match) return null;
  const left = Number(match[1]); const right = Number(match[3]);
  if (match[2] === '+') return left + right;
  if (match[2] === '−' || match[2] === '-') return left - right;
  if (match[2] === '×') return left * right;
  if (match[2] === '÷') return right === 0 ? null : left / right;
  return null;
}

function elementaryStatementTruth(choice) {
  const normalized = String(choice).replaceAll('$', '').trim();
  const match = /^(.+?)\s*(=|>|<)\s*(.+)$/u.exec(normalized);
  if (!match) return null;
  const left = elementaryExpressionValue(match[1]); const right = elementaryExpressionValue(match[3]);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  if (match[2] === '=') return Math.abs(left - right) < Number.EPSILON;
  return match[2] === '>' ? left > right : left < right;
}

function measurementDimension(choice) {
  const value = String(choice).toLowerCase();
  if (/\b(?:millimeters?|centimeters?|meters?|kilometers?)\b/u.test(value)) return 'length';
  if (/\b(?:milligrams?|grams?|kilograms?|tonnes?)\b/u.test(value)) return 'mass';
  if (/\b(?:milliliters?|liters?|kiloliters?)\b/u.test(value)) return 'capacity';
  if (/\b(?:seconds?|minutes?|hours?|days?)\b/u.test(value)) return 'time';
  return null;
}

/** Course-specific language checks that run before a generated bank is published. */
export function auditElementaryMathBank(bank) {
  const errors = [];
  (bank?.items ?? []).forEach((entry, index) => {
    const at = `${bank?.id ?? 'bank'} item ${index + 1}`;
    const prompt = String(entry?.prompt ?? '').trim();
    // Render every `$…$` the item carries through the SAME MathJax the
    // worksheet renderer uses. Authored in JavaScript strings, a TeX `\_`
    // is one backslash short of surviving: `'\_\_\_'` reaches the bank as
    // `___`, and on 2026-09-15 the first thing to ever render that was a
    // child's print at the Portal. The lint is what the printer would say.
    lintTex(entry).forEach((error) => errors.push(`${at}: TeX does not render — ${error}`));
    const feedback = String(entry?.feedback?.incorrect ?? '').trim();
    if (!prompt) errors.push(`${at}: prompt is required`);
    AMBIGUOUS_PROMPT_PATTERNS.forEach((pattern) => {
      if (pattern.test(prompt)) errors.push(`${at}: ambiguous or developmentally weak prompt: ${prompt}`);
    });
    if (/(^|[^\\])\bBox\b/u.test(prompt)) errors.push(`${at}: unescaped Box token`);
    if (!feedback) errors.push(`${at}: incorrect feedback is required`);
    if (GENERIC_FEEDBACK.test(feedback)) errors.push(`${at}: generic incorrect feedback`);
    const answer = Number(entry?.answer); const numericDecoys = (entry?.decoys ?? []).map(Number);
    if (Number.isFinite(answer) && numericDecoys.length === 4 && numericDecoys.every(Number.isFinite)
        && [-2, -1, 1, 2].every((delta) => numericDecoys.includes(answer + delta))) {
      errors.push(`${at}: decoys reproduce the forbidden answer ±1/±2 fallback`);
    }
    const comparison = /Which (?:number|expression) is (greatest|least)/iu.exec(prompt);
    if (comparison) {
      const choices = [entry.answer, ...(entry.decoys ?? [])];
      const values = choices.map((choice) => {
        const numeric = Number(choice); return Number.isFinite(numeric) ? numeric : elementaryExpressionValue(choice);
      });
      if (values.every((value) => Number.isFinite(value))) {
        const expected = comparison[1].toLowerCase() === 'greatest' ? Math.max(...values) : Math.min(...values);
        if (values[0] !== expected || values.filter((value) => value === expected).length !== 1) {
          errors.push(`${at}: designated ${comparison[1].toLowerCase()} answer is not uniquely correct`);
        }
      }
    }
    const expressionExtreme = /Which expression has the (greatest|least) (?:value|product)/iu.exec(prompt);
    if (expressionExtreme) {
      const values = [entry.answer, ...(entry.decoys ?? [])].map(elementaryExpressionValue);
      if (values.every((value) => Number.isFinite(value))) {
        const expected = expressionExtreme[1].toLowerCase() === 'greatest' ? Math.max(...values) : Math.min(...values);
        if (values[0] !== expected || values.filter((value) => value === expected).length !== 1) {
          errors.push(`${at}: designated ${expressionExtreme[1].toLowerCase()} expression is not uniquely correct`);
        }
      }
    }
    const targetedExpression = /Which expression has (?:a|the) (?:sum|difference|value) of (\d+)/iu.exec(prompt);
    if (targetedExpression) {
      const target = Number(targetedExpression[1]);
      const values = [entry.answer, ...(entry.decoys ?? [])].map(elementaryExpressionValue);
      if (values.every((value) => Number.isFinite(value))
          && (values[0] !== target || values.filter((value) => value === target).length !== 1)) {
        errors.push(`${at}: expression choices do not have one uniquely correct value of ${target}`);
      }
    }
    if (/Which (?:equation|sum|difference|comparison) is (?:true|correct)/iu.test(prompt)) {
      const truths = [entry.answer, ...(entry.decoys ?? [])].map(elementaryStatementTruth);
      if (truths.every((truth) => typeof truth === 'boolean') && (truths[0] !== true || truths.filter(Boolean).length !== 1)) {
        errors.push(`${at}: equation choices do not have one uniquely true answer`);
      }
    }
    const equivalentFraction = /Which fraction is equivalent to \$?(\d+\/\d+)\$?/iu.exec(prompt);
    if (equivalentFraction) {
      const target = elementaryExpressionValue(equivalentFraction[1]);
      const values = [entry.answer, ...(entry.decoys ?? [])].map(elementaryExpressionValue);
      if (values.every((value) => Number.isFinite(value))
          && (Math.abs(values[0] - target) >= Number.EPSILON
            || values.filter((value) => Math.abs(value - target) < Number.EPSILON).length !== 1)) {
        errors.push(`${at}: equivalent-fraction choices do not have one uniquely correct answer`);
      }
    }
    const rounding = /^Round (\d+) to the nearest (ten|hundred)\.$/iu.exec(prompt);
    if (rounding) {
      const source = Number(rounding[1]); const place = rounding[2].toLowerCase() === 'hundred' ? 100 : 10;
      const expected = Math.round(source / place) * place;
      if (Number(entry.answer) !== expected) errors.push(`${at}: incorrect rounded answer; expected ${expected}`);
      [entry.answer, ...(entry.decoys ?? [])].forEach((choice) => {
        const numeric = Number(choice);
        if (!Number.isFinite(numeric) || (numeric !== source && numeric % place !== 0)) {
          errors.push(`${at}: rounding choice ${choice} is neither the source number nor a multiple of ${place}`);
        }
      });
    }
    if (/most reasonable (?:estimate|capacity|distance|length|mass|time)/iu.test(prompt)) {
      const dimensions = [entry.answer, ...(entry.decoys ?? [])].map(measurementDimension);
      if (dimensions.some((dimension) => !dimension) || new Set(dimensions).size !== 1) {
        errors.push(`${at}: reasonable-estimate choices must be dimensional peers`);
      }
    }
  });
  const signatures = (bank?.items ?? []).map(questionSignature);
  if (new Set(signatures).size !== signatures.length) errors.push(`${bank?.id ?? 'bank'}: bank contains semantically duplicate questions`);
  const feedbackVariants = new Set((bank?.items ?? []).map((entry) => String(entry?.feedback?.incorrect ?? '').trim()));
  if ((bank?.items ?? []).length === 12 && feedbackVariants.size < 3) {
    errors.push(`${bank?.id ?? 'bank'}: twelve-item bank needs at least three item-specific feedback variants`);
  }
  const examples = bank?.lesson?.worksheet?.examples;
  if (!Array.isArray(examples) || examples.length !== 1) {
    errors.push(`${bank?.id ?? 'bank'}: every lesson must author exactly one compact worked example`);
  } else {
    const [example] = examples;
    const prompt = String(example?.question?.prompt ?? '').trim();
    const choices = example?.question?.choices ?? [];
    const answer = String(example?.solution?.answer ?? '').trim();
    if (!prompt || /^(?:look|study|notice|observe)\b[^?!.]*[.!]?$/iu.test(prompt)) {
      errors.push(`${bank.id}: worked example must contain a genuine representative question`);
    }
    AMBIGUOUS_PROMPT_PATTERNS.forEach((pattern) => {
      if (pattern.test(prompt)) errors.push(`${bank.id}: worked example repeats ambiguous wording: ${prompt}`);
    });
    if (!Array.isArray(choices) || !choices.includes(answer)) {
      errors.push(`${bank.id}: worked example's correct answer must be one of its displayed choices`);
    }
    if (!Array.isArray(choices) || new Set(choices.map(String)).size !== choices.length) {
      errors.push(`${bank.id}: worked example choices must be distinct`);
    }
    if (!Array.isArray(example?.solution?.steps) || example.solution.steps.length < 1) {
      errors.push(`${bank.id}: worked example must show how to reach the answer`);
    }
  }
  return errors;
}

/** Cross-bank checks prevent renamed copies from masquerading as new assessments. */
export function auditElementaryMathCourse(banks) {
  const errors = []; const seenItems = new Map(); const seenBanks = new Map();
  banks.forEach((bank) => {
    const signatures = (bank.items ?? []).map(questionSignature);
    signatures.forEach((signature) => {
      const prior = seenItems.get(signature);
      if (prior && prior !== bank.id) errors.push(`${bank.id}: duplicates a question from ${prior}`);
      else seenItems.set(signature, bank.id);
    });
    const bankSignature = JSON.stringify([...signatures].sort());
    const priorBank = seenBanks.get(bankSignature);
    if (priorBank) errors.push(`${bank.id}: full-bank clone of ${priorBank}`);
    else seenBanks.set(bankSignature, bank.id);
    if (bank.unit.endsWith('-99-mastery')) {
      (bank.items ?? []).forEach((entry, index) => {
        if (!(entry.concepts ?? []).some((concept) => concept !== 'mastery')) {
          errors.push(`${bank.id} item ${index + 1}: mastery question lacks a specific assessed concept`);
        }
      });
    }
  });
  return errors;
}

function curriculumMarkdown(src, definitions) {
  const lines = [`# ${src.course.title}`, '', 'The week spans are planning targets. Mastery, not the calendar, controls advancement.', '',
    '| Weeks | Unit | Required worksheets | Optional worksheet |', '|---|---|---|---|'];
  src.modules.forEach((module) => {
    const lessons = definitions.filter((def) => def.module === module.id);
    const required = lessons.filter((def) => def.required && def.kind !== 'mastery').map((def) => def.title).join('; ');
    const optional = lessons.find((def) => !def.required)?.title;
    lines.push(`| ${module.weeks} | ${module.title} | ${required}; unit mastery | ${optional} |`);
  });
  lines.push('', 'Every issued sheet samples exactly six multiple-choice questions from a twelve-item bank. Five correct answers meet the 80% gate.',
    'Optional worksheets never block a later required worksheet or module.', '');
  return lines.join('\n');
}

const dump = (value) => yaml.dump(value, { noRefs: true, lineWidth: 110, sortKeys: false });
export function generateElementaryMathCourse({ dataDir, requireAbsent = true, sourceDir, sourceMapPath } = {}) {
  if (!dataDir) throw new Error('dataDir is required');
  const src = loadCourseSource(sourceDir ?? defaultSourceDir(dataDir));
  const COURSE = src.course.id;
  const courseRoot = path.join(dataDir, 'content', 'school', 'math', COURSE);
  const assetRoot = path.join(dataDir, 'content', 'assets', 'school', 'math', COURSE);
  if (requireAbsent && (fs.existsSync(courseRoot) || fs.existsSync(assetRoot))) throw new Error('course or asset target already exists; refuse to overwrite');
  fs.mkdirSync(courseRoot, { recursive: true }); fs.mkdirSync(path.join(assetRoot, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(courseRoot, '_index.yml'), dump(courseIndex(src)));
  const definitions = src.lessons;
  const referencesByLesson = studyReferenceDefinitions(definitions, sourceMapPath ?? src.sourceMapPath, COURSE);
  definitions.forEach((definition) => { definition.studyReferences = referencesByLesson.get(definition.id); });
  const specs = new Map(); const built = new Map(); const banks = [];
  definitions.forEach((def) => {
    const items = def.items.map((entry) => itemFor(def, entry));
    (def.figures ?? []).forEach((figure) => specs.set(figure.ref, figureSpec(src.course, figure)));
    built.set(def.id, items);
    const bank = bankFor(src, def, items);
    banks.push(bank);
    const auditErrors = auditElementaryMathBank(bank);
    const bankValidation = validateQuestionBank(bank);
    if (!bankValidation.ok) auditErrors.push(...bankValidation.errors.map((error) => `${bank.id}: ${error}`));
    const unitValidation = validateUnit(bank.lesson, { bankIds: new Set([bank.id]) });
    if (unitValidation.errors.length) auditErrors.push(...unitValidation.errors.map((error) => `${bank.id} lesson: ${error}`));
    if (auditErrors.length) throw new Error(`elementary math content audit failed:\n${auditErrors.join('\n')}`);
    const moduleNumber = src.modules.findIndex((module) => module.id === def.module) + 1;
    const moduleDir = path.join(courseRoot, `${String(moduleNumber * 10).padStart(3, '0')}-${def.module}`);
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, `${def.id}.yml`), dump(bank));
  });
  const courseAuditErrors = auditElementaryMathCourse(banks);
  if (courseAuditErrors.length) throw new Error(`elementary math cross-bank audit failed:\n${courseAuditErrors.join('\n')}`);
  src.modules.forEach((module, index) => {
    const moduleDir = path.join(courseRoot, `${String((index + 1) * 10).padStart(3, '0')}-${module.id}`);
    fs.writeFileSync(path.join(moduleDir, '_index.yml'), dump(moduleIndex(module, index)));
  });
  specs.forEach((spec) => {
    const name = `${spec.ref.split('/').at(-1)}.yml`;
    fs.writeFileSync(path.join(assetRoot, 'specs', name), dump(spec));
    fs.mkdirSync(path.dirname(path.join(dataDir, 'content', 'assets', `${spec.ref}.svg`)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'content', 'assets', `${spec.ref}.svg`), renderMathAsset(spec));
  });
  fs.writeFileSync(path.join(courseRoot, 'CURRICULUM.md'), curriculumMarkdown(src, definitions));
  fs.writeFileSync(path.join(courseRoot, '_study-references.yml'), dump({
    schema: 'school.study-reference-map/v1', course: COURSE,
    note: 'These printed-page references support original parallel practice; they are not question provenance.',
    lessons: Object.fromEntries(definitions.map((definition) => [definition.id, definition.studyReferences])),
  }));
  fs.writeFileSync(path.join(courseRoot, 'poster.svg'), src.poster);
  return { courseId: COURSE, courseRoot, assetRoot, definitions, bankCount: definitions.length, itemCount: [...built.values()].reduce((sum, items) => sum + items.length, 0), assetCount: specs.size };
}

function magickPoster(courseRoot) {
  const svg = path.join(courseRoot, 'poster.svg');
  const jpg = path.join(courseRoot, 'poster.jpg');
  const png = path.join(courseRoot, '.poster-rsvg.png');
  try {
    try {
      execFileSync('magick', [svg, '-quality', '92', jpg], { stdio: 'pipe' });
    } catch (directError) {
      // ImageMagick installations on macOS may advertise SVG support while
      // hard-coding an absent Inkscape.app delegate. Librsvg gives us a plain
      // PNG first; ImageMagick can always perform the final JPEG conversion.
      try {
        execFileSync('rsvg-convert', ['--format', 'png', '--background-color', 'white', '--output', png, svg], { stdio: 'pipe' });
        execFileSync('magick', [png, '-quality', '92', jpg], { stdio: 'pipe' });
      } catch (fallbackError) {
        throw new Error(
          `poster rendering failed with ImageMagick and librsvg fallback: ${fallbackError.message}`,
          { cause: directError },
        );
      }
    }
  } finally {
    fs.rmSync(png, { force: true });
  }
  fs.rmSync(svg);
}


function stageCompleteCourse({ dataDir, sourceDir, sourceMapPath, renderPoster = magickPoster }) {
  const stageRoot = fs.mkdtempSync(path.join(path.dirname(path.resolve(dataDir)), '.elementary-math-stage-'));
  try {
    const result = generateElementaryMathCourse({ dataDir: stageRoot, sourceDir: sourceDir ?? defaultSourceDir(dataDir), sourceMapPath });
    renderPoster(result.courseRoot);
    if (!fs.existsSync(path.join(result.courseRoot, 'poster.jpg'))) throw new Error('poster renderer did not create poster.jpg');
    return { stageRoot, result };
  } catch (error) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }
}
/** Build and validate every generated byte without touching live curriculum. */
export function checkElementaryMathCourse(options = {}) {
  if (!options.dataDir) throw new Error('dataDir is required');
  const staged = stageCompleteCourse(options);
  try {
    return { banks: staged.result.bankCount, items: staged.result.itemCount, assets: staged.result.assetCount };
  } finally {
    fs.rmSync(staged.stageRoot, { recursive: true, force: true });
  }
}

/** Publish complete course and asset directories with rollback on any failed move. */
export function publishElementaryMathCourse(options = {}) {
  if (!options.dataDir) throw new Error('dataDir is required');
  const dataDir = path.resolve(options.dataDir);
  const staged = stageCompleteCourse({ ...options, dataDir });
  const liveCourse = path.join(dataDir, 'content', 'school', 'math', staged.result.courseId);
  const liveAssets = path.join(dataDir, 'content', 'assets', 'school', 'math', staged.result.courseId);
  const backupRoot = fs.mkdtempSync(path.join(path.dirname(dataDir), '.elementary-math-backup-'));
  const pairs = [
    { staged: staged.result.courseRoot, live: liveCourse, backup: path.join(backupRoot, 'course') },
    { staged: staged.result.assetRoot, live: liveAssets, backup: path.join(backupRoot, 'assets') },
  ];
  const saved = []; const installed = [];
  try {
    pairs.forEach((pair) => {
      fs.mkdirSync(path.dirname(pair.live), { recursive: true });
      if (fs.existsSync(pair.live)) { fs.renameSync(pair.live, pair.backup); saved.push(pair); }
    });
    pairs.forEach((pair) => { fs.renameSync(pair.staged, pair.live); installed.push(pair); });
    return {
      courseRoot: liveCourse, assetRoot: liveAssets, backupRoot: saved.length ? backupRoot : null,
      bankCount: staged.result.bankCount, itemCount: staged.result.itemCount, assetCount: staged.result.assetCount,
    };
  } catch (error) {
    installed.reverse().forEach((pair) => fs.rmSync(pair.live, { recursive: true, force: true }));
    saved.reverse().forEach((pair) => fs.renameSync(pair.backup, pair.live));
    throw error;
  } finally {
    fs.rmSync(staged.stageRoot, { recursive: true, force: true });
    if (!saved.length) fs.rmSync(backupRoot, { recursive: true, force: true });
  }
}

function flag(argv, name) {
  const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : null;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const argv = process.argv.slice(2); const dataDir = flag(argv, '--data-dir');
    const course = flag(argv, '--course') ?? DEFAULT_COURSE;
    const sourceDir = flag(argv, '--source') ?? (dataDir ? defaultSourceDir(dataDir, course) : null);
    if (argv.includes('--check')) {
      process.stdout.write(`${JSON.stringify({ checked: true, ...checkElementaryMathCourse({ dataDir, sourceDir }) })}\n`);
    } else if (argv.includes('--refresh')) {
      const result = publishElementaryMathCourse({ dataDir, sourceDir });
      process.stdout.write(`${JSON.stringify({ course: result.courseRoot, backup: result.backupRoot,
        banks: result.bankCount, items: result.itemCount, assets: result.assetCount })}\n`);
    } else {
      const result = generateElementaryMathCourse({ dataDir, sourceDir }); magickPoster(result.courseRoot);
      process.stdout.write(`${JSON.stringify({ course: result.courseRoot, banks: result.bankCount, items: result.itemCount, assets: result.assetCount })}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1;
  }
}
