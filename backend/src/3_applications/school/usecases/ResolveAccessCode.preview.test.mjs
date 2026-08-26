/**
 * The launch-card preview: a teacher opens a card from a link instead of
 * minting a six-digit panel code for a child.
 *
 * THE WHOLE POINT IS THAT IT IS NOT A SECOND SURFACE. A preview that built a
 * card its own way would test something the house does not run, so the first
 * test here pins the preview's card against the card the SAME learner and
 * subject produce through a real token — field for field, taxonomy and all.
 *
 * And the second point: it mints nothing. No token is looked up, no session is
 * opened, no event is appended. The doubles below record every write they are
 * offered and the test asserts the ledger stayed empty.
 */
import { describe, expect, it } from 'vitest';
import { ResolveAccessCode } from './ResolveAccessCode.mjs';
import { encodeLaunchPreviewLink } from '#domains/school/selfService/launchPreviewLink.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';

const LEARNER_ID = 'learner4';
const SUBJECT = 'scripture';
const NOW_ISO = '2026-08-25T18:00:00.000Z';

const unitA = { unitId: 'scripture-a', title: 'Scripture A', subject: SUBJECT, courseId: 'psalms' };
const unitB = { unitId: 'scripture-b', title: 'Scripture B', subject: SUBJECT, courseId: 'psalms' };

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

const curriculum = () => ({
  async listUnits() { return [unitA, unitB]; },
  async listWorks() { return [{ subject: SUBJECT, work: 'psalms', title: 'Psalms' }]; },
});

const assignments = () => ({ async get() { return { units: ['scripture-a', 'scripture-b'] }; } });

/**
 * Every mutating door a use case could reach for, wired to a ledger. A preview
 * that opens work shows up here as a non-empty array.
 */
function spyStores({ served = false } = {}) {
  const writes = [];
  const reads = [];
  const history = served ? [{
    sessionId: 'session-a',
    learnerId: LEARNER_ID,
    unitId: unitA.unitId,
    state: 'outcome_recorded',
    terminal: true,
    outcome: { result: 'passed', at: NOW_ISO },
    gradedPercent: 100,
    updatedAt: NOW_ISO,
  }] : [];
  const sessions = {
    async listForLearner() { return history; },
    async readEvents(sessionId) { reads.push(sessionId); return []; },
    async appendEvent(sessionId, event) { writes.push({ store: 'sessions', sessionId, event }); return event; },
    async create(...args) { writes.push({ store: 'sessions', op: 'create', args }); return null; },
  };
  const tokens = {
    lookups: [],
    async getByAccessCode(code) { tokens.lookups.push(code); return null; },
    async mint(...args) { writes.push({ store: 'tokens', op: 'mint', args }); return null; },
    async save(...args) { writes.push({ store: 'tokens', op: 'save', args }); return null; },
  };
  return { writes, reads, sessions, tokens };
}

const resolverWith = ({ sessions, tokens, planProjection = null, roster = null }) => new ResolveAccessCode({
  tokens,
  curriculum: curriculum(),
  assignments: assignments(),
  sessions,
  roster,
  ...(planProjection ? { planProjection } : {}),
  clock: () => new Date(NOW_ISO),
  logger: noopLogger,
});

function tokenRecord() {
  let n = 0;
  const rng = () => { n += 1; return (n % 97) / 97; };
  return mintToken({
    tokenClass: 'subject_next',
    subject: { learnerId: LEARNER_ID, subject: SUBJECT },
    at: NOW_ISO,
    rng,
    accessCode: '482913',
    accessCodeExpiresAt: '2026-08-26T04:00:00.000Z',
  });
}

