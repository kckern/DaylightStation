/**
 * The WORK config — one `work.yml` per curriculum, at
 * `content/school/{subject}/{work}/work.yml`.
 *
 * A work is the unit a parent thinks in: Shakespeare Tales, I Survived,
 * math-fractions, us-capitals. This file is what lets the code answer, for any
 * work it has never seen, WITHOUT special-casing it:
 *
 *   what is this            work / title / subject / category / medium
 *   how is it structured    structure.shape, and where the item list comes from
 *   how is it graded        grading.gate / scope / thresholds / exit
 *   where is the material   material.adapter + root
 *   what media is attached  per item, or derived from the adapter
 *   what gets printed       printables[], each with when + whether it is scanned
 *
 * Deliberately NOT a table of contents. Enumerating 79 chapters (or 3,567 Khan
 * banks) in config would be a second source of truth that drifts from the banks
 * themselves, so `structure.items.from` names a STRATEGY and the code derives
 * the list. A work may still enumerate `modules:` when the order is editorial
 * and cannot be computed — Shakespeare play order is one such case.
 *
 * Vocabulary note: this level is `work`, not `unit`. `unit` already means one
 * lesson-sized thing carrying a bank or document (`math-fractions.01`), and
 * `manifest` already means a media locator with repair aliases. Both were taken
 * before this file existed.
 */
import { SUBJECT_IDS } from './unitValidation.mjs';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const ID_PATH = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;

// Pedagogy, mirroring 2_domains/school/categories.mjs — an unknown value there
// fails closed to `reference`, so an unknown value here is worth reporting.
const CATEGORIES = ['course', 'reference', 'listening'];
const MEDIA = ['audio', 'video', 'paper', 'app', 'mixed', 'none'];

// How a work is laid out below itself.
//   modules  two levels: modules of items (a play of chapters, a book of chapters)
//   flat     one level: items directly (us-capitals: study sheet, checkpoint)
//   topics   banks grouped by topic with no media and no fixed order (Khan imports)
//   package  a generated body with its own internal shape (scripture/bom)
const SHAPES = ['modules', 'flat', 'topics', 'package'];

// Where the item list comes from. Naming a strategy keeps the list out of config.
const ITEM_SOURCES = ['quizzes', 'units', 'plex', 'package'];
const ORDERS = ['sequence', 'filename', 'plex', 'none'];

// What stands between a learner and credit. `mixed` is for a work whose items
// are gated differently from one another (math-fractions: a bank on 01, a
// parent-graded worksheet on 02, an OMR sheet on 03) — the per-item gate is
// then read off each unit's own bank/document/review reference, and this field
// only says "do not assume one".
const GATES = ['quiz', 'omr', 'review', 'mixed', 'none'];
const SCOPES = ['item', 'module', 'work'];

// When a printable is issued during the work.
const WHENS = ['study', 'checkpoint', 'remediation'];
const SCANS = ['omr', 'none'];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isPresent = (v) => v !== undefined && v !== null;
const pct = (v) => Number.isInteger(v) && v > 0 && v <= 100;

function oneOf(value, allowed, field, errors) {
  if (!allowed.includes(value)) errors.push(`${field} must be one of ${allowed.join('|')}, got: ${value}`);
}

/**
 * @param {*} raw - one parsed work.yml
 * @param {{subject?: string, work?: string}} [ctx] - shelf and directory it was
 *   found in, so the config can be checked against where it actually lives
 * @returns {{ errors: string[], work?: object }} empty errors === valid
 */
