import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { mountWordLadderRoutes } from './school.wordLadder.mjs';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const notConfigured = (what) => Object.assign(new Error(`${what} not configured`), { status: 503 });
function app(extra = {}) {
  const live = { open: vi.fn(async () => ({ sittingId: 'p.live.1', item: { id: 'x' } })), respond: vi.fn(async () => ({ item: {} })), get: vi.fn(async () => ({})), close: vi.fn(async () => ({ closed: true })), fold: vi.fn(async () => ({})), saveRecording: vi.fn(async () => ({ take: 1 })), practice: vi.fn(async () => ({ item: { type: 'typed' } })), words: vi.fn(async () => ({ words: [] })), intro: vi.fn(async () => ({ course: { title: 'C' }, poster: { kind: 'curriculum-poster', scope: 'selfservice', courseId: 'program:word-ladder:korean-vocab' } })) };
  const test = { ...live, intro: vi.fn(async () => ({ test: true })), open: vi.fn(async () => ({ sittingId: 'test.p.t.1' })), saveRecording: vi.fn(async () => ({ take: 1 })), practice: vi.fn(async () => ({ item: {} })), words: vi.fn(async () => ({ words: [] })), get: vi.fn(async () => ({ test: true })), close: vi.fn(async () => ({ closed: true })) };
  const a = express(); a.use(express.json()); const router = express.Router();
  mountWordLadderRoutes({ router, wrap, notConfigured, wordLadderStudy: live, wordLadderTest: test, stageScreen: 'portal', ...extra });
  a.use(router); a.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  return { a, live, test };
}

