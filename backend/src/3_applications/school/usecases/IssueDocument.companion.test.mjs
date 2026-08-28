// backend/src/3_applications/school/usecases/IssueDocument.companion.test.mjs
// @vitest-environment node
//
// A REQUIRED companion binds its finish code before the paper prints.
//
// The code is drawn in `#prepareCompanion`, in the same breath as the six-digit
// access code and for the same stated reason — "so the retained PDF owns its
// code". Task 8's renderer prints it as a gate row; if it were resolved any
// later, the sheet in the child's hand and the record that grades it could
// disagree about what the gate says.
//
// Two names, two meanings, and they travel together: `accessCode` is the
// six-digit number that OPENS the companion, `finishCode` is the A–E set that
// finishing it RELEASES. They are never the same field.
//
// The store is a REAL `YamlCompanionCodeStore` over a temp directory, not a
// double. The behaviour under test is exactly the one a double would fake away:
// two children of one household landing on one record, and a catch-up a week
// later finding the code a sibling already earned.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { IssueDocument } from './IssueDocument.mjs';
import { YamlCompanionCodeStore } from '#adapters/persistence/yaml/YamlCompanionCodeStore.mjs';
import {
  FakeSessionRepository, FakeTokenRegistry, FakeFormMapStore, seededRng, silentLogger,
} from '../../../../../tests/_lib/school/lifecycleFakes.mjs';

const HOUSEHOLD = 'hh1';
const RECORDS = 'school/records/companion-codes';

let dir;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-companion-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const codeStore = () => new YamlCompanionCodeStore({
  configService: { getHouseholdPath: (rel) => path.join(dir, rel) },
  logger: silentLogger,
});

/** Every file the code store has written, by id. */
async function codeRecords() {
  const entries = await fs.readdir(path.join(dir, RECORDS)).catch(() => []);
  return entries.filter((name) => name.endsWith('.yml')).sort();
}

const bankFor = (id) => ({
  schema: 'school.question-bank/v2',
  id,
  title: id,
  items: Array.from({ length: 8 }, (_, index) => ({
    id: `${id}-q${index + 1}`,
    type: 'multiple_choice',
    prompt: `Question ${index + 1}?`,
    answer: 'Correct',
    decoys: ['One', 'Two', 'Three', 'Four', 'Five'],
    levels: ['lower', 'upper'],
  })),
});

/**
 * A real-shaped Come-Follow-Me unit, copied from
 * `data/content/school/scripture/come-follow-me-ot-2026/35-w35-aug24/`: the
 * unitId names the week and the weekday (`w35`, `d1`), the module names the
 * week and the date it opens, and NOTHING on the unit carries a calendar date
 * — which is exactly why the companion scope cannot read one off it.
 */
function unitFor({
  unitId = 'cfm-w35-d1-psalms-49-61',
  module = 'w35-aug24',
  sequence = 1,
  participation = 'optional',
  reading = 'Psalms 70',
} = {}) {
  return {
    unitId,
    title: `Lesson ${unitId}`,
    subject: 'scripture',
    courseId: 'come-follow-me-ot-2026',
    module,
    sequence,
    bank: `bank-${unitId}`,
    passing: { percent: 80 },
    provenance: { source: 'NIrV Adventure Bible', ...(reading ? { reading } : {}) },
    ...(participation
      ? { companion: { enabled: true, participation, label: 'Read along' } }
      : {}),
  };
}

/**
 * The bank-instance issuing pipeline, stood up around ONE shared code store so
 * several learners' prints can meet on the same record.
 */
