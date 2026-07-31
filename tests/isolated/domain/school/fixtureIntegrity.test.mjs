/**
 * THE GUARD: every School fixture must survive PRODUCTION validation.
 *
 * A test fixture is a claim about what the system will be handed in the house.
 * When that claim is false, every assertion built on it is theatre — and the
 * suite goes green over a defect. That is not hypothetical here: a hand-written
 * `omrBank()` stored a bubble LETTER where the real bank stores the answer TEXT,
 * so eight application tests certified a decoder that graded 0 out of 6.
 *
 * So: every fixture the School suites use is walked here and run through the
 * SAME validator the runtime catalog runs — `validateQuestionBank`,
 * `validateUnit`, `validateDocument`, `validateManifest`. Zero errors, asserted
 * with `toEqual([])` so a failure names the actual problem rather than saying
 * `false !== true`.
 *
 * TWO SOURCES, ONE STANDARD:
 *   1. the committed YAML under `tests/_fixtures/school/curriculum/`
 *   2. every object literal `tests/_lib/school/lifecycleFixtures.mjs` exports
 *
 * AND IT IS CLOSED. `describes every export` fails when a new name appears in
 * lifecycleFixtures without a declared kind, so a future fixture cannot be added
 * that skips validation — which is what makes reintroducing fiction a failing
 * test rather than a code-review hope.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';

import { validateQuestionBank } from '#domains/school/questionBankValidation.mjs';
import { validateUnit } from '#domains/school/curriculum/unitValidation.mjs';
import { validateManifest } from '#domains/school/curriculum/manifestValidation.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';
import * as lifecycleFixtures from '#testlib/school/lifecycleFixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const CURRICULUM_DIR = path.join(REPO_ROOT, 'tests', '_fixtures', 'school', 'curriculum');

// ---------------------------------------------------------------------------
// the validators, behind one signature
// ---------------------------------------------------------------------------

/**
 * `validateQuestionBank` answers `{ok, errors?}` and the curriculum validators
 * answer `{errors}`. Both mean the same thing; this is the shared shape so a
 * table-driven walk does not have to know which is which.
 */
const errorsOf = (result) => (Array.isArray(result?.errors) ? result.errors : []);

/** kind → (raw, sets) => string[] */
const VALIDATORS = Object.freeze({
  bank: (raw) => errorsOf(validateQuestionBank(raw)),
  unit: (raw, sets) => errorsOf(validateUnit(raw, sets)),
  document: (raw) => errorsOf(validateDocument(raw)),
  manifest: (raw) => errorsOf(validateManifest(raw)),
});

// ---------------------------------------------------------------------------
// the committed curriculum YAML
// ---------------------------------------------------------------------------

const readDir = (kind) => fs.readdirSync(path.join(CURRICULUM_DIR, kind))
  .filter((f) => f.endsWith('.yml'))
  .map((file) => ({
    file: `${kind}/${file}`,
    raw: yaml.load(fs.readFileSync(path.join(CURRICULUM_DIR, kind, file), 'utf8')),
  }));

const yamlBanks = readDir('banks');
const yamlUnits = readDir('units');
const yamlDocuments = readDir('documents');
const yamlManifests = readDir('manifests');

/**
 * A unit's references resolve against sets the CALLER injects, exactly as the
 * catalog builds them at load time. Built from the fixtures themselves, so a
 * unit pointing at a bank nobody ships is an error here rather than at the
 * printer with a child standing beside it.
 *
 * `programIds` and `surfaceValidators` are the two sets NOT derived from a
 * fixture directory — a program unit's `program:` value names a registered
 * LAUNCHER (composition root, `[...launchers.keys()]`), and a `launch:`
 * unit's `surface:` names a registered DoNow SURFACE ADAPTER, neither a file
 * on disk. `language` and `pe-daily` are the two programs the house registers
 * today (`LanguageProgramLauncher`, and the DoNow launch-journey e2e's own
 * `school.yml` `programs:` entry — Task 14); `garage-fitness` is one of
 * DoNow's own unconditionally-registered surfaces (`donow.mjs`). The
 * stand-in validator mirrors `GarageFitnessSurface.validateAction`'s real
 * contract (`episodeId` required).
 */
