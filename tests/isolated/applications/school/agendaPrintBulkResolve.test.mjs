/**
 * THE PORT PROOF for `agenda_print`.
 *
 * `feat/surround-containers` added the bulk-print feature against a
 * `ResolveAccessCode` that computed the plan itself, in a private
 * `#planForLearner`. Main then replaced that whole assembly with
 * `PlanProjection` (`refactor(school): ResolveAccessCode resolves through
 * PlanProjection`), and `#planForLearner` no longer exists.
 *
 * That is a shape the feature could silently fall through: the token class can
 * survive in `TOKEN_CLASSES`, the receipt can still print a bulk card, and the
 * six digits can still resolve to NOTHING because the resolver's bulk branch
 * was dropped or rewired to a helper that is gone. This file is the assertion
 * that it did not — an `agenda_print` code typed at the panel must come back as
 * a bulk card with a `bulk_print` resolution, computed through the REFACTORED
 * plan path.
 *
 * WHY IT LIVES HERE, not in `tests/isolated/domain/school/sessions/tokens.test.mjs`.
 * `ResolveAccessCode` is an application use case, and the domain suite may not
 * reach across the layer boundary to wire one. `tests/isolated/domain/` is also
 * a JEST target in `isolated.harness.mjs` while every file in it imports from
 * `vitest`, so a test added there does not run at all; `tests/isolated/applications/`
 * is a vitest target, so this one does.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ResolveAccessCode } from '#apps/school/usecases/ResolveAccessCode.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore, FakeTokenRegistry,
  fakeClock, seededRng, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawDocuments, rawManifests, BANK_IDS, WORKSHEET_UNIT, fixtureUnit,
} from '#testlib/school/lifecycleFixtures.mjs';

const MATH_CODE = '111111';
const ENGLISH_CODE = '222222';
const BULK_CODE = '999999';
/** The next 4am study-day rollover after the fake clock's 2026-07-27T09:00Z. */
const TOMORROW = '2026-07-28T04:00:00.000Z';

/**
 * TWO printable subjects, each first in its own course, DERIVED from the real
 * worksheet unit rather than hand-written (see `lifecycleFixtures`' header for
 * why nothing here is invented). The bulk token only mints for 2+ printable
 * subjects, and the committed fixture course has exactly one; its worksheet is
 * also unit 2 of 4, so on its own it plans as blocked behind unit 1 and offers
 * nothing to print.
 */
const sheetUnit = (unitId, courseId, subject, title) => ({
  ...fixtureUnit(WORKSHEET_UNIT), unitId, courseId, subject, sequence: 1, title,
});
const MATH_SHEET = sheetUnit('math-sheets.01', 'math-sheets', 'math', 'Fraction Practice');
const ENGLISH_SHEET = sheetUnit('english-sheets.01', 'english-sheets', 'english', 'Paragraph Practice');

let clock, sessions, tokens, useCase, appended, refTokens;

/** Delegates reads to the real fake, RECORDS every write. */
const recordingSessions = (repo, log) => ({
  listForLearner: (learnerId) => repo.listForLearner(learnerId),
  readEvents: (sessionId) => repo.readEvents(sessionId),
  async appendEvent(sessionId, event) {
    log.push([sessionId, event]);
    return repo.appendEvent(sessionId, event);
  },
});

