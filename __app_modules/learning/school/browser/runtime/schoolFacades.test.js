import { afterEach, describe, expect, it, vi } from 'vitest';
import * as language from '../Programs/SentenceLadder/languageApi.js';
import * as cards from '../Programs/Flashcards/CardLadder/cardLadderApi.js';
import * as gratitude from '../Programs/Gratitude/gratitudeApi.js';
import * as debrief from '../Programs/SchoolDebrief/schoolDebriefApi.js';
import * as reels from '../Programs/LanguageReels/languageReelsApi.js';
import * as admin from '../teacher/cardLadderAdminApi.js';
import * as schoolAdmin from '../admin/schoolAdminApi.js';
import { setSchoolDeviceId } from '../schoolDevice.js';

const fixtures = [
  ['Sentence Ladder', language, 'createLanguageApi', {}, api => api.courses()],
  ['Card Ladder', cards, 'createCardLadderApi', {}, api => api.get('s', 'kid')],
  ['Gratitude', gratitude, 'createGratitudeApi', { learnerId: 'kid', grant: 'grant' }, api => api.day('2026-11-16')],
  ['Debrief', debrief, 'createSchoolDebriefApi', { learnerId: 'kid', grant: 'grant' }, api => api.day('2026-11-16')],
  ['Reels', reels, 'createLanguageReelsApi', {}, api => api.open('kid', 'reel', 'grant')],
  ['teacher words', admin, 'createCardLadderAdminApi', {}, api => api.words('kid', 'deck')],
];
afterEach(() => { vi.unstubAllGlobals(); setSchoolDeviceId(null); });

describe.each(fixtures)('%s facade', (_name, module, factoryName, options, call) => {
  it('binds device scope independently from the browser default and a sibling client', async () => {
    const seen = [];
    vi.stubGlobal('fetch', async (_url, init) => { seen.push(init.headers); return { ok: true, status: 200, json: async () => ({}) }; });
    setSchoolDeviceId('legacy');
    const a = module[factoryName]({ ...options, deviceId: 'a' });
    const b = module[factoryName]({ ...options, deviceId: 'b' });
    await call(a); await call(b); await call(a);
    expect(seen.map(headers => headers['X-Daylight-Device'])).toEqual(['a', 'b', 'a']);
  });

  it('fails closed on malformed JSON instead of allowing a success-shaped null', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('private learner text'); } }));
    const api = module[factoryName]({ ...options, deviceId: 'panel' });
    expect((await call(api)).ok).toBe(false);
  });
});

it('keeps the school admin throwing contract with HTTP status and a scoped device header', async () => {
  const seen = [];
  vi.stubGlobal('fetch', async (_url, init) => { seen.push(init.headers); return { ok: false, status: 409, text: async () => '{"message":"Record changed"}' }; });
  const api = schoolAdmin.createSchoolAdminApi({ deviceId: 'admin' });
  await expect(api.putAssignment('kid', { courses: [], units: [], assignedBy: 'teacher' })).rejects.toMatchObject({ status: 409, message: 'Record changed' });
  expect(seen[0]['X-Daylight-Device']).toBe('admin');
});