describe('ResolveAccessCode.preview — the same card the panel would draw', () => {
  it('a valid link renders the card the real code resolves to, taxonomy and all', async () => {
    const viaCode = spyStores();
    const record = tokenRecord();
    const codeResolver = resolverWith({
      sessions: viaCode.sessions,
      tokens: { async getByAccessCode() { return record; } },
    });
    const real = await codeResolver.execute({ code: '482913' });

    const viaLink = spyStores();
    const previewResolver = resolverWith({ sessions: viaLink.sessions, tokens: viaLink.tokens });
    const preview = await previewResolver.preview({
      link: encodeLaunchPreviewLink({ learnerId: LEARNER_ID, subject: SUBJECT }),
    });

    expect(real.ok).toBe(true);
    expect(preview.ok).toBe(true);
    expect(preview.context.taxonomy).toEqual(real.context.taxonomy);
    expect(preview.context.trail).toEqual(real.context.trail);
    expect(preview.context.learner).toEqual(real.context.learner);
    expect(preview.title).toBe(real.title);
    expect(preview.schema).toBe(real.schema);
    expect(preview.presentation.status).toBe(real.presentation.status);
    expect(preview.presentation.message).toBe(real.presentation.message);
    // The offer is the same offer — same buttons, same labels, same order.
    expect(preview.actions.map((a) => `${a.kind}:${a.label}`))
      .toEqual(real.actions.map((a) => `${a.kind}:${a.label}`));
  });

  it('honours continueToday, so the "one more?" card is previewable too', async () => {
    const served = spyStores({ served: true });
    const resolver = resolverWith({ sessions: served.sessions, tokens: served.tokens });

    const refused = await resolver.preview({
      link: encodeLaunchPreviewLink({ learnerId: LEARNER_ID, subject: SUBJECT }),
    });
    const continued = await resolver.preview({
      link: encodeLaunchPreviewLink({ learnerId: LEARNER_ID, subject: SUBJECT, continueToday: true }),
    });

    expect(refused.presentation.status).toBe('complete');
    expect(continued.context.taxonomy.lesson.id).toBe(unitB.unitId);
  });
});

describe('ResolveAccessCode.preview — it mints nothing', () => {
  it('opens no session, appends no event, and never asks the token registry anything', async () => {
    const stores = spyStores();
    const resolver = resolverWith({ sessions: stores.sessions, tokens: stores.tokens });

    const card = await resolver.preview({
      link: encodeLaunchPreviewLink({ learnerId: LEARNER_ID, subject: SUBJECT }),
    });

    expect(card.ok).toBe(true);
    expect(stores.writes).toEqual([]);
    expect(stores.tokens.lookups).toEqual([]);
  });

  it('a preview of already-served work writes nothing either', async () => {
    const stores = spyStores({ served: true });
    const resolver = resolverWith({ sessions: stores.sessions, tokens: stores.tokens });

    await resolver.preview({
      link: encodeLaunchPreviewLink({ learnerId: LEARNER_ID, subject: SUBJECT, continueToday: true }),
    });

    expect(stores.writes).toEqual([]);
    expect(stores.tokens.lookups).toEqual([]);
  });

  it('every action it hands back is marked inert, so nothing downstream can fire one', async () => {
    const stores = spyStores();
    const resolver = resolverWith({ sessions: stores.sessions, tokens: stores.tokens });

    const card = await resolver.preview({
      link: encodeLaunchPreviewLink({ learnerId: LEARNER_ID, subject: SUBJECT }),
    });

    expect(card.actions.length).toBeGreaterThan(0);
    expect(card.actions.every((action) => action.inert === true)).toBe(true);
    expect(card.preview).toBe(true);
    expect(card.presentation.preview).toBe(true);
  });
});

describe('ResolveAccessCode.preview — a bad link says so', () => {
  it('junk in the segment answers a readable sentence, not a crash', async () => {
    const stores = spyStores();
    const resolver = resolverWith({ sessions: stores.sessions, tokens: stores.tokens });

    const card = await resolver.preview({ link: '!!!!not-a-link!!!!' });

    expect(card.ok).toBe(false);
    expect(card.preview).toBe(true);
    expect(card.sentence).toMatch(/preview link/i);
    expect(card.actions).toEqual([]);
    expect(stores.writes).toEqual([]);
  });

  it('a link naming no subject answers a readable sentence', async () => {
    const stores = spyStores();
    const resolver = resolverWith({ sessions: stores.sessions, tokens: stores.tokens });

    const card = await resolver.preview({
      link: Buffer.from(JSON.stringify({ learnerId: LEARNER_ID })).toString('base64url'),
    });

    expect(card.ok).toBe(false);
    expect(card.sentence).toMatch(/learner and a subject/i);
  });

  it('a missing link is the same refusal, not a throw', async () => {
    const stores = spyStores();
    const resolver = resolverWith({ sessions: stores.sessions, tokens: stores.tokens });

    await expect(resolver.preview({})).resolves.toMatchObject({ ok: false, preview: true });
    await expect(resolver.preview()).resolves.toMatchObject({ ok: false, preview: true });
  });
});