const build = async () => {
  clock = fakeClock();
  appended = [];
  const catalog = new FakeCatalog({
    units: [MATH_SHEET, ENGLISH_SHEET],
    documents: rawDocuments(),
    manifests: rawManifests(),
  });
  const curriculum = new CurriculumAccess({
    catalog, bankIds: () => BANK_IDS, programIds: () => [],
    clock: clock.epoch, logger: silentLogger,
  });
  sessions = new FakeSessionRepository();
  const assignments = new FakeAssignmentStore([
    { learnerId: 'kid1', units: [MATH_SHEET.unitId, ENGLISH_SHEET.unitId] },
  ]);
  tokens = new FakeTokenRegistry({ now: clock.iso });

  const rng = seededRng();
  const expiresAt = new Date(clock.epoch() + 168 * 3_600_000).toISOString();
  refTokens = [];
  for (const [subject, code] of [['math', MATH_CODE], ['english', ENGLISH_CODE]]) {
    const record = mintToken({
      tokenClass: 'subject_next',
      subject: { learnerId: 'kid1', subject },
      at: clock.iso(), rng, expiresAt,
      accessCode: code, accessCodeExpiresAt: TOMORROW,
    });
    // eslint-disable-next-line no-await-in-loop
    await tokens.put(record);
    refTokens.push(record.token);
  }

  // The bulk envelope `BuildAgenda` mints when 2+ subjects are printable.
  await tokens.put(mintToken({
    tokenClass: 'agenda_print',
    subject: { learnerId: 'kid1', tokenRefs: refTokens },
    at: clock.iso(), rng, expiresAt,
    accessCode: BULK_CODE, accessCodeExpiresAt: TOMORROW,
  }));

  useCase = new ResolveAccessCode({
    tokens,
    curriculum,
    assignments,
    sessions: recordingSessions(sessions, appended),
    launchers: new Map(),
    issueDocument: { canIssueBank: () => false },
    roster: { displayName: () => 'Kid One' },
    selfService: { mediaSurface: { id: 'livingroom-tv', label: 'living room' } },
    clock: clock.now,
    logger: silentLogger,
  });
};

beforeEach(build);

describe('an agenda_print code at the panel', () => {
  it('resolves — the class is known, and the code is not junk', async () => {
    const card = await useCase.execute({ code: BULK_CODE });
    // The failure this guards: "agenda_print is not a known token class", or
    // the routing guard lost in the merge, both of which land here as the
    // generic unknown-code refusal instead of a card.
    expect(card.ok).toBe(true);
    expect(card.reason).toBeUndefined();
  });

  it('comes back as a bulk card listing every printable subject', async () => {
    const card = await useCase.execute({ code: BULK_CODE });
    expect(card.bulk).toBe(true);
    expect(card.title).toBe('Print all sheets');
    expect(card.items.map((item) => item.subject).sort()).toEqual(['english', 'math']);
    expect(card.items.map((item) => item.title).sort())
      .toEqual(['Fraction Practice', 'Paragraph Practice']);
    expect(card.actions.map((action) => action.kind)).toContain('print');
  });

  it('carries a bulk_print resolution naming the refs the action handler fans out over', async () => {
    const { resolution } = await useCase.resolve({ code: BULK_CODE });
    expect(resolution.kind).toBe('bulk_print');
    expect(resolution.learnerId).toBe('kid1');
    expect(resolution.refs.map((ref) => ref.token).sort()).toEqual([...refTokens].sort());
    // Each ref carries the plan entry `RunSelfServiceAction#bulkPrint` opens a
    // session against — a ref without one prints nothing.
    resolution.refs.forEach((ref) => expect(ref.entry?.unitId).toBeTruthy());
  });

  it('writes NOTHING — the read-only guarantee holds for the bulk path too', async () => {
    await useCase.resolve({ code: BULK_CODE });
    // The whole reason this use case exists beside `ResolveSubjectNext`: a
    // child typing six digits must not open a session. The bulk path fans out
    // over several entries, so it is the branch most able to break that.
    expect(appended).toEqual([]);
    expect(await sessions.listForLearner('kid1')).toEqual([]);
  });

  it('says "all done" rather than TRY_AGAIN once every ref is revoked', async () => {
    for (const token of refTokens) {
      // eslint-disable-next-line no-await-in-loop
      await tokens.revoke(token, { at: clock.iso() });
    }
    const card = await useCase.execute({ code: BULK_CODE });
    expect(card.ok).toBe(true);
    expect(card.items).toEqual([]);
    expect(card.sentence).toMatch(/all done/i);
    expect(card.actions.map((action) => action.kind)).toEqual(['exit']);
  });
});