function issuer({
  companionCodes, units, rng = seededRng(1), now = '2026-08-26T17:00:00.000Z',
  householdId = HOUSEHOLD, sessions = new FakeSessionRepository(),
  cardRequests = [],
}) {
  const unitsById = new Map(units.map((unit) => [unit.unitId, unit]));
  const instances = new Map();
  const published = new Map();
  const companions = { records: [], async put(record) { this.records.push(record); return record; } };
  const printer = { jobs: [], async printPdf(bytes, options) { this.jobs.push({ bytes, options }); return { ok: true }; } };
  const tokens = new FakeTokenRegistry({ now: () => now });

  const issueDocument = new IssueDocument({
    curriculum: {
      async getUnit(id) { return unitsById.get(id) ?? null; },
      async getDocument() { return null; },
      async listWorks() { return []; },
    },
    sessions,
    tokens,
    renderer: { async render() { throw new Error('the legacy renderer must not be reached'); } },
    printer,
    formMaps: new FakeFormMapStore(),
    bankReader: { getBank: (id) => bankFor(id) },
    assignments: {
      async get() {
        return {
          courses: [{
            courseId: 'cfm',
            profile: 'lower',
            enrollment: {
              enrollmentId: 'enr-1',
              moduleOrder: ['w35-aug24'],
              lessonOrder: { 'w35-aug24': units.map((u) => u.unitId) },
            },
          }],
        };
      },
    },
    worksheetInstances: {
      async findBySession(id) { return [...instances.values()].find((entry) => entry.sessionId === id) ?? null; },
      async put(instance) { instances.set(instance.id, instance); return instance; },
    },
    publishPrintDocument: {
      async execute({ source }) { published.set(`${source.id}@rev00000`, { ...source, rev: 'rev00000' }); return { id: source.id, rev: 'rev00000' }; },
    },
    printDocuments: { async getPublished(id, rev) { return published.get(`${id}@${rev}`) ?? null; } },
    renderPrintDocument: {
      async execute() {
        return {
          bytes: Buffer.from('%PDF sheet'), pageCount: 1, duplex: true,
          allocation: { cardId: '1234567', recordId: 'rec-1', rowRange: { start: 1, end: 4 } },
        };
      },
    },
    allocationStore: {
      async findReusableCard(request) { cardRequests.push(request); return null; },
      async release() { return []; },
    },
    companions,
    companionCodes,
    householdId,
    clock: () => new Date(now),
    rng,
    logger: silentLogger,
  });

  return { issueDocument, sessions, companions, printer, tokens, published, cardRequests };
}

async function seedSession(sessions, { sessionId, learnerId, unitId, at = '2026-08-26T17:00:00.000Z' }) {
  await sessions.appendEvent(sessionId, { type: 'created', at, sessionId, learnerId, unitId });
  return sessionId;
}

