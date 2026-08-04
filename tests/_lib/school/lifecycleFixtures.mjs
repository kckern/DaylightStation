/**
 * The fixtures an application test poses to a use case — READ FROM THE REAL
 * COMMITTED CURRICULUM, never hand-written.
 *
 * There is one four-unit maths course in `tests/_fixtures/school/curriculum/`:
 * verified fractions arithmetic, one unit per delivery mode, with real prompts,
 * real choices and real answers. This module is the in-memory door onto it. A
 * test needing a special shape (a unit with no bank, a document with no bubbles)
 * DERIVES it from those files by modification, so it inherits their correctness
 * instead of reinventing it.
 *
 * WHY NOT A SECOND, SIMPLER SET. There used to be one — trimmed literals that
 * "mirrored" the fixtures. It could not exist in production: banks with no
 * title, items with no prompt and no choices, and an `answer` holding a bubble
 * LETTER where a real bank holds the answer TEXT. Eight suites asserted against
 * it, which is exactly why a decoder returning the letter instead of the choice
 * graded a sheet 0 out of 6 and every one of them stayed green.
 * `tests/isolated/domain/school/fixtureIntegrity.test.mjs` now runs everything
 * exported here through the production validators, and its export table is
 * closed, so that cannot come back.
 *
 * @module tests/_lib/school/lifecycleFixtures
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { documentPdfTheme } from '#rendering/school/documents/documentPdfTheme.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, '..', '..', '_fixtures', 'school', 'curriculum');

/** Every fixture is handed out as a deep copy: a test that mutates cannot leak. */
const clone = (value) => structuredClone(value);

function loadAll(kind) {
  const dir = path.join(FIXTURE_DIR, kind);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml')).sort();
  if (!files.length) throw new Error(`lifecycleFixtures: no ${kind} fixtures in ${dir}`);
  return Object.freeze(files.map((file) => Object.freeze(yaml.load(fs.readFileSync(path.join(dir, file), 'utf8')))));
}

const UNITS = loadAll('units');
const DOCUMENTS = loadAll('documents');
const MANIFESTS = loadAll('manifests');
const BANKS = loadAll('banks');

// ---------------------------------------------------------------------------
// the four units, by the mode each one delivers
// ---------------------------------------------------------------------------

export const MEDIA_UNIT = 'math-fractions.01';
export const WORKSHEET_UNIT = 'math-fractions.02';
export const OMR_UNIT = 'math-fractions.03';
export const MIXED_UNIT = 'math-fractions.04';
export const COURSE_ID = 'math-fractions';

export const OMR_BANK_ID = 'math/math-fractions/03-checkpoint';
export const MEDIA_BANK_ID = 'math/math-fractions/01-quiz';
export const OMR_DOCUMENT_ID = 'math-fractions-03-omr';
export const WORKSHEET_DOCUMENT_ID = 'math-fractions-02-worksheet';

/** The bank ids the catalog is told exist, in the order the files are read. */
export const BANK_IDS = Object.freeze(BANKS.map((b) => b.id));

// ---------------------------------------------------------------------------
// the raw catalog rows
// ---------------------------------------------------------------------------

/**
 * The four units as the catalog serves them.
 *
 * @param {Object<string, object>} [over] - unitId → fields to REPLACE on that
 *   unit. This is how a test poses "the same course, but unit 01 is a draft"
 *   without authoring a second unit that could drift from the real one.
 */
export const rawUnits = (over = {}) => UNITS.map((unit) => ({
  ...clone(unit),
  ...(over[unit.unitId] ?? {}),
}));

/**
 * The three documents as the catalog serves them.
 *
 * @param {Object<string, object>} [over] - documentId → fields to REPLACE
 */
export const rawDocuments = (over = {}) => DOCUMENTS.map((document) => ({
  ...clone(document),
  ...(over[document.id] ?? {}),
}));

/**
 * The two media manifests as the catalog serves them.
 *
 * @param {Object<string, object>} [over] - manifestId → fields to REPLACE
 */
export const rawManifests = (over = {}) => MANIFESTS.map((manifest) => ({
  ...clone(manifest),
  ...(over[manifest.id] ?? {}),
}));