const setsFrom = ({
  banks = [], documents = [], manifests = [], programs = ['language', 'pe-daily'],
} = {}) => ({
  bankIds: new Set(banks.map((b) => b?.id).filter(Boolean)),
  documentIds: new Set(documents.map((d) => d?.id).filter(Boolean)),
  manifestIds: new Set(manifests.map((m) => m?.id).filter(Boolean)),
  programIds: new Set(programs),
  surfaceValidators: new Map([
    ['garage-fitness', (raw) => ((raw && typeof raw.episodeId === 'string' && raw.episodeId) ? [] : ['episodeId required'])],
  ]),
});

const yamlSets = setsFrom({
  banks: yamlBanks.map((e) => e.raw),
  documents: yamlDocuments.map((e) => e.raw),
  manifests: yamlManifests.map((e) => e.raw),
});

describe('tests/_fixtures/school/curriculum — the committed sample course', () => {
  it('ships at least one of every kind (an empty walk proves nothing)', () => {
    expect(yamlBanks.length).toBeGreaterThan(0);
    expect(yamlUnits.length).toBeGreaterThan(0);
    expect(yamlDocuments.length).toBeGreaterThan(0);
    expect(yamlManifests.length).toBeGreaterThan(0);
  });

  it.each(yamlBanks.map((e) => [e.file, e.raw]))('%s is a valid question bank', (_file, raw) => {
    expect(VALIDATORS.bank(raw)).toEqual([]);
  });

  it.each(yamlDocuments.map((e) => [e.file, e.raw]))('%s is a valid document', (_file, raw) => {
    expect(VALIDATORS.document(raw)).toEqual([]);
  });

  it.each(yamlManifests.map((e) => [e.file, e.raw]))('%s is a valid manifest', (_file, raw) => {
    expect(VALIDATORS.manifest(raw)).toEqual([]);
  });

  it.each(yamlUnits.map((e) => [e.file, e.raw]))('%s is a valid unit whose refs all resolve', (_file, raw) => {
    expect(VALIDATORS.unit(raw, yamlSets)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// lifecycleFixtures.mjs — the in-memory fixtures the application tests use
// ---------------------------------------------------------------------------

/**
 * Every export, declared. `kind` picks the validator; the non-data kinds are
 * spelled out rather than allowed by omission, because "it isn't really data"
 * is precisely the excuse an invalid fixture would arrive under.
 *
 *   unit|document|manifest|bank — validated below, no exceptions
 *   formMap                     — a RENDERER artifact, so it has no curriculum
 *                                 validator; checked for coherence with the
 *                                 bank and document it claims to describe
 *   id | idList                 — an identifier, checked to resolve
 *   bubbleChoice                — a derivation (itemId → bubble letter), checked
 *                                 to land on the bank's own answer
 *
 * An export taking arguments carries a `sample` thunk, so a parameterised
 * accessor is validated over real inputs rather than exempted for being a
 * function.
 */
const DECLARED = Object.freeze({
  MEDIA_UNIT: { kind: 'id', resolves: 'unit' },
  WORKSHEET_UNIT: { kind: 'id', resolves: 'unit' },
  OMR_UNIT: { kind: 'id', resolves: 'unit' },
  MIXED_UNIT: { kind: 'id', resolves: 'unit' },
  COURSE_ID: { kind: 'id', resolves: 'course' },
  OMR_BANK_ID: { kind: 'id', resolves: 'bank' },
  MEDIA_BANK_ID: { kind: 'id', resolves: 'bank' },
  OMR_DOCUMENT_ID: { kind: 'id', resolves: 'document' },
  WORKSHEET_DOCUMENT_ID: { kind: 'id', resolves: 'document' },
  BANK_IDS: { kind: 'idList', resolves: 'bank' },
  rawUnits: { kind: 'unit', many: true },
  rawDocuments: { kind: 'document', many: true },
  rawManifests: { kind: 'manifest', many: true },
  rawBanks: { kind: 'bank', many: true },
  fixtureUnit: {
    kind: 'unit',
    many: true,
    sample: (m) => [m.MEDIA_UNIT, m.WORKSHEET_UNIT, m.OMR_UNIT, m.MIXED_UNIT].map((id) => m.fixtureUnit(id)),
  },
  fixtureDocument: {
    kind: 'document',
    many: true,
    sample: (m) => m.rawDocuments().map((d) => m.fixtureDocument(d.id)),
  },
  fixtureBank: {
    kind: 'bank',
    many: true,
    sample: (m) => m.BANK_IDS.map((id) => m.fixtureBank(id)),
  },
  printedFormMap: { kind: 'formMap' },
  correctBubbles: { kind: 'bubbleChoice' },
});

const call = (name) => {
  const spec = DECLARED[name];
  if (spec.sample) return spec.sample(lifecycleFixtures);
  const value = lifecycleFixtures[name];
  return typeof value === 'function' ? value() : value;
};
const asList = (value) => (Array.isArray(value) ? value : [value]);

const declaredOf = (kind) => Object.entries(DECLARED)
  .filter(([, spec]) => spec.kind === kind)
  .flatMap(([name]) => asList(call(name)).map((raw, i) => [
    DECLARED[name].many ? `${name}()[${i}]` : `${name}()`, raw,
  ]));

const fixtureUnits = declaredOf('unit');
const fixtureDocuments = declaredOf('document');
const fixtureManifests = declaredOf('manifest');
const fixtureBanks = declaredOf('bank');

const fixtureSets = setsFrom({
  banks: fixtureBanks.map(([, raw]) => raw),
  documents: fixtureDocuments.map(([, raw]) => raw),
  manifests: fixtureManifests.map(([, raw]) => raw),
});
// The bank ids a unit may reference are the ones the suite DECLARES it serves,
// not only the ones it happens to hand back as objects: `BANK_IDS` is what the
// application tests feed `CurriculumAccess`, so it is what a ref resolves in.
for (const id of asList(call('BANK_IDS'))) fixtureSets.bankIds.add(id);

describe('tests/_lib/school/lifecycleFixtures.mjs — the in-memory fixtures', () => {
  it('describes every export, so nothing can be added that skips validation', () => {
    expect(Object.keys(lifecycleFixtures).filter((k) => k !== 'default').sort())
      .toEqual(Object.keys(DECLARED).sort());
  });

  it('exports at least one fixture of each validated kind', () => {
    expect(fixtureUnits.length).toBeGreaterThan(0);
    expect(fixtureDocuments.length).toBeGreaterThan(0);
    expect(fixtureManifests.length).toBeGreaterThan(0);
    expect(fixtureBanks.length).toBeGreaterThan(0);
  });

  it.each(fixtureBanks)('%s is a valid question bank', (_at, raw) => {
    expect(VALIDATORS.bank(raw)).toEqual([]);
  });

  it.each(fixtureDocuments)('%s is a valid document', (_at, raw) => {
    expect(VALIDATORS.document(raw)).toEqual([]);
  });

  it.each(fixtureManifests)('%s is a valid manifest', (_at, raw) => {
    expect(VALIDATORS.manifest(raw)).toEqual([]);
  });

  it.each(fixtureUnits)('%s is a valid unit whose refs all resolve', (_at, raw) => {
    expect(VALIDATORS.unit(raw, fixtureSets)).toEqual([]);
  });

  it('every declared id resolves to a fixture of the kind it names', () => {
    const known = {
      unit: new Set(fixtureUnits.map(([, raw]) => raw?.unitId)),
      course: new Set(fixtureUnits.map(([, raw]) => raw?.courseId).filter(Boolean)),
      document: fixtureSets.documentIds,
      manifest: fixtureSets.manifestIds,
      bank: fixtureSets.bankIds,
    };
    const dangling = [];
    for (const [name, spec] of Object.entries(DECLARED)) {
      if (spec.kind !== 'id' && spec.kind !== 'idList') continue;
      for (const id of asList(call(name))) {
        if (!known[spec.resolves].has(id)) dangling.push(`${name}: ${spec.resolves} '${id}' not found`);
      }
    }
    expect(dangling).toEqual([]);
  });

  /**
   * The bank/paper join, in the one place it can be checked cheaply. A helper
   * that returns a letter whose bubble carries the wrong text is the 0-of-6 bug
   * wearing a different hat.
   */
  it('correctBubbles lands on the bubble whose printed text IS the bank answer', () => {
    const formMap = lifecycleFixtures.printedFormMap();
    const bank = lifecycleFixtures.fixtureBank(lifecycleFixtures.OMR_BANK_ID);
    const chosen = lifecycleFixtures.correctBubbles({ formMap, bankId: bank.id });

    expect(Object.keys(chosen).sort()).toEqual(bank.items.map((i) => i.id).sort());
    const wrong = bank.items
      .map((item) => {
        const bubble = formMap.marks.find((m) => m.itemId === item.id && m.choice === chosen[item.id]);
        return bubble?.label === item.answer
          ? null
          : `${item.id}: bubble ${chosen[item.id]} reads ${JSON.stringify(bubble?.label)}, answer is ${JSON.stringify(item.answer)}`;
      })
      .filter(Boolean);
    expect(wrong).toEqual([]);

    // And the `wrong` lever really does miss, or a "failed attempt" test would
    // be quietly asserting a pass.
    const missed = lifecycleFixtures.correctBubbles({ formMap, bankId: bank.id, wrong: [bank.items[0].id] });
    const missedBubble = formMap.marks.find((m) => m.itemId === bank.items[0].id && m.choice === missed[bank.items[0].id]);
    expect(missedBubble.label).not.toBe(bank.items[0].answer);
  });
});

// ---------------------------------------------------------------------------
// the form map: a renderer artifact, held to the paper it claims to describe
// ---------------------------------------------------------------------------

/**
 * A form map is what the mark reader joins a scanned bubble against, so a mark
 * that carries no `label` is a bubble with no choice text under it — an
 * unanswerable sheet — and a label the bank never offered grades the wrong item.
 * `DocumentPdfRenderer.drawOmrRow` writes `{itemId, choice, label, xPt, yPt,
 * rPt, page}`; anything less is not the artifact production stores.
 */
describe('the OMR form map matches the bank and the document it describes', () => {
  const formMaps = Object.entries(DECLARED)
    .filter(([, spec]) => spec.kind === 'formMap')
    .map(([name]) => [`${name}()`, call(name)]);

  it('there is one to check', () => {
    expect(formMaps.length).toBeGreaterThan(0);
  });

  it.each(formMaps)('%s carries every field the renderer writes', (_at, formMap) => {
    expect(Array.isArray(formMap?.marks) && formMap.marks.length > 0).toBe(true);
    const malformed = formMap.marks
      .filter((m) => !(typeof m?.itemId === 'string' && typeof m?.choice === 'string'
        && typeof m?.label === 'string' && m.label.trim().length > 0
        && Number.isFinite(m?.xPt) && Number.isFinite(m?.yPt)
        && Number.isFinite(m?.rPt) && Number.isInteger(m?.page)))
      .map((m) => JSON.stringify(m));
    expect(malformed).toEqual([]);
  });

  it.each(formMaps)('%s bubbles the bank\'s own choices, answer included', (_at, formMap) => {
    const bank = fixtureBanks.map(([, raw]) => raw).find((b) => formMap.marks.some((m) => b?.items?.some((i) => i.id === m.itemId)));
    expect(bank, `no fixture bank owns the items in ${formMap.documentId}`).toBeTruthy();

    const mismatches = [];
    for (const item of bank.items) {
      const bubbles = formMap.marks.filter((m) => m.itemId === item.id);
      if (!bubbles.length) continue;
      const labels = bubbles.map((m) => m.label);
      if (JSON.stringify(labels) !== JSON.stringify(item.choices)) {
        mismatches.push(`${item.id}: bubbles ${JSON.stringify(labels)} != bank choices ${JSON.stringify(item.choices)}`);
      }
      if (!labels.includes(item.answer)) mismatches.push(`${item.id}: no bubble carries the answer ${JSON.stringify(item.answer)}`);
    }
    expect(mismatches).toEqual([]);
  });

  it.each(formMaps)('%s names a document the fixtures actually ship', (_at, formMap) => {
    expect(fixtureSets.documentIds.has(formMap.documentId)).toBe(true);
  });
});