describe('ResolveAccessCode.preview — a Plex-hosted course keeps one artwork id', () => {
  /**
   * The piano course reaches the card as `plex:plex:675689` (its launcher
   * prefixes an enrollment id that already said `plex:`). The panel looks for
   * artwork by the single rule `plex:<ratingKey>`, so the preview must
   * normalise exactly as the panel path does — otherwise the preview shows a
   * poster the real card cannot find, or the reverse.
   */
  const pianoEntry = {
    subject: 'arts', unitId: 'piano-course:plex:675689', program: 'piano-course',
  };
  const pianoStatus = {
    programId: 'piano-course',
    status: {
      context: {
        course: { id: 'plex:plex:675689', title: 'Hoffman Academy' },
        unit: { id: 'unit-4', title: 'Unit 4' },
        lesson: { id: 'plex:675712', title: 'Lesson 3' },
      },
      progress: [{ scope: 'course', label: 'Course', completed: 12, total: 40 }],
    },
  };

  const pianoProjection = {
    async project() {
      return {
        plan: { inProgress: [], available: [pianoEntry] },
        sections: [{ subject: 'arts', servedToday: false, next: pianoEntry }],
        activeExceptions: [],
        programStatuses: [pianoStatus],
        projection: {
          assignment: { units: [] }, units: [], sessions: [], works: [], nowIso: NOW_ISO,
        },
      };
    },
  };

  it('normalises a doubly-prefixed plex course id down to plex:<ratingKey>', async () => {
    const stores = spyStores();
    const resolver = resolverWith({
      sessions: stores.sessions, tokens: stores.tokens, planProjection: pianoProjection,
    });

    const card = await resolver.preview({
      link: encodeLaunchPreviewLink({ learnerId: LEARNER_ID, subject: 'arts' }),
    });

    expect(card.ok).toBe(true);
    expect(card.context.taxonomy.course.id).toBe('plex:675689');
    expect(card.context.taxonomy.course.artwork).toEqual({
      kind: 'course-poster', courseId: 'plex:675689',
    });
    expect(stores.writes).toEqual([]);
  });

  it('and answers exactly the taxonomy a real panel code answers for that course', async () => {
    let n = 0;
    const artsToken = mintToken({
      tokenClass: 'subject_next',
      subject: { learnerId: LEARNER_ID, subject: 'arts' },
      at: NOW_ISO,
      rng: () => { n += 1; return (n % 97) / 97; },
      accessCode: '110022',
      accessCodeExpiresAt: '2026-08-26T04:00:00.000Z',
    });
    const viaCode = spyStores();
    const codeResolver = new ResolveAccessCode({
      tokens: { async getByAccessCode() { return artsToken; } },
      curriculum: curriculum(),
      assignments: assignments(),
      sessions: viaCode.sessions,
      planProjection: pianoProjection,
      clock: () => new Date(NOW_ISO),
      logger: noopLogger,
    });
    const real = await codeResolver.execute({ code: '110022' });

    const viaLink = spyStores();
    const previewResolver = resolverWith({
      sessions: viaLink.sessions, tokens: viaLink.tokens, planProjection: pianoProjection,
    });
    const preview = await previewResolver.preview({
      link: encodeLaunchPreviewLink({ learnerId: LEARNER_ID, subject: 'arts' }),
    });

    expect(real.context.taxonomy.course.id).toBe('plex:675689');
    expect(preview.context.taxonomy).toEqual(real.context.taxonomy);
    expect(preview.context.progress).toEqual(real.context.progress);
    expect(viaLink.writes).toEqual([]);
  });
});