describe('word-ladder routes', () => {
  it('live open ignores a scenario; test open passes it', async () => {
    const { a, live, test } = app();
    await request(a).post('/word-ladder/open').send({ userId: 'u', deckId: 'd', scenario: 'fresh' }).expect(200);
    expect(live.open).toHaveBeenCalledWith({ userId: 'u', deckId: 'd' });
    await request(a).post('/word-ladder/test/open').send({ userId: 'u', deckId: 'd', scenario: 'fresh' }).expect(200);
    expect(test.open).toHaveBeenCalledWith({ userId: 'u', deckId: 'd', scenario: 'fresh' });
  });
  it('intro is a read-only GET on both mounts; the poster ref becomes a self-service URL', async () => {
    const { a, live, test } = app();
    const res = await request(a).get('/word-ladder/intro?userId=u&deckId=d&scenario=fresh').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(live.intro).toHaveBeenCalledWith({ userId: 'u', deckId: 'd' });
    expect(res.body.poster).toBe('/api/v1/school/self-service/programs/word-ladder/korean-vocab/poster.jpg');
    await request(a).get('/word-ladder/test/intro?userId=u&deckId=d&scenario=fresh').expect(200);
    expect(test.intro).toHaveBeenCalledWith({ userId: 'u', deckId: 'd', scenario: 'fresh' });
    // Never a write verb.
    await request(a).post('/word-ladder/intro').send({ userId: 'u', deckId: 'd' }).expect(404);
  });
  it('responses are private no-store and the stage screen is served', async () => {
    const { a } = app();
    const res = await request(a).post('/word-ladder/sittings/p.live.1/items/x').send({ userId: 'u', response: { seen: true } }).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect((await request(a).get('/word-ladder/stage').expect(200)).body).toEqual({ screen: 'portal' });
  });
  it('routes get, respond and close to the right service', async () => {
    const { a, live, test } = app();
    await request(a).get('/word-ladder/sittings/p.live.1?userId=u').expect(200);
    expect(live.get).toHaveBeenCalledWith({ userId: 'u', sittingId: 'p.live.1' });
    await request(a).get('/word-ladder/test/sittings/test.p.t.1?userId=u').expect(200);
    expect(test.get).toHaveBeenCalledWith({ userId: 'u', sittingId: 'test.p.t.1' });
    await request(a).post('/word-ladder/sittings/p.live.1/items/x').send({ userId: 'u', response: { typed: 'a' } }).expect(200);
    expect(live.respond).toHaveBeenCalledWith({ userId: 'u', sittingId: 'p.live.1', itemId: 'x', response: { typed: 'a' } });
    await request(a).post('/word-ladder/test/sittings/test.p.t.1/close').send({ userId: 'u' }).expect(200);
    expect(test.close).toHaveBeenCalledWith({ userId: 'u', sittingId: 'test.p.t.1', reason: 'leave' });
    expect(live.close).not.toHaveBeenCalled();
  });
  it('fold is live only; an unwired test service is not configured', async () => {
    const { a, live } = app({ wordLadderTest: null });
    await request(a).post('/word-ladder/fold').send({ learnerId: 'k', actorId: 'p' }).expect(200);
    expect(live.fold).toHaveBeenCalledWith({ learnerId: 'k', actorId: 'p', pin: null });
    await request(a).post('/word-ladder/test/open').send({ userId: 'u', deckId: 'd' }).expect(503);
  });
  it('open passes capabilities on both mounts', async () => {
    const { a, live, test } = app();
    await request(a).post('/word-ladder/open').send({ userId: 'u', deckId: 'd', capabilities: { microphone: true } }).expect(200);
    expect(live.open).toHaveBeenCalledWith({ userId: 'u', deckId: 'd', capabilities: { microphone: true } });
    await request(a).post('/word-ladder/test/open').send({ userId: 'u', deckId: 'd', scenario: 'tricky', capabilities: { microphone: false } }).expect(200);
    expect(test.open).toHaveBeenCalledWith({ userId: 'u', deckId: 'd', scenario: 'tricky', capabilities: { microphone: false } });
  });
  it('a raw audio take is posted to the mount\'s own service', async () => {
    const { a, live, test } = app();
    const res = await request(a).post('/word-ladder/sittings/p.live.1/recordings/d1:2?userId=u&ext=ogg')
      .set('Content-Type', 'audio/ogg').send(Buffer.from('take')).expect(200);
    expect(res.body).toEqual({ take: 1 });
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(live.saveRecording).toHaveBeenCalledWith({ userId: 'u', sittingId: 'p.live.1', itemId: 'd1:2', buffer: Buffer.from('take'), ext: 'ogg' });
    await request(a).post('/word-ladder/test/sittings/test.p.t.1/recordings/d1:2?userId=u')
      .set('Content-Type', 'audio/webm').send(Buffer.from('x')).expect(200);
    expect(test.saveRecording).toHaveBeenCalledWith({ userId: 'u', sittingId: 'test.p.t.1', itemId: 'd1:2', buffer: Buffer.from('x'), ext: 'webm' });
    expect(live.saveRecording).toHaveBeenCalledTimes(1);
  });
  it('a take in an unaccepted content type reaches the service without a buffer', async () => {
    const { a, live } = app();
    await request(a).post('/word-ladder/sittings/p.live.1/recordings/d1:2?userId=u').set('Content-Type', 'text/plain').send('hello').expect(200);
    expect(live.saveRecording).toHaveBeenCalledWith(expect.objectContaining({ buffer: null }));
  });
  it('practice and My words route to the mount\'s service', async () => {
    const { a, live, test } = app();
    await request(a).post('/word-ladder/sittings/p.live.1/practice').send({ userId: 'u', mode: 'write', help: false, filter: 'tricky', chosen: ['a'], frontSide: 'gloss' }).expect(200);
    expect(live.practice).toHaveBeenCalledWith({ userId: 'u', sittingId: 'p.live.1', mode: 'write', help: false, filter: 'tricky', chosen: ['a'], frontSide: 'gloss' });
    await request(a).post('/word-ladder/test/sittings/test.p.t.1/practice').send({ userId: 'u', mode: 'match' }).expect(200);
    expect(test.practice).toHaveBeenCalledWith({ userId: 'u', sittingId: 'test.p.t.1', mode: 'match', help: true, filter: 'introduced', chosen: [], frontSide: 'term' });
    const res = await request(a).get('/word-ladder/words?userId=u&deckId=d').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(live.words).toHaveBeenCalledWith({ userId: 'u', deckId: 'd', sittingId: null });
    await request(a).get('/word-ladder/test/words?userId=u&deckId=d&sittingId=test.p.t.1').expect(200);
    expect(test.words).toHaveBeenCalledWith({ userId: 'u', deckId: 'd', sittingId: 'test.p.t.1' });
  });
  it('grown-up word controls are live only and pass actorId + pin through', async () => {
    const admin = Object.fromEntries(['adminWords', 'adminReset', 'adminMarkMastered', 'adminExclude', 'adminDropDeck', 'adminRegrade']
      .map((name) => [name, vi.fn(async () => ({ ok: name }))]));
    const { a, live } = app();
    Object.assign(live, admin);
    const who = { learnerId: 'k', deckId: 'd', actorId: 'p', pin: '1234' };
    const res = await request(a).get('/word-ladder/admin/words?learnerId=k&deckId=d&actorId=p&pin=1234').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(admin.adminWords).toHaveBeenCalledWith(who);
    await request(a).post('/word-ladder/admin/reset').send({ ...who, wordId: 'w' }).expect(200);
    expect(admin.adminReset).toHaveBeenCalledWith({ ...who, wordId: 'w' });
    await request(a).post('/word-ladder/admin/mastered').send({ ...who, wordId: 'w', stage: 2 }).expect(200);
    expect(admin.adminMarkMastered).toHaveBeenCalledWith({ ...who, wordId: 'w', stage: 2 });
    await request(a).post('/word-ladder/admin/exclude').send({ ...who, wordId: 'w', excluded: false }).expect(200);
    expect(admin.adminExclude).toHaveBeenCalledWith({ ...who, wordId: 'w', excluded: false });
    await request(a).post('/word-ladder/admin/drop-deck').send({ ...who, dropDeckId: 'x' }).expect(200);
    expect(admin.adminDropDeck).toHaveBeenCalledWith({ ...who, dropDeckId: 'x' });
    await request(a).post('/word-ladder/admin/regrade').send({ ...who, day: '2026-09-20', itemId: 'rc:w', pass: true }).expect(200);
    expect(admin.adminRegrade).toHaveBeenCalledWith({ ...who, day: '2026-09-20', itemId: 'rc:w', pass: true });
    await request(a).post('/word-ladder/test/admin/reset').send({ ...who, wordId: 'w' }).expect(404);
    const { a: unwired } = app({ wordLadderStudy: null });
    await request(unwired).post('/word-ladder/admin/reset').send({ ...who, wordId: 'w' }).expect(503);
  });
  it('the admin words GET takes the console cookie capability when no query pin is given', async () => {
    const adminWords = vi.fn(async () => ({ words: [] }));
    const proof = { capabilityToken: 'cap-1', stepUpToken: null };
    const capabilityProof = vi.fn((req) => (req.get('cookie') ? proof : null));
    const { a, live } = app({ capabilityProof });
    live.adminWords = adminWords;
    await request(a).get('/word-ladder/admin/words?learnerId=k&deckId=d&actorId=p').set('Cookie', 'daylight_teacher_session=cap-1').expect(200);
    expect(adminWords).toHaveBeenLastCalledWith({ learnerId: 'k', deckId: 'd', actorId: 'p', pin: proof });
    await request(a).get('/word-ladder/admin/words?learnerId=k&deckId=d&actorId=p&pin=1234').set('Cookie', 'daylight_teacher_session=cap-1').expect(200);
    expect(adminWords).toHaveBeenLastCalledWith({ learnerId: 'k', deckId: 'd', actorId: 'p', pin: '1234' });
    await request(a).get('/word-ladder/admin/words?learnerId=k&deckId=d&actorId=p').expect(200);
    expect(adminWords).toHaveBeenLastCalledWith({ learnerId: 'k', deckId: 'd', actorId: 'p', pin: null });
  });
  // TeacherGate.assert checks isAdult(userId) BEFORE it ever looks at the
  // capability/pin (TeacherGate.mjs), so an actorId-less GET was refused with
  // a 403 no matter how good the cookie was. The read must derive the acting
  // teacher from the capability session itself — the same precedence
  // school.teacherReading.mjs's `actor(req)` uses: the session's own userId
  // outranks anything a client claims, because the cookie is what the console
  // actually holds.
  it('the admin words GET derives the acting teacher from the capability session when no actorId is given', async () => {
    const adminWords = vi.fn(async () => ({ words: [] }));
    const proof = { capabilityToken: 'cap-1', stepUpToken: null };
    const capabilityProof = vi.fn((req) => (req.get('cookie') ? proof : null));
    const teacherCapabilitySessions = { status: vi.fn((token) => (
      token === 'cap-1' ? { active: true, userId: 'p' } : { active: false }
    )) };
    const { a, live } = app({ capabilityProof, teacherCapabilitySessions });
    live.adminWords = adminWords;
    // Cookie only — no actorId, no pin in the query — must still reach the
    // service, gated as the session's own teacher.
    await request(a).get('/word-ladder/admin/words?learnerId=k&deckId=d')
      .set('Cookie', 'daylight_teacher_session=cap-1').expect(200);
    expect(adminWords).toHaveBeenLastCalledWith({ learnerId: 'k', deckId: 'd', actorId: 'p', pin: proof });
    // The session's identity outranks a query actorId a client supplied —
    // never trust the caller's own claim of who they are over the cookie.
    await request(a).get('/word-ladder/admin/words?learnerId=k&deckId=d&actorId=someone-else')
      .set('Cookie', 'daylight_teacher_session=cap-1').expect(200);
    expect(adminWords).toHaveBeenLastCalledWith({ learnerId: 'k', deckId: 'd', actorId: 'p', pin: proof });
    // No cookie, no session: falls back to the query actorId (the CLI case).
    await request(a).get('/word-ladder/admin/words?learnerId=k&deckId=d&actorId=q').expect(200);
    expect(adminWords).toHaveBeenLastCalledWith({ learnerId: 'k', deckId: 'd', actorId: 'q', pin: null });
  });
  it('tuning GET and undo POST are live only, reach the tuning service, and take the acting teacher from the capability session', async () => {
    const tuning = { adminTuning: vi.fn(async () => ({ history: [] })), adminUndo: vi.fn(async () => ({ undone: true })) };
    const proof = { capabilityToken: 'cap-1', stepUpToken: null };
    const capabilityProof = vi.fn((req) => (req.get('cookie') ? proof : null));
    const teacherCapabilitySessions = { status: vi.fn((token) => (token === 'cap-1' ? { active: true, userId: 'p' } : { active: false })) };
    const { a } = app({ wordLadderTuning: tuning, capabilityProof, teacherCapabilitySessions });
    const res = await request(a).get('/word-ladder/admin/tuning?learnerId=k&deckId=d&actorId=someone-else')
      .set('Cookie', 'daylight_teacher_session=cap-1').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(tuning.adminTuning).toHaveBeenLastCalledWith({ learnerId: 'k', deckId: 'd', actorId: 'p', pin: proof });
    await request(a).post('/word-ladder/admin/tuning/undo').set('Cookie', 'daylight_teacher_session=cap-1')
      .send({ learnerId: 'k', deckId: 'd', setting: 'round.size', actorId: 'someone-else' }).expect(200);
    expect(tuning.adminUndo).toHaveBeenLastCalledWith({ learnerId: 'k', deckId: 'd', setting: 'round.size', actorId: 'p', pin: proof });
    // No cookie: the body's actorId and pin (the CLI case).
    await request(a).post('/word-ladder/admin/tuning/undo').send({ learnerId: 'k', deckId: 'd', setting: 'round.size', actorId: 'q', pin: '1234' }).expect(200);
    expect(tuning.adminUndo).toHaveBeenLastCalledWith({ learnerId: 'k', deckId: 'd', setting: 'round.size', actorId: 'q', pin: '1234' });
    await request(a).post('/word-ladder/test/admin/tuning/undo').send({ learnerId: 'k', setting: 'round.size' }).expect(404);
    const { a: unwired } = app();
    await request(unwired).get('/word-ladder/admin/tuning?learnerId=k&deckId=d').expect(503);
    await request(unwired).post('/word-ladder/admin/tuning/undo').send({ learnerId: 'k', setting: 'round.size' }).expect(503);
  });
});