describe('IssueDocument — a required companion binds its finish code before the paper prints', () => {
  it('leaves an OPTIONAL companion exactly as it was: no finish code, no codeRef, no record', async () => {
    // The regression that would break every worksheet already in a folder.
    const companionCodes = codeStore();
    const unit = unitFor({ participation: 'optional' });
    const { issueDocument, sessions, companions, printer } = issuer({ companionCodes, units: [unit] });
    await seedSession(sessions, { sessionId: 'ses-opt', learnerId: 'kid1', unitId: unit.unitId });

    const result = await issueDocument.execute({ sessionId: 'ses-opt' });

    expect(result.status).toBe('issued');
    expect(printer.jobs).toHaveLength(1);
    expect(companions.records).toHaveLength(1);
    expect(companions.records[0].participation).toBe('optional');
    expect(companions.records[0].codeRef ?? null).toBeNull();
    expect(companions.records[0].finishCode ?? null).toBeNull();
    // Nothing was drawn at all — not merely hidden.
    expect(await codeRecords()).toEqual([]);
  });

  it('mints a finish code for a REQUIRED companion and binds it to the companion record', async () => {
    const companionCodes = codeStore();
    const unit = unitFor({ participation: 'required' });
    const { issueDocument, sessions, companions, printer } = issuer({ companionCodes, units: [unit] });
    await seedSession(sessions, { sessionId: 'ses-req', learnerId: 'kid1', unitId: unit.unitId });

    const result = await issueDocument.execute({ sessionId: 'ses-req' });

    expect(result.status).toBe('issued');
    expect(printer.jobs).toHaveLength(1);

    const record = companions.records[0];
    expect(record.participation).toBe('required');
    expect(record.codeRef).toMatch(/^cmc_[a-f0-9]{16,}$/);

    const minted = await companionCodes.get(record.codeRef);
    expect(minted.schema).toBe('school.companion-code/v1');
    expect(minted.id).toBe(record.codeRef);
    expect(minted.householdId).toBe(HOUSEHOLD);
    expect(minted.lessonId).toBe(unit.unitId);
    expect(minted.code.length).toBeGreaterThan(0);
    expect(minted.code.every((letter) => 'ABCDE'.includes(letter))).toBe(true);
    // Alphabet order, so one code has exactly one spelling everywhere.
    expect(minted.code).toEqual([...minted.code].sort());
    expect(minted.satisfiedAt).toBeNull();
  });

  it('gives two children of one household the SAME code for the same lesson', async () => {
    // The sharing decision: the scope drops the learner on purpose. One child
    // plays the audio through, and the household is satisfied.
    const companionCodes = codeStore();
    const unit = unitFor({ participation: 'required' });

    const first = issuer({ companionCodes, units: [unit], rng: seededRng(1) });
    await seedSession(first.sessions, { sessionId: 'ses-a', learnerId: 'kid1', unitId: unit.unitId });
    await first.issueDocument.execute({ sessionId: 'ses-a' });

    const second = issuer({ companionCodes, units: [unit], rng: seededRng(4242) });
    await seedSession(second.sessions, { sessionId: 'ses-b', learnerId: 'kid2', unitId: unit.unitId });
    await second.issueDocument.execute({ sessionId: 'ses-b' });

    const refA = first.companions.records[0].codeRef;
    const refB = second.companions.records[0].codeRef;
    expect(refB).toBe(refA);
    // ONE record, not two — the second print never drew a code of its own,
    // however differently its rng was seeded.
    expect(await codeRecords()).toHaveLength(1);
    const [codeA, codeB] = [await companionCodes.get(refA), await companionCodes.get(refB)];
    expect(codeB.code).toEqual(codeA.code);
  });

  it('hands a sibling catching up a WEEK LATER the code the household already earned', async () => {
    // Pinning: the key is derived from the lesson, never from the day it was
    // printed. A clock-derived key would put a second, unearned code on this
    // sheet and force a replay of audio the household has already finished.
    const companionCodes = codeStore();
    const unit = unitFor({ participation: 'required' });

    const onTime = issuer({ companionCodes, units: [unit], now: '2026-08-26T17:00:00.000Z' });
    await seedSession(onTime.sessions, { sessionId: 'ses-ontime', learnerId: 'kid1', unitId: unit.unitId, at: '2026-08-26T17:00:00.000Z' });
    await onTime.issueDocument.execute({ sessionId: 'ses-ontime' });

    const catchUp = issuer({ companionCodes, units: [unit], now: '2026-09-02T17:00:00.000Z', rng: seededRng(99) });
    await seedSession(catchUp.sessions, { sessionId: 'ses-late', learnerId: 'kid2', unitId: unit.unitId, at: '2026-09-02T17:00:00.000Z' });
    await catchUp.issueDocument.execute({ sessionId: 'ses-late' });

    expect(catchUp.companions.records[0].codeRef).toBe(onTime.companions.records[0].codeRef);
    expect(await codeRecords()).toHaveLength(1);
  });

  it('keeps two DIFFERENT lessons on two different codes, even inside one week', async () => {
    // Monday and Wednesday of the same module: same course, same week, same
    // `lessonDay` scope component — different audio, so different codes. The
    // lessonId is what separates them, which is the whole reason it can be.
    const companionCodes = codeStore();
    const monday = unitFor({ unitId: 'cfm-w35-d1-psalms-49-61', sequence: 1, participation: 'required' });
    const tuesday = unitFor({ unitId: 'cfm-w35-d3-psalms-70-77', sequence: 3, participation: 'required' });
    const { issueDocument, sessions, companions } = issuer({
      companionCodes, units: [monday, tuesday],
    });
    await seedSession(sessions, { sessionId: 'ses-mon', learnerId: 'kid1', unitId: monday.unitId });
    await seedSession(sessions, { sessionId: 'ses-tue', learnerId: 'kid1', unitId: tuesday.unitId });

    await issueDocument.execute({ sessionId: 'ses-mon' });
    await issueDocument.execute({ sessionId: 'ses-tue' });

    const [refMon, refTue] = companions.records.map((record) => record.codeRef);
    expect(refTue).not.toBe(refMon);
    expect(await codeRecords()).toHaveLength(2);
    const [mon, tue] = [await companionCodes.get(refMon), await companionCodes.get(refTue)];
    expect(tue.lessonId).not.toBe(mon.lessonId);
    expect(tue.code).not.toEqual(mon.code);
  });

  it('REFUSES to print a required companion it has no media for, rather than a gate no child can clear', async () => {
    const companionCodes = codeStore();
    // `required`, but nothing resolves to a playlist: no reading to read along to.
    const unit = unitFor({ participation: 'required', reading: null });
    const { issueDocument, sessions, companions, printer } = issuer({ companionCodes, units: [unit] });
    await seedSession(sessions, { sessionId: 'ses-nomedia', learnerId: 'kid1', unitId: unit.unitId });

    const result = await issueDocument.execute({ sessionId: 'ses-nomedia' });

    expect(result.status).toBe('unavailable');
    expect(result.message).toMatch(/grown-up/i);
    expect(printer.jobs).toEqual([]);
    expect(companions.records).toEqual([]);
    expect(await codeRecords()).toEqual([]);
    // The session did not advance: the child's ticket is still good.
    expect(sessions.derive('ses-nomedia').issuedArtifacts).toEqual([]);
  });

  it('REFUSES a required companion whose stored code is unusable, rather than printing an ungated sheet', async () => {
    // The store validates a record's SHAPE and its identity, never its `code`.
    // A truncated or hand-edited YAML whose `code:` key is gone reads back
    // perfectly cleanly — and `null` is the in-band value meaning "optional,
    // print no gate", so the renderer's own guard cannot fire and it has no way
    // to know the companion was required. Without this refusal the sheet prints
    // UNGATED and a child passes without the media, which is the single outcome
    // this whole feature exists to prevent.
    const companionCodes = codeStore();
    const unit = unitFor({ participation: 'required' });
    const { issueDocument, sessions, printer } = issuer({ companionCodes, units: [unit] });
    await seedSession(sessions, { sessionId: 'ses-nocode', learnerId: 'kid1', unitId: unit.unitId });

    // Pre-seed the record the lesson will resolve to, with its code missing.
    const key = companionCodes.keyFor({
      householdId: HOUSEHOLD, lessonId: unit.unitId, lessonDay: unit.module,
    });
    await companionCodes.findOrCreate({ key, create: () => ({ id: key, code: null }) });

    const result = await issueDocument.execute({ sessionId: 'ses-nocode' });

    expect(result.status).toBe('unavailable');
    expect(result.message).toMatch(/grown-up/i);
    expect(printer.jobs).toEqual([]);
    expect(sessions.derive('ses-nocode').issuedArtifacts).toEqual([]);
  });

  it('lets a REQUIRED companion access code live as long as its record, and leaves an optional one on the study day', async () => {
    // A required gate a child cannot reopen tomorrow morning wedges them for
    // nothing: the sheet is still in the folder, and the 4am boundary already
    // expired the only way back into the audio.
    const required = unitFor({ unitId: 'cfm-w35-d1-psalms-49-61', sequence: 1, participation: 'required' });
    const optional = unitFor({ unitId: 'cfm-w35-d3-psalms-70-77', sequence: 3, participation: 'optional' });
    const { issueDocument, sessions, tokens } = issuer({
      companionCodes: codeStore(), units: [required, optional],
    });
    await seedSession(sessions, { sessionId: 'ses-r', learnerId: 'kid1', unitId: required.unitId });
    await seedSession(sessions, { sessionId: 'ses-o', learnerId: 'kid1', unitId: optional.unitId });

    await issueDocument.execute({ sessionId: 'ses-r' });
    await issueDocument.execute({ sessionId: 'ses-o' });

    const [requiredToken, optionalToken] = tokens.ofClass('worksheet_companion');
    expect(requiredToken.accessCodeExpiresAt).toBe(requiredToken.expiresAt);
    expect(Date.parse(requiredToken.expiresAt) - Date.parse(requiredToken.issuedAt))
      .toBe(7 * 24 * 3_600_000);
    // Untouched for an optional companion: still the household's study day.
    expect(optionalToken.accessCodeExpiresAt).not.toBe(optionalToken.expiresAt);
    expect(Date.parse(optionalToken.accessCodeExpiresAt))
      .toBeLessThan(Date.parse(optionalToken.expiresAt));
  });
});