export function validateWork(raw, ctx = {}) {
  if (!isObj(raw)) return { errors: ['work must be a mapping'] };
  const errors = [];

  if (!isStr(raw.work) || !SLUG.test(raw.work)) errors.push(`work must match ${SLUG.source}`);
  else if (ctx.work && raw.work !== ctx.work) errors.push(`work is "${raw.work}" but the directory is "${ctx.work}"`);

  if (!isStr(raw.title)) errors.push('title is required');

  if (!SUBJECT_IDS.includes(raw.subject)) {
    errors.push(`subject must be one of ${SUBJECT_IDS.join('|')}, got: ${raw.subject}`);
  } else if (ctx.subject && raw.subject !== ctx.subject) {
    errors.push(`subject is "${raw.subject}" but the shelf is "${ctx.subject}"`);
  }

  oneOf(raw.category, CATEGORIES, 'category', errors);
  oneOf(raw.medium, MEDIA, 'medium', errors);

  // ── material ──────────────────────────────────────────────────────────────
  // Absent means the work has no external media at all (Khan banks, paper-only
  // work). That is a real state, not an omission, so it is not an error.
  let material;
  if (isPresent(raw.material)) {
    if (!isObj(raw.material)) errors.push('material must be an object');
    else {
      if (!isStr(raw.material.adapter)) errors.push('material.adapter is required');
      if (isPresent(raw.material.root) && !isStr(raw.material.root)) errors.push('material.root must be a string');
      material = { adapter: raw.material.adapter, root: raw.material.root };
    }
  } else if (raw.medium !== 'none' && raw.medium !== 'paper' && raw.medium !== 'app') {
    errors.push(`medium is "${raw.medium}" but no material block says where it lives`);
  }

  // ── structure ─────────────────────────────────────────────────────────────
  let structure;
  if (!isObj(raw.structure)) {
    errors.push('structure is required');
  } else {
    const s = raw.structure;
    oneOf(s.shape, SHAPES, 'structure.shape', errors);
    if (!isObj(s.items)) {
      errors.push('structure.items is required');
    } else {
      oneOf(s.items.from, ITEM_SOURCES, 'structure.items.from', errors);
      if (isPresent(s.items.order)) oneOf(s.items.order, ORDERS, 'structure.items.order', errors);
    }
    // A two-level work should say what it calls each level; a flat one must not
    // claim a module noun it has no level for.
    if (s.shape === 'modules' && !isStr(s.module)) errors.push('structure.module (a noun) is required when shape is modules');
    if (s.shape !== 'modules' && isPresent(s.module)) errors.push(`structure.module is meaningless when shape is ${s.shape}`);
    structure = s;
  }

  // ── grading ───────────────────────────────────────────────────────────────
  let grading;
  if (!isObj(raw.grading)) {
    errors.push('grading is required');
  } else {
    const g = raw.grading;
    oneOf(g.gate, GATES, 'grading.gate', errors);
    oneOf(g.scope, SCOPES, 'grading.scope', errors);
    // A gate needs a bar; `none` must not pretend to have one.
    if (g.gate === 'none') {
      if (isPresent(g.pass_percent)) errors.push('grading.pass_percent is meaningless when gate is none');
    } else if (!pct(g.pass_percent)) {
      errors.push('grading.pass_percent must be an integer 1..100 when there is a gate');
    }
    if (isPresent(g.completion_threshold_percent) && !pct(g.completion_threshold_percent)) {
      errors.push('grading.completion_threshold_percent must be an integer 1..100');
    }
    if (!isStr(g.exit)) errors.push('grading.exit is required — say what finishing means');
    grading = g;
  }

  // ── printables ────────────────────────────────────────────────────────────
  let printables;
  if (isPresent(raw.printables)) {
    if (!Array.isArray(raw.printables)) {
      errors.push('printables must be an array');
    } else {
      raw.printables.forEach((p, i) => {
        const at = `printables[${i}]`;
        if (!isObj(p)) { errors.push(`${at} must be an object`); return; }
        if (!isStr(p.document)) errors.push(`${at}.document is required (a documentId)`);
        oneOf(p.when, WHENS, `${at}.when`, errors);
        if (isPresent(p.scan)) oneOf(p.scan, SCANS, `${at}.scan`, errors);
      });
      printables = raw.printables;
    }
  }
  // An OMR gate has to be scanned from somewhere.
  if (raw.grading?.gate === 'omr' && !(printables || []).some((p) => p?.scan === 'omr')) {
    errors.push('grading.gate is omr but no printable declares scan: omr');
  }

  // ── modules (optional, editorial order only) ──────────────────────────────
  let modules;
  if (isPresent(raw.modules)) {
    if (!Array.isArray(raw.modules) || raw.modules.length === 0) {
      errors.push('modules must be a non-empty array when present');
    } else if (raw.structure?.shape !== 'modules') {
      errors.push(`modules[] listed but structure.shape is ${raw.structure?.shape}`);
    } else {
      const seen = new Set();
      raw.modules.forEach((m, i) => {
        const at = `modules[${i}]`;
        if (!isObj(m)) { errors.push(`${at} must be an object`); return; }
        if (!isStr(m.module) || !SLUG.test(m.module)) errors.push(`${at}.module must match ${SLUG.source}`);
        else if (seen.has(m.module)) errors.push(`${at}: duplicate module "${m.module}"`);
        else seen.add(m.module);
        if (!isStr(m.title)) errors.push(`${at}.title is required`);
        if (isPresent(m.media) && !isStr(m.media)) errors.push(`${at}.media must be a locator string`);
      });
      modules = raw.modules;
    }
  }

  if (isPresent(raw.quiz_root) && !ID_PATH.test(String(raw.quiz_root))) {
    errors.push('quiz_root must be a bank id path');
  }

  if (errors.length) return { errors };
  return {
    errors,
    work: {
      work: raw.work,
      title: raw.title,
      subject: raw.subject,
      category: raw.category,
      medium: raw.medium,
      material,
      structure,
      grading,
      printables,
      modules,
      levels: raw.levels,
    },
  };
}

export const WORK_ENUMS = Object.freeze({
  CATEGORIES, MEDIA, SHAPES, ITEM_SOURCES, ORDERS, GATES, SCOPES, WHENS, SCANS,
});
