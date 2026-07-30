/**
 * The sample math-fractions course, validated as a whole.
 *
 * Every other test in this folder proves a validator rejects bad input. This one
 * proves the FIRST REAL COURSE passes all four of them at once, and that the
 * cross-artefact links a child actually depends on hold: the four units form an
 * unbroken sequence, every ref resolves, and each printed bubble row on unit 03
 * names an item the grading engine can find. A break in any of those is a child
 * standing at the printer with a sheet nobody can score.
 *
 * Fixtures are read from disk (not inlined) because they double as the input to
 * the end-to-end lifecycle harness — one copy, validated here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { validateUnit, isPublishable } from '#domains/school/curriculum/unitValidation.mjs';
import { validateManifest } from '#domains/school/curriculum/manifestValidation.mjs';
import { validateDocument, walkBlocks } from '#domains/school/documents/documentValidation.mjs';
import { validateQuestionBank } from '#domains/school/questionBankValidation.mjs';
import { TOKEN_CLASSES } from '#domains/school/sessions/tokens.mjs';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../_fixtures/school/curriculum',
);

const COURSE_ID = 'math-fractions';

/** Absolute path of every fixture file, by `<dir>/<file>` label. */
const sourceFiles = new Map();

/** Every *.yml in a fixture subfolder, parsed, as [filename, parsed] pairs. */
function loadDir(name) {
  const dir = path.join(FIXTURES, name);
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml')).sort();
  // A silently empty directory would make every `it.each` below vanish, which
  // reads as a green run over nothing.
  expect(files.length, `no fixtures found in ${name}/`).toBeGreaterThan(0);
  return files.map((file) => {
    const abs = path.join(dir, file);
    sourceFiles.set(`${name}/${file}`, abs);
    return [file, yaml.load(readFileSync(abs, 'utf8'))];
  });
}

const units = loadDir('units');
const documents = loadDir('documents');
const manifests = loadDir('manifests');
const banks = loadDir('banks');

// Reference sets are built from the fixtures ACTUALLY PRESENT, so a unit that
// points at an artefact nobody wrote fails here rather than at print time.
// `programIds` and `surfaceValidators` are the two exceptions — a program
// unit's `program:` value names a registered LAUNCHER (composition root), not
// a fixture file, and a `launch:` unit's `surface:` names a registered DoNow
// SURFACE ADAPTER, likewise not a fixture file. `language` is the
// code-registered program (school-agenda-v2's seed); `pe-daily` is the
// config-driven `school.yml` `programs:` entry the DoNow launch-journey e2e
// (Task 14) seeds; `garage-fitness` is one of DoNow's own unconditionally-
// registered surfaces (`donow.mjs`) — the stand-in validator below mirrors
// `GarageFitnessSurface.validateAction`'s real contract (`episodeId`
// required) so a malformed `launch:` block would still be caught here.
const refs = {
  manifestIds: new Set(manifests.map(([, m]) => m?.id)),
  documentIds: new Set(documents.map(([, d]) => d?.id)),
  bankIds: new Set(banks.map(([, b]) => b?.id)),
  programIds: new Set(['language', 'pe-daily']),
  surfaceValidators: new Map([
    ['garage-fitness', (raw) => ((raw && typeof raw.episodeId === 'string' && raw.episodeId) ? [] : ['episodeId required'])],
  ]),
};

const byUnitId = new Map(units.map(([, u]) => [u?.unitId, u]));
const bankById = new Map(banks.map(([, b]) => [b?.id, b]));
const documentById = new Map(documents.map(([, d]) => [d?.id, d]));

describe('sample curriculum: manifests', () => {
  it.each(manifests)('%s validates with no errors', (_file, raw) => {
    expect(validateManifest(raw).errors).toEqual([]);
  });
});

describe('sample curriculum: documents', () => {
  it.each(documents)('%s validates with no errors', (_file, raw) => {
    expect(validateDocument(raw).errors).toEqual([]);
  });
});