/**
 * Task 8: the code has to reach the PAPER, and only the paper.
 *
 * Task 7 drew the finish code and deliberately kept it off `execute()`'s return
 * value, because that result travels to `ResolveScanAction` and out to a
 * browser — a child who could read it there would clear the gate without ever
 * playing the media. So the code goes into the published print document (from
 * which the gate row is drawn and the answer key is printed) and nowhere else.
 */
describe('IssueDocument — the finish code reaches the printed sheet and nothing else', () => {
  const gateOf = (document) => (document?.blocks ?? []).find((block) => block.companionGate === true) ?? null;

  it('prints a gate row carrying the code that was minted for the lesson', async () => {
    const companionCodes = codeStore();
    const unit = unitFor({ participation: 'required' });
    const { issueDocument, sessions, companions, published } = issuer({ companionCodes, units: [unit] });
    await seedSession(sessions, { sessionId: 'ses-gate', learnerId: 'kid1', unitId: unit.unitId });

    await issueDocument.execute({ sessionId: 'ses-gate' });

    const minted = await companionCodes.get(companions.records[0].codeRef);
    const [document] = [...published.values()];
    const gate = gateOf(document);

    expect(gate).not.toBeNull();
    expect(gate.code).toEqual(minted.code);
    expect(gate.choices).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(gate.omr).toBe(true);
  });

  it('prints NO gate row for an optional companion', async () => {
    // The regression that would otherwise alter every worksheet in the house.
    const companionCodes = codeStore();
    const unit = unitFor({ participation: 'optional' });
    const { issueDocument, sessions, published } = issuer({ companionCodes, units: [unit] });
    await seedSession(sessions, { sessionId: 'ses-nogate', learnerId: 'kid1', unitId: unit.unitId });

    await issueDocument.execute({ sessionId: 'ses-nogate' });

    const [document] = [...published.values()];
    expect(gateOf(document)).toBeNull();
    expect(JSON.stringify(document)).not.toContain('companionGate');
  });

  it('asks for one MORE card row than the worksheet has questions', async () => {
    // Off by one here and the last question falls off the end of the card.
    const companionCodes = codeStore();
    const required = unitFor({ unitId: 'cfm-req', participation: 'required' });
    const optional = unitFor({ unitId: 'cfm-opt', participation: 'optional' });
    const { issueDocument, sessions, published, cardRequests } = issuer({
      companionCodes, units: [required, optional],
    });
    await seedSession(sessions, { sessionId: 'ses-rows-r', learnerId: 'kid1', unitId: required.unitId });
    await seedSession(sessions, { sessionId: 'ses-rows-o', learnerId: 'kid1', unitId: optional.unitId });

    await issueDocument.execute({ sessionId: 'ses-rows-r' });
    await issueDocument.execute({ sessionId: 'ses-rows-o' });

    const questionCount = [...published.values()]
      .find((document) => gateOf(document))
      .blocks.filter((block) => block.type === 'question' && !block.companionGate).length;

    expect(cardRequests).toHaveLength(2);
    expect(cardRequests[0].rowsNeeded).toBe(questionCount + 1);
    expect(cardRequests[1].rowsNeeded).toBe(questionCount);
  });

  it('never puts the finish code anywhere the browser can reach', async () => {
    const companionCodes = codeStore();
    const unit = unitFor({ participation: 'required' });
    const { issueDocument, sessions, companions } = issuer({ companionCodes, units: [unit] });
    await seedSession(sessions, { sessionId: 'ses-leak', learnerId: 'kid1', unitId: unit.unitId });

    const result = await issueDocument.execute({ sessionId: 'ses-leak' });
    const minted = await companionCodes.get(companions.records[0].codeRef);

    // The whole result, serialised — this is what `ResolveScanAction` answers a
    // browser with. Neither the letters nor the field name may appear in it.
    //
    // RANDOM IDS ARE MASKED FIRST. `shortId` draws from `Math.random`, not the
    // injected rng, so `ral_uEN4PCaEkHcA` is a fresh mixed-case string every
    // run — and a single-letter code (5 of the 31 are) joins to one character
    // that such an id contains often enough to fail this test for nobody's bug.
    // It flaked that way on 2026-08-28. Masking the ids keeps the assertion at
    // full strength over every field that actually carries content.
    const serialised = (value) => JSON.stringify(value).replace(/\bral_[A-Za-z0-9_-]+/g, 'ral_ID');
    expect(serialised(result)).not.toContain('finishCode');
    expect(serialised(result)).not.toContain(minted.code.join(''));
    expect(result.document).toBeNull();
    // The companion record a child's list is built from carries the ACCESS code
    // only — the reference to the code record, never the code itself.
    expect(companions.records[0].finishCode ?? null).toBeNull();
    expect(serialised(companions.records[0])).not.toContain(minted.code.join(''));
  });
});

