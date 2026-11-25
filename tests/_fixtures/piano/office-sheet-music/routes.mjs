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

/**
 * A poster as the library serves one: a picture of its own proportions. Most are
 * 2:3; some are taller, some square, and a few pieces have none at all, so a
 * render shows the picker holding ragged art in one even row.
 */
const poster = (label, [w, h], [top, bottom]) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  + `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>`
  + `<rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w / 2}" cy="${h * 0.62}" r="${w * 0.28}" fill="#f4e3b1" opacity="0.9"/>`
  + `<text x="${w / 2}" y="${h * 0.16}" font-family="Georgia, serif" font-size="${w * 0.09}" fill="#fff8e6" text-anchor="middle">${label}</text></svg>`,
)}`;
const TALL = [600, 1000];
const PORTRAIT = [600, 900];
const SQUARE = [800, 800];
const WIDE = [900, 640];
const THREE_FOUR = [600, 800];

/** The titles the scores print (`<work-title>`), as the files carry them: some lowercase, some long. */
export const PRINTED_TITLES = {
  'four-bars': 'Santa Claus is coming to town',
  'piece-2': 'Hot Cross Buns',
  'piece-3': 'The Adventures of Tintin',
  'piece-4': 'Für Elise',
  'piece-5': 'Gymnopédie No. 1',
  'piece-6': 'Minuet in G major, BWV Anh. 114',
  'piece-7': 'Ode to Joy',
  'piece-8': 'twinkle twinkle little star',
  'piece-9': 'The Entertainer',
  'piece-10': 'Canon in D',
};
const COVERS = {
  'four-bars': poster('Santa Claus', PORTRAIT, ['#8a1c1c', '#20324a']),
  'piece-2': poster('Hot Cross Buns', TALL, ['#c9a46b', '#5b3b1d']),
  'piece-3': poster('TINTIN', PORTRAIT, ['#0d1b2a', '#13283f']),
  // piece-4 has no poster: the stand-in is drawn.
  'piece-5': poster('Satie', SQUARE, ['#5d7a8c', '#22323d']),
  'piece-6': poster('Bach', WIDE, ['#4a3d6b', '#1e1830']),
  'piece-7': poster('Beethoven', THREE_FOUR, ['#2f5e3a', '#14281a']),
  'piece-8': poster('Twinkle', TALL, ['#1b2b5e', '#0a1028']),
  'piece-9': poster('Joplin', PORTRAIT, ['#7a4b1c', '#2a190a']),
  'piece-10': poster('Pachelbel', SQUARE, ['#6b2d4a', '#28101b']),
};
/** The title a score id prints (`files:…/piece-3.musicxml` → its work title), or null for an engraved catalog score. */
const CATALOG_TITLES = ['Lightly Row', 'Lullaby', 'Mary Had a Little Lamb', 'Jingle Bells', 'Prelude in C', 'Amazing Grace',
  'au clair de la lune', 'Scarborough Fair', 'The Swan', 'Largo from the New World Symphony', 'Morning Mood', 'Aura Lee', 'Minuet in G'];
export const printedTitle = (scoreId) => {
  const base = String(scoreId).split('/').pop().replace(/\.musicxml$/, '');
  const catalog = /^score-(\d+)$/.exec(base);
  return PRINTED_TITLES[base] ?? (catalog ? CATALOG_TITLES[(Number(catalog[1]) - 1) % CATALOG_TITLES.length] : null);
};

/** The catalog's shelves (`sheetmusic.collections`), each listed by GET /list/files/<folder>. */
const notation = (folder, n, covers = []) => Array.from({ length: n }, (_, index) => ({
  id: `files:docs/sheet-music/${folder}/score-${index + 1}.musicxml`, title: `score-${index + 1}`, type: 'notation', thumbnail: covers[index % Math.max(1, covers.length)] ?? null,
}));
export const SHELVES = [
  { label: 'Beginner', ref: 'files:docs/sheet-music/beginner',
    // The second desk piece is on this shelf too: it shows its progress there. A page-image score is left off.
    items: [{ id: 'files:docs/sheet-music/piece-2.musicxml', title: 'piece-2', type: 'notation', thumbnail: COVERS['piece-2'] },
      ...notation('beginner', 13, [poster('Lightly Row', PORTRAIT, ['#3e6b8a', '#152a38']), null, poster('Lullaby', SQUARE, ['#806040', '#2a1e12'])]),
      { id: 'plex:123', title: 'scan', type: 'image' }] },
  { label: 'Christmas', ref: 'files:docs/sheet-music/christmas', items: notation('christmas', 3, [COVERS['four-bars']]) },
  { label: 'Classical', ref: 'files:docs/sheet-music/classical', items: notation('classical', 24, [COVERS['piece-6'], COVERS['piece-5']]) },
  { label: 'Hymns and sacred songs', ref: 'files:docs/sheet-music/hymns', items: notation('hymns', 1) },
  { label: 'Film & TV', ref: 'files:docs/sheet-music/film', items: notation('film', 7, [COVERS['piece-3']]) },
  { label: 'Folk songs', ref: 'files:docs/sheet-music/folk', items: notation('folk', 11, [poster('Folk', THREE_FOUR, ['#4d6b3a', '#1c2a14'])]) },
  { label: 'Scales and exercises', ref: 'files:docs/sheet-music/scales', items: notation('scales', 9) },
];

const passage = (id, start, end, state = 'todo', done = 0) => ({ id, start, end, state, steps: { done, total: 4 } });
/** A piece's passages: the next one learning, the rest as `state` says (the first `done` Bronze). */
const passages = (count, { first = 'learning', rest = 'todo', bronze = 0 } = {}) => Array.from({ length: count }, (_, index) => passage(
  `m${index * 2}-${index * 2 + 1}`, index * 2, index * 2 + 1,
  index === 0 ? first : index < bronze ? 'silver' : rest, index === 0 ? 1 : 0,
));
/** How many passages each desk piece has: most a handful, one long one with twelve. */
const PASSAGE_COUNTS = [6, 2, 12, 4, 8, 14, 3, 5, 9, 2];

/** `count` pieces with real progress, newest first, as GET /activity/desk/:userId returns them. */
export function deskPieces(count = 10) {
  return Array.from({ length: count }, (_, index) => {
    const key = index === 0 ? 'four-bars' : `piece-${index + 1}`;
    const total = PASSAGE_COUNTS[index % PASSAGE_COUNTS.length];
    const kind = index % 3; // 0: early Bronze, 1: every passage Bronze, Gold next, 2: part way
    const bronze = kind === 1 ? total : kind === 2 ? Math.ceil(total / 2) : 0;
    const list = passages(total, { first: kind === 1 ? 'gold' : 'learning', rest: kind === 1 ? 'silver' : 'todo', bronze });
    return {
      scoreId: `files:docs/sheet-music/${key}.musicxml`,
      scoreKey: `piece-${index + 1}`, practicedAt: `2026-11-${String(22 - index).padStart(2, '0')}T10:00:00Z`, cover: COVERS[key] ?? null,
      total, silver: bronze, gold: kind === 1 ? 1 : 0,
      pieceSilver: kind === 1, polishReady: false, joins: 1,
      next: { passageId: list[kind === 2 ? Math.min(bronze, total - 1) : 0].id, skill: 'right', label: 'Find the right-hand notes', start: 0, end: 1 },
      nextGoldPassageId: null,
      passages: list,
      polish: { gem: false, diamond: false },
    };
  });
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
    if (p === 'admin/apps/piano/config') return json(route, { householdTimezone: 'UTC', parsed: { gameAccess: { disabledFor: gamesOffFor }, sheetmusic: { collections: SHELVES.map(({ label, ref }) => ({ label, ref })) } } });
    if (p === 'piano/users') return json(route, { users: USERS });
    let m = /^piano\/activity\/desk\/([^/]+)$/.exec(p);
    if (m) return json(route, { userId: m[1], name: m[1], pieces });
    if (/^piano\/users\/[^/]+\/board-game-day$/.test(p)) return json(route, { completedGames: 0 });
    m = /^list\/files\/(.+)$/.exec(p);
    if (m) {
      const shelf = SHELVES.find((entry) => entry.ref === `files:${m[1]}`);
      return shelf ? json(route, { items: shelf.items }) : json(route, {}, 404);
    }
    if (p.startsWith('proxy/media/stream/')) {
      // Every score is the four-bar fixture, printed under its own title.
      const title = printedTitle(decodeURIComponent(p));
      return route.fulfill({ status: 200, contentType: 'application/xml', body: title ? SCORE_XML.replace('<work-title>Four Bars</work-title>', `<work-title>${title}</work-title>`) : SCORE_XML });
    }
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