/** Both question banks, exactly as the grading engine reads them. */
export const rawBanks = () => BANKS.map(clone);

/**
 * One bank by id. Throws rather than returning undefined: a test built on a
 * bank that is not there asserts against `undefined` and passes for the wrong
 * reason.
 *
 * @param {string} id
 */
export function fixtureBank(id) {
  const bank = BANKS.find((b) => b.id === id);
  if (!bank) throw new Error(`lifecycleFixtures: no bank '${id}' (have: ${BANK_IDS.join(', ')})`);
  return clone(bank);
}

/** One document by id, for a test that wants to derive a variant of it. */
export function fixtureDocument(id) {
  const document = DOCUMENTS.find((d) => d.id === id);
  if (!document) throw new Error(`lifecycleFixtures: no document '${id}'`);
  return clone(document);
}

/** One unit by id, same contract. */
export function fixtureUnit(unitId) {
  const unit = UNITS.find((u) => u.unitId === unitId);
  if (!unit) throw new Error(`lifecycleFixtures: no unit '${unitId}'`);
  return clone(unit);
}

// ---------------------------------------------------------------------------
// the printed form map
// ---------------------------------------------------------------------------

const { letters, bubbleRadiusPt, rowHeightPt } = documentPdfTheme.omr;

/**
 * The form map the PDF renderer emits for the bubble sheet — DERIVED from the
 * real bank, not typed out.
 *
 * `DocumentPdfRenderer.drawOmrRow` writes one mark per bubble carrying
 * `{itemId, choice, label, xPt, yPt, rPt, page}`, where `choice` is the bubble
 * LETTER and `label` is the bank's choice TEXT printed under it. The join
 * between them is the whole grading contract: a reader that returns `choice`
 * where the grader expects `label` marks every answer wrong, which is the bug
 * this fixture used to conceal by carrying no `label` at all.
 *
 * Geometry is arithmetic — one row per item, bubbles left to right on a shared
 * baseline — which is all the reader's ordinal projection uses. The REAL
 * coordinates are exercised by the e2e harness, which renders the actual PDF.
 *
 * @param {object} [over] - top-level fields to replace (documentId, variant, seed…)
 */
export const printedFormMap = (over = {}) => {
  const bank = fixtureBank(OMR_BANK_ID);
  const document = fixtureDocument(OMR_DOCUMENT_ID);
  return {
    formVersion: 'v1',
    documentId: document.id,
    seed: document.seed,
    variant: document.variant ?? 0,
    marks: bank.items.flatMap((item, row) => item.choices.map((label, col) => ({
      itemId: item.id,
      choice: letters[col],
      label,
      xPt: 100 + col * 110,
      yPt: 200 + row * (rowHeightPt + 40),
      rPt: bubbleRadiusPt,
      page: 1,
    }))),
    ...over,
  };
};

/**
 * itemId → the bubble LETTER whose label is the bank's answer, resolved through
 * a form map. The same join the mark reader makes, so no test hardcodes a
 * letter and no test can drift from the paper.
 *
 * @param {object} [args]
 * @param {object} [args.formMap] - defaults to {@link printedFormMap}
 * @param {string} [args.bankId]
 * @param {string[]} [args.wrong] - itemIds to answer with a DIFFERENT bubble
 * @returns {Object<string,string>}
 */
export function correctBubbles({ formMap = printedFormMap(), bankId = OMR_BANK_ID, wrong = [] } = {}) {
  const bank = fixtureBank(bankId);
  const wrongSet = new Set(wrong);
  const chosen = {};
  for (const item of bank.items) {
    const bubbles = formMap.marks.filter((m) => m.itemId === item.id);
    if (!bubbles.length) continue;
    const right = bubbles.find((m) => m.label === item.answer);
    if (!right) throw new Error(`correctBubbles: no bubble carries ${item.id}'s answer ${item.answer}`);
    const pick = wrongSet.has(item.id) ? bubbles.find((m) => m.label !== item.answer) : right;
    chosen[item.id] = pick.choice;
  }
  return chosen;
}