describe('sample curriculum: question banks', () => {
  it.each(banks)('%s validates with no errors', (_file, raw) => {
    const result = validateQuestionBank(raw);
    expect(result.errors ?? []).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('sample curriculum: units', () => {
  it.each(units)('%s validates with no errors and no dangling refs', (_file, raw) => {
    expect(validateUnit(raw, refs).errors).toEqual([]);
  });

  it.each(units)('%s is publishable', (_file, raw) => {
    expect(raw.provenance?.reviewState).toBe('approved');
    expect(isPublishable(raw)).toBe(true);
  });
});

// The math-fractions COURSE, specifically — as opposed to `units`, which is
// every *.yml in the fixture directory. Task 14 seeded `language-daily.yml`
// alongside it: a standalone, courseless, subject:language program unit, on
// purpose (spec §2.1). It is exercised on its own terms elsewhere
// (`fixtureIntegrity.test.mjs`, the school-agenda-v2 e2e journey) — the four
// assertions below are specifically about the COURSE's shape, so they filter
// to the units that actually carry `courseId: math-fractions` rather than
// asserting the whole directory is nothing but that course.
const courseUnits = units.filter(([, u]) => u.courseId === COURSE_ID);

describe('sample curriculum: course shape', () => {
  it('is four units under one courseId', () => {
    expect(courseUnits).toHaveLength(4);
    expect([...new Set(courseUnits.map(([, u]) => u.courseId))]).toEqual([COURSE_ID]);
  });

  it('sequences 1..4 with no gaps and no duplicates', () => {
    const sequences = courseUnits.map(([, u]) => u.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3, 4]);
  });

  it('is entirely subject: math', () => {
    expect([...new Set(courseUnits.map(([, u]) => u.subject))]).toEqual(['math']);
  });

  it('gives every unit real objectives', () => {
    courseUnits.forEach(([file, u]) => {
      expect(Array.isArray(u.objectives), `${file} objectives`).toBe(true);
      expect(u.objectives.length, `${file} objectives`).toBeGreaterThanOrEqual(3);
    });
  });

  it('exercises every delivery mode across the four units', () => {
    const has = (field) => courseUnits.some(([, u]) => u[field] !== undefined);
    expect({ media: has('media'), document: has('document'), bank: has('bank'), review: has('review') })
      .toEqual({ media: true, document: true, bank: true, review: true });
  });
});

describe('sample curriculum: unit 01 video lesson plus quiz', () => {
  const unit = () => byUnitId.get('math-fractions.01');

  it('binds a manifest and a bank', () => {
    expect(refs.manifestIds.has(unit().media)).toBe(true);
    expect(refs.bankIds.has(unit().bank)).toBe(true);
  });

  it('carries durable metadata beside the locator so the media can be rebound', () => {
    const manifest = manifests.find(([, m]) => m.id === unit().media)[1];
    expect(manifest.locator).toMatch(/^plex:\d+$/);
    expect(Boolean(manifest.series) || (manifest.aliases?.length ?? 0) > 0).toBe(true);
  });
});

describe('sample curriculum: unit 02 parent-graded worksheet', () => {
  const unit = () => byUnitId.get('math-fractions.02');

  it('is graded by a rubric, not a bank', () => {
    expect(unit().document).toBe('math-fractions-02-worksheet');
    expect(unit().bank).toBeUndefined();
    expect(unit().review).toBeTruthy();
  });

  it('rewards without a sign-off requirement', () => {
    const { reward } = validateUnit(unit(), refs).unit;
    expect(reward.amount).toBeGreaterThan(0);
    expect(reward.requiresSignoff).toBe(false);
  });

  it('offers retry variants so a second attempt is not the same sheet', () => {
    const { retry } = validateUnit(unit(), refs).unit;
    expect(retry.variants).toBeGreaterThanOrEqual(2);
  });

  it('prints math, answer space and a scan footer', () => {
    const doc = documentById.get(unit().document);
    const types = new Set();
    walkBlocks(doc.blocks, (block) => types.add(block.type));
    expect([...types]).toEqual(expect.arrayContaining(['rich_text', 'question', 'math', 'answer_space', 'scan_action']));
  });
});

describe('sample curriculum: unit 03 printed OMR checkpoint', () => {
  const unit = () => byUnitId.get('math-fractions.03');

  it('rewards only after a parent signs off', () => {
    const { reward } = validateUnit(unit(), refs).unit;
    expect(reward.amount).toBeGreaterThan(0);
    expect(reward.requiresSignoff).toBe(true);
  });

  // The link that makes paper grading work: bubble row → question → bank item.
  // If any hop breaks, the scanner marks up one item and the engine scores
  // another, and nobody finds out until a child is handed a wrong grade.
  it('ties every bubble row to its question AND to a real bank item', () => {
    const doc = documentById.get(unit().document);
    const bankItemIds = new Set(bankById.get(unit().bank).items.map((i) => i.id));

    const rows = [];
    walkBlocks(doc.blocks, (block, at, question) => {
      if (block.type !== 'omr_response') return;
      rows.push({ at, itemId: block.itemId, questionItemId: question?.itemId, choices: block.choices });
    });

    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(({ at, itemId, questionItemId }) => {
      expect(questionItemId, `${at}: omr_response outside a question`).toBeDefined();
      expect(itemId, `${at}: omr_response itemId vs enclosing question`).toBe(questionItemId);
      expect(bankItemIds.has(itemId), `${at}: itemId "${itemId}" is not in ${unit().bank}`).toBe(true);
    });

    // Every bank item reaches paper — an unprinted item would be scored blank.
    expect(new Set(rows.map((r) => r.itemId))).toEqual(bankItemIds);
  });

  it('prints as many bubbles as the bank item has choices', () => {
    const doc = documentById.get(unit().document);
    const choiceCount = new Map(bankById.get(unit().bank).items.map((i) => [i.id, i.choices?.length]));
    walkBlocks(doc.blocks, (block) => {
      if (block.type !== 'omr_response') return;
      expect(block.choices, `bubbles for ${block.itemId}`).toBe(choiceCount.get(block.itemId));
    });
  });
});

describe('sample curriculum: unit 04 mixed audio plus worksheet', () => {
  const unit = () => byUnitId.get('math-fractions.04');

  it('binds both an audio manifest and a worksheet', () => {
    expect(refs.manifestIds.has(unit().media)).toBe(true);
    expect(refs.documentIds.has(unit().document)).toBe(true);
  });

  it('gives the console a media action to start the read-aloud', () => {
    const doc = documentById.get(unit().document);
    const actions = [];
    walkBlocks(doc.blocks, (block) => { if (block.type === 'media_action') actions.push(block); });
    expect(actions).toHaveLength(1);
    // The action names the TOKEN CLASS, not the manifest. What plays comes from
    // the unit's `media:` ref; a manifest id here is a string printed into the
    // barcode area that no scan can resolve.
    expect(actions[0].action).toBe('media_action');
  });
});

// A barcode is printed onto a physical sheet a child is holding. If its
// `action` is not a token class, `IssueDocument` mints nothing, the renderer
// draws the literal string, and scanning it answers `not_school` — a dead end
// on a real artifact. This is the structural guard against re-introducing that.
describe('sample curriculum: every printed action is a real ticket', () => {
  it.each([...documentById.keys()])('%s declares only token classes', (documentId) => {
    const actions = [];
    walkBlocks(documentById.get(documentId).blocks, (block) => {
      if (block.type === 'scan_action' || block.type === 'media_action') actions.push(block);
    });
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(TOKEN_CLASSES, `${documentId}: '${action.action}' is not a token class`)
        .toContain(action.action);
      expect(typeof action.label).toBe('string');
      expect(action.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('sample curriculum: banks', () => {
  it('backlink each bank to the unit that serves it', () => {
    banks.forEach(([file, bank]) => {
      expect(byUnitId.has(bank.unit), `${file} unit backlink "${bank.unit}"`).toBe(true);
      expect(byUnitId.get(bank.unit).bank, `${file} is the bank of ${bank.unit}`).toBe(bank.id);
    });
  });
});

// \require is MathJax's browser-only loader; server-side it prints as red error
// text on the sheet a child is holding. blocks.mjs rejects it in math tex and
// rich_text md; this covers the fixtures as authored text, including the fields
// no validator reads.
describe('sample curriculum: printable math', () => {
  it('never uses the browser-only \\require macro anywhere in the course', () => {
    expect(sourceFiles.size).toBe(units.length + documents.length + manifests.length + banks.length);
    sourceFiles.forEach((abs, label) => {
      expect(readFileSync(abs, 'utf8'), label).not.toMatch(/\\require\s*\{/);
    });
  });
});