describe('requireParts is settled at mint time, from the unit', () => {
  // Psalms 70–72; 77 — four chapters, and typically only ONE has to be
  // finished. Before `companion.requireParts` was authorable, every code minted
  // demanded all four, which made the "one chapter" design decision unreachable
  // in production and turned any single refused chapter into a whole-lesson
  // lockout for every child in the household.
  const FOUR_CHAPTERS = 'Psalms 70–72; 77';

  const withRequireParts = (requireParts) => {
    const unit = unitFor({ participation: 'required', reading: FOUR_CHAPTERS });
    return { ...unit, companion: { ...unit.companion, ...(requireParts != null ? { requireParts } : {}) } };
  };

  /** Issue one worksheet and hand back the minted code record. */
  async function mint(unit) {
    const companionCodes = codeStore();
    const { issueDocument, sessions, companions } = issuer({ companionCodes, units: [unit] });
    await seedSession(sessions, { sessionId: 'ses-rp', learnerId: 'kid1', unitId: unit.unitId });
    const result = await issueDocument.execute({ sessionId: 'ses-rp' });
    expect(result.status).toBe('issued');
    return companionCodes.get(companions.records[0].codeRef);
  }

  it('mints the authored count, so one chapter of four can be all the gate wants', async () => {
    expect((await mint(withRequireParts(1))).requireParts).toBe(1);
  });

  it("resolves 'all' against the playlist that actually got built", async () => {
    // A word, not a number: the playlist length is not known when the unit is
    // authored, so writing `4` to mean "all of them" would silently become
    // "the first four" the week the reading gains a fifth chapter.
    expect((await mint(withRequireParts('all'))).requireParts).toBe(4);
  });

  it('defaults an unauthored companion to every part, exactly as it minted before', async () => {
    expect((await mint(withRequireParts(null))).requireParts).toBe(4);
  });

  it('clamps a count larger than the reading, so the gate stays openable', async () => {
    // An author who trims a reading after writing the number would otherwise
    // leave a gate no child could ever clear.
    expect((await mint(withRequireParts(9))).requireParts).toBe(4);
  });
});
