/**
 * The child-facing after-school debrief, end to end in a real browser at the
 * Portal's 1280x800: start card -> three prompts -> follow-up questions
 * (2 choice, 1 short) -> summary.
 *
 * Frontend only. The host that runs this is production and the dev backend
 * cannot write school records, so EVERY `/api/v1/**` call is answered in the
 * browser with `page.route()`; nothing here reaches a backend or a ledger. The
 * debrief server is replaced by a tiny in-test state machine that returns the
 * same View shapes `SchoolDebriefService` does (answer keys stripped).
 *
 * Run (against any frontend-only Vite server):
 *   SCHOOL_DEBRIEF_BASE=http://localhost:3199 npx playwright test \
 *     tests/live/flow/school/school-debrief.runtime.test.mjs --reporter=line \
 *     --config tests/_infrastructure/config/playwright.config.mjs
 * With BASE_URL set the shared config starts no webServer.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { getAppPort } from '../../../_lib/configHelper.mjs';

const BASE = process.env.SCHOOL_DEBRIEF_BASE || `http://localhost:${getAppPort()}`;
const OUT_DIR = path.join(process.cwd(), 'test-results/school-debrief');
fs.mkdirSync(OUT_DIR, { recursive: true });

const LEARNER = 'test-learner';
const TODAY = '2026-10-21';
const NOW = new Date(2026, 9, 21, 16, 0);
const ROSTER = [{ id: LEARNER, name: 'Test Learner', birthyear: 2016 }];

const QUESTIONS = [
  { id: 'q1', kind: 'choice', prompt: 'Which subjects did you say you had today?', options: ['Math, science and art', 'Gym and music', 'Only lunch', 'Reading and history'], answer: 'Math, science and art' },
  { id: 'q2', kind: 'choice', prompt: 'What did you say plants need to make food?', options: ['Light', 'Candy', 'Noise'], answer: 'Light' },
  { id: 'q3', kind: 'short', prompt: 'In one sentence, how did you grow the beans, as if teaching a younger kid?', expected: 'We grew beans in cups.' },
];

/** The server's View shape for one day, built from the in-test event state. */
function makeDebrief() {
  const s = { opened: false, entries: {}, questions: null, answers: {}, completed: false, calls: [] };
  const strip = (q) => (s.answers[q.id] ? q
    : q.kind === 'choice' ? { id: q.id, kind: q.kind, prompt: q.prompt, options: q.options } : { id: q.id, kind: q.kind, prompt: q.prompt });
  const view = () => {
    let phase = 'not-started'; let next = null;
    if (s.completed) phase = 'completed';
    else if (s.questions) {
      const open = s.questions.find((q) => !(q.id in s.answers));
      phase = Object.keys(s.answers).length ? 'answering' : 'questions';
      next = open ? { kind: 'question', id: open.id } : { kind: 'complete', id: null };
    } else if (s.opened) {
      phase = 'entry';
      const missing = ['classes', 'learned', 'notable'].find((p) => !(p in s.entries));
      next = missing ? { kind: 'prompt', id: missing } : { kind: 'submit', id: null };
    }
    const graded = (s.questions ?? []).filter((q) => s.answers[q.id]);
    return {
      studyDay: TODAY, late: false, phase, entries: s.entries, clarify: null,
      questions: s.questions ? s.questions.map(strip) : null, answers: s.answers, next,
      summary: s.questions ? { substance: 7, substantive: true, quiz: { right: graded.filter((q) => s.answers[q.id].correct).length, graded: graded.length } } : null,
      questioner: s.questions ? 'model' : null, substance: s.questions ? 7 : null,
    };
  };
  const handle = (method, sub, body) => {
    s.calls.push(`${method} ${sub}`);
    if (method === 'GET' && sub === '') return view();
    if (sub === '/open') { s.opened = true; return view(); }
    if (sub === '/take') return { audioRef: 'take-1', text: '' };
    if (sub === '/entry') { s.entries[body.promptId] = { text: body.text, via: body.via, audioRef: body.audioRef ?? null }; return view(); }
    if (sub === '/submit') { s.questions = QUESTIONS; return view(); }
    if (sub === '/answer') {
      const q = QUESTIONS.find((x) => x.id === body.questionId);
      if (q.kind === 'choice') {
        const correct = body.response === q.answer;
        s.answers[q.id] = { response: body.response, correct };
        return { correct, grade: null, reason: null, answer: q.answer };
      }
      s.answers[q.id] = { response: body.response, correct: true };
      return { correct: true, grade: 'good', reason: 'That says it clearly.', expected: q.expected };
    }
    if (sub === '/complete') { s.completed = true; return view(); }
    return null;
  };
  return { state: s, handle };
}

