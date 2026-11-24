// The office screen's backend, answered in the browser by Playwright routes.
// Learn's coach writes are applied with the same shared rule the server uses
// (applyCoachEvent), so a take moves the projection exactly as it would live.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCoachEvent, createCoachPlan } from '../../../../shared/music/learnCoach.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
export const SCORE_XML = readFileSync(path.join(repo, '__app_modules/learning/piano/browser/PianoKiosk/modes/Exercises/__fixtures__/fourBars.musicxml'), 'utf8');

export const USERS = [
  { id: 'learner4', name: 'Learner Four', schoolLearner: false },
  { id: 'learner5', name: 'Learner Five', schoolLearner: false },
];
/** The office keyboard: a 76-key E1..G7, so the leave gesture is E1 + G7. */
export const OFFICE_KEYBOARD = { startNote: 28, endNote: 103 };

const passage = (id, start, end, state = 'todo', done = 0) => ({ id, start, end, state, steps: { done, total: 4 } });
/** `count` pieces with real progress, newest first, as GET /activity/desk/:userId returns them. */
export function deskPieces(count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    scoreId: index === 0 ? 'files:docs/sheet-music/four-bars.musicxml' : `files:docs/sheet-music/piece-${index + 1}.musicxml`,
    scoreKey: `piece-${index + 1}`, practicedAt: `2026-11-${String(22 - index).padStart(2, '0')}T10:00:00Z`, cover: null,
    total: 2, silver: index % 3 === 1 ? 2 : index % 3 === 2 ? 1 : 0, gold: index % 3 === 1 ? 1 : 0,
    pieceSilver: index % 3 === 1, polishReady: false, joins: 1,
    next: { passageId: 'm0-1', skill: 'right', label: 'Find the right-hand notes', start: 0, end: 1 },
    nextGoldPassageId: null,
    passages: [passage('m0-1', 0, 1, index % 3 === 1 ? 'gold' : 'learning', 1), passage('m2-3', 2, 3, index % 3 ? 'silver' : 'todo')],
    polish: { gem: false, diamond: false },
  }));
}

/**
 * Install the routes. Returns the live record of what the page wrote, so a test
 * can assert that practice was filed under the right player.
 */
export async function installOfficeRoutes(page, { pieces = deskPieces(), gamesOffFor = [], studyDate = null } = {}) {
  const writes = [];
  const coach = new Map(); // `${user}/${scoreKey}` -> { revision, state }
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v1\//, '');
    const method = request.method();
    if (p === 'device/config') return json(route, { devices: { 'office-tv': { modules: { 'piano-visualizer': { keyboard: OFFICE_KEYBOARD } } } } });
    if (p === 'admin/apps/piano/config') return json(route, { householdTimezone: 'UTC', parsed: { gameAccess: { disabledFor: gamesOffFor }, sheetmusic: {} } });
    if (p === 'piano/users') return json(route, { users: USERS });
    let m = /^piano\/activity\/desk\/([^/]+)$/.exec(p);
    if (m) return json(route, { userId: m[1], name: m[1], pieces });
    if (/^piano\/users\/[^/]+\/board-game-day$/.test(p)) return json(route, { completedGames: 0 });
    if (p.startsWith('proxy/media/stream/')) return route.fulfill({ status: 200, contentType: 'application/xml', body: SCORE_XML });
    if (p === 'piano/sheet-music/learn') return json(route, {});
    if (p.startsWith('info/')) return json(route, {}); // the score's poster sidecar: none
    m = /^piano\/users\/([^/]+)\/practice\/([^/]+)\/coach$/.exec(p);
    if (m) {
      const key = `${m[1]}/${m[2]}`;
      const entry = coach.get(key) ?? { revision: 0, state: null };
      if (method === 'POST') {
        const body = request.postDataJSON();
        writes.push({ kind: 'coach', user: m[1], event: body.event });
        const plan = createCoachPlan(body.plan);
        entry.state = applyCoachEvent(entry.state, body.event, { plan, now: new Date(), dayKey: new Date().toISOString().slice(0, 10) });
        entry.revision += 1;
        coach.set(key, entry);
      }
      return json(route, { revision: entry.revision, state: entry.state, legacy: {} });
    }
    m = /^piano\/users\/([^/]+)\/(practice\/[^/]+|preferences|attempts)$/.exec(p);
    if (m) {
      if (method !== 'GET') writes.push({ kind: m[2].split('/')[0], user: m[1] });
      return json(route, method === 'POST' ? { ok: true } : {});
    }
    // Anything else (avatars, telemetry) is not part of this screen's contract.
    return json(route, {}, 404);
  });
  // The launcher's remembered player: picked today (`studyDate: 'today'`, the
  // study day being 4 h behind the clock, as clientStudyDate counts it), on an
  // earlier day (a date string), or nobody (null).
  if (studyDate) {
    await page.addInitScript(([id, date]) => {
      const pad = (value) => String(value).padStart(2, '0');
      const shifted = new Date(Date.now() - 4 * 3_600_000);
      const today = `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
      if (!window.sessionStorage.getItem('office-fixture-seeded')) {
        window.sessionStorage.setItem('office-fixture-seeded', '1');
        window.localStorage.setItem('daylight.piano.launcher.user', JSON.stringify({ id, studyDate: date === 'today' ? today : date }));
      }
    }, ['learner4', studyDate]);
  }
  return { writes };
}