async function installWorld(page) {
  const debrief = makeDebrief();
  const economyReads = [];
  await page.clock.setFixedTime(NOW);
  // Registered once; every call is answered here. The final `{}` is the same
  // catch-all the other frontend-only flows use for calls this page makes but
  // this test does not care about.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });

    if (pathname === '/api/v1/school/roster') return json(ROSTER);
    if (pathname === '/api/v1/school/materials') return json({ materials: [] });
    if (pathname === '/api/v1/school/sentence-ladder/courses' || pathname === '/api/v1/school/banks') return json([]);
    if (pathname === '/api/v1/school/surfaces/profile') return json({ surfaceId: 'portal' });
    if (pathname === '/api/v1/state-gates') return json({ gates: [] });
    if (pathname.endsWith('/direct-launch') && method === 'POST') {
      return json({ ok: true, target: { kind: 'program', program: 'school-debrief', programId: 'school-debrief', learnerId: LEARNER, debriefGrant: 'test-grant', today: TODAY, lateDay: null } });
    }
    const day = new RegExp(`^/api/v1/school/debrief/${LEARNER}/day/${TODAY}(/[a-z]+)?$`).exec(pathname);
    if (day) {
      const body = method === 'GET' ? undefined : (request.postDataJSON?.() ?? undefined);
      const out = debrief.handle(method, day[1] ?? '', body);
      return out ? json(out) : json({ error: 'unknown' }, 404);
    }
    if (/^\/api\/v1\/economy\/users\/[^/]+\/bank$/.test(pathname)) {
      economyReads.push(pathname);
      return json({ mode: 'dry-run', balances: { silver: 0, gold: 0, gems: 0 } });
    }
    if (pathname.startsWith('/api/v1/earnings/')) return json({ totals: { silver: 0 }, lines: [] });
    return json({});
  });
  return { debrief, economyReads };
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });

test('debrief: start -> three prompts -> two choices + a short answer -> summary at 1280x800', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await installWorld(page);
  await page.goto(`${BASE}/school/go/${LEARNER}/school-debrief`);

  // Start card: Enter begins today's debrief.
  const start = page.getByRole('region', { name: 'After-school debrief' });
  await expect(start).toBeVisible({ timeout: 30_000 });
  await expect(start.getByText('Tell me about school today')).toBeVisible();
  await shot(page, 'r11-01-start');
  await page.keyboard.press('Enter');

  // Prompt 1. Space on the empty, focused field must not type a space.
  const field = page.getByRole('textbox');
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
  await page.keyboard.press('Space');
  await expect(field).toHaveValue('');
  await shot(page, 'r11-02-prompt-space-on-empty');
  // The shared Playwright config hands the page a fake microphone, so Space
  // started a take: the control flips to Stop. Space again ends it.
  const stop = page.getByRole('button', { name: 'Stop recording' });
  await expect(stop).toBeVisible();
  await page.keyboard.press('Space');
  await expect(stop).toHaveCount(0, { timeout: 10_000 });
  await expect(field).toHaveValue('');

  const answers = ['math, science, art', 'Plants need light to make food', 'We grew beans in cups'];
  for (const [i, text] of answers.entries()) {
    await expect(field).toBeVisible();
    await field.fill(text);
    await shot(page, `r11-0${3 + i}-prompt-${i + 1}-typed`);
    await page.keyboard.press('Enter');                       // Enter submits
    if (i < 2) await expect(field).toHaveValue('', { timeout: 10_000 });
  }
  expect(world.debrief.state.entries.learned.text).toBe('Plants need light to make food');

  // Question 1 (choice): digits answer.
  const choices = page.getByRole('group', { name: 'Choices' });
  await expect(choices).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(QUESTIONS[0].prompt)).toBeVisible();
  await shot(page, 'r11-06-question-1-choice');
  await page.keyboard.press('1');
  await expect(page.getByRole('status').filter({ hasText: 'Yes!' })).toBeVisible();
  await shot(page, 'r11-07-question-1-graded');
  await page.keyboard.press('Space');

  // Question 2 (choice), answered wrong on purpose so the reveal is seen.
  await expect(page.getByText(QUESTIONS[1].prompt)).toBeVisible();
  await page.keyboard.press('2');
  await expect(page.getByText('The answer was: Light')).toBeVisible();
  await shot(page, 'r11-08-question-2-wrong-reveal');
  await page.keyboard.press('Space');

  // Question 3 (short answer): Enter submits the typed sentence.
  await expect(page.getByText(QUESTIONS[2].prompt)).toBeVisible();
  const shortField = page.getByRole('textbox');
  await expect(shortField).toBeFocused();
  await shortField.fill('We put beans in wet cups and watched them sprout.');
  await shot(page, 'r11-09-question-3-short');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nice — you got it.')).toBeVisible();
  await shot(page, 'r11-10-question-3-graded');
  await page.keyboard.press('Space');

  // Summary: thanks, quiz tally, on time, and no silver figure (bank is dry-run).
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(summary.getByText(/Thanks for telling me about school/)).toBeVisible();
  await expect(summary.getByText('2 of 3 questions right')).toBeVisible();
  await expect(summary.getByText('Coins start soon')).toBeVisible();
  await expect(summary).not.toContainText(/silver/i);
  await shot(page, 'r11-11-summary');
  expect(world.economyReads.length).toBeGreaterThan(0);
  expect(world.debrief.state.completed).toBe(true);
});
