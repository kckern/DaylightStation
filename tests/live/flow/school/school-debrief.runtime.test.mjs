/**
 * The child-facing after-school debrief, end to end in a real browser at the
 * Portal's 1280x800: start card -> class chips -> three text prompts -> one
 * probe -> follow-up questions (2 choice, 1 short) -> summary with the reasons.
 *
 * Frontend only. It never writes real data: EVERY `/api/v1/**` call is
 * answered in the browser with `page.route()`, so nothing here reaches a
 * backend or a ledger, whatever host it runs on. The
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

// The server's prompts, verbatim from `promptsFor` (schoolDebrief.mjs) with the default teach_to.
const PROMPTS = [
  { id: 'classes', text: 'Which classes did you have today?', required: false, kind: 'chips' },
  { id: 'moment', text: 'Tell me about one moment from today. Where were you, who was there, what happened?', required: true, kind: 'text' },
  { id: 'teach', text: "What can you do or know now that you couldn't this morning? Explain it so a younger kid could try it.", required: true, kind: 'text' },
  { id: 'hard', text: 'What was hard, and what did you do about it?', required: false, kind: 'text' },
];
const CLASS_OPTIONS = ['Reading', 'Writing', 'Math', 'Typing', 'Spelling', 'Grammar', 'Science', 'P.E.', 'Art', 'Music', 'Quest', 'Field trip'];
const PROBE = 'You said you watered the cups. How much water did each cup get?';
const LEVEL_REASON = 'You explained how to sprout beans step by step.';

const QUESTIONS = [
  { id: 'q1', kind: 'choice', prompt: 'If a bean cup sat in a dark closet for a week, what would most likely happen?', options: ['It would grow pale and weak', 'It would grow faster', 'It would turn into a flower', 'Nothing at all'], answer: 'It would grow pale and weak' },
  { id: 'q2', kind: 'choice', prompt: 'What do plants need to make their own food?', options: ['Light', 'Candy', 'Noise'], answer: 'Light' },
  { id: 'q3', kind: 'short', prompt: 'How would you tell a younger kid to start a bean cup?', expected: 'Put a bean in a wet paper towel in a cup.' },
];

/** The server's View shape for one day, built from the in-test event state. */
function makeDebrief() {
  const s = { opened: false, entries: {}, probes: [], questions: null, answers: {}, completed: false, rejected: false, calls: [] };
  const strip = (q) => (s.answers[q.id] ? q
    : q.kind === 'choice' ? { id: q.id, kind: q.kind, prompt: q.prompt, options: q.options } : { id: q.id, kind: q.kind, prompt: q.prompt });
  const view = () => {
    let phase = 'not-started'; let next = null;
    if (s.rejected) phase = 'rejected';
    else if (s.completed) phase = 'completed';
    else if (s.questions) {
      const open = s.questions.find((q) => !(q.id in s.answers));
      phase = Object.keys(s.answers).length ? 'answering' : 'questions';
      next = open ? { kind: 'question', id: open.id } : { kind: 'complete', id: null };
    } else if (s.probes.some((p) => p.text === null)) {
      phase = 'clarify'; next = { kind: 'clarify', id: null };
    } else if (s.opened) {
      phase = 'entry';
      const missing = PROMPTS.map((p) => p.id).find((id) => !(id in s.entries));
      next = missing ? { kind: 'prompt', id: missing } : { kind: 'submit', id: null };
    }
    const openProbe = s.probes.find((p) => p.text === null);
    const graded = (s.questions ?? []).filter((q) => s.answers[q.id]);
    const level = s.questions ? 4 : null;
    return {
      studyDay: TODAY, late: false, phase, entries: s.entries, prompts: PROMPTS, classOptions: CLASS_OPTIONS,
      probes: s.probes, level, levelReason: s.questions ? LEVEL_REASON : null,
      clarify: openProbe ? { prompt: openProbe.prompt } : null,
      questions: s.questions ? s.questions.map(strip) : null, answers: s.answers, next,
      summary: s.questions ? { level, levelReason: LEVEL_REASON, rich: true, teachable: true, substantive: true,
        quiz: { right: graded.filter((q) => s.answers[q.id].correct).length, graded: graded.length } } : null,
      questioner: s.questions ? 'model' : null, substance: null,
    };
  };
  const handle = (method, sub, body) => {
    s.calls.push(`${method} ${sub}`);
    if (method === 'GET' && sub === '') return view();
    if (sub === '/open') { s.opened = true; return view(); }
    if (sub === '/take') return { audioRef: 'take-1', text: '' };
    if (sub === '/entry') { s.entries[body.promptId] = { text: body.text, via: body.via, audioRef: body.audioRef ?? null }; return view(); }
    // First submit asks one probe (level below teachable); the probe reply freezes the questions.
    if (sub === '/submit') { if (!s.probes.length) s.probes.push({ prompt: PROBE, text: null }); else s.questions = QUESTIONS; return view(); }
    if (sub === '/clarify') { s.probes.find((p) => p.text === null).text = body.text; s.questions = QUESTIONS; return view(); }
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

test('debrief: start -> class chips -> three prompts -> a probe -> two choices + a short answer -> summary at 1280x800', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await installWorld(page);
  await page.goto(`${BASE}/school/go/${LEARNER}/school-debrief`);

  // Start card: Enter begins today's debrief.
  const start = page.getByRole('region', { name: 'After-school debrief' });
  await expect(start).toBeVisible({ timeout: 30_000 });
  await expect(start.getByText('Tell me about school today')).toBeVisible();
  await shot(page, 'r11-01-start');
  await page.keyboard.press('Enter');

  // Class chips: digits toggle the first ten chips (3 = Math, 7 = Science); Enter submits.
  const chips = page.getByRole('region', { name: 'Classes' });
  await expect(chips).toBeVisible();
  await expect(chips.getByText(PROMPTS[0].text)).toBeVisible();
  await page.keyboard.press('3');
  await page.keyboard.press('7');
  await expect(chips.getByRole('button', { name: /Math/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(chips.getByRole('button', { name: /Science/ })).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'r11-02-chips');
  await page.keyboard.press('Enter');
  await expect(chips).toHaveCount(0, { timeout: 10_000 });
  expect(world.debrief.state.entries.classes).toMatchObject({ text: 'Math, Science', via: 'chips' });

  // Prompt `moment`. Space on the empty, focused field must not type a space.
  await expect(page.getByText(PROMPTS[1].text)).toBeVisible();
  const field = page.getByRole('textbox');
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
  await page.keyboard.press('Space');
  await expect(field).toHaveValue('');
  await shot(page, 'r11-03-prompt-space-on-empty');
  // The shared Playwright config hands the page a fake microphone, so Space
  // started a take: the control flips to Stop. Space again ends it.
  const stop = page.getByRole('button', { name: 'Stop recording' });
  await expect(stop).toBeVisible();
  await page.keyboard.press('Space');
  await expect(stop).toHaveCount(0, { timeout: 10_000 });
  await expect(field).toHaveValue('');

  const answers = [
    'At the kitchen table with my sister, we put beans in wet paper towels inside cups.',
    'You fold a wet paper towel, put a bean against the side of the cup, and keep it damp.',
    'Remembering to water them. I put a note on the fridge.',
  ];
  for (const [i, text] of answers.entries()) {
    await expect(page.getByText(PROMPTS[1 + i].text)).toBeVisible();
    await expect(field).toHaveValue('', { timeout: 10_000 });
    await field.fill(text);
    await shot(page, `r11-0${4 + i}-prompt-${PROMPTS[1 + i].id}-typed`);
    await page.keyboard.press('Enter');                       // Enter submits
  }

  // The probe: its own empty field, no Back; Enter sends the reply.
  await expect(page.getByText(PROBE)).toBeVisible({ timeout: 15_000 });
  expect(world.debrief.state.entries.teach.text).toBe(answers[1]);
  expect(world.debrief.state.entries.hard.text).toBe(answers[2]);
  const probeField = page.getByRole('textbox');
  await expect(probeField).toHaveValue('');
  await expect(page.getByRole('button', { name: /Back/ })).toHaveCount(0);
  await probeField.fill('About two spoons, every morning.');
  await shot(page, 'r11-07-probe');
  await page.keyboard.press('Enter');

  // Question 1 (choice): digits answer.
  const choices = page.getByRole('group', { name: 'Choices' });
  await expect(choices).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(QUESTIONS[0].prompt)).toBeVisible();
  expect(world.debrief.state.probes[0].text).toBe('About two spoons, every morning.');
  await shot(page, 'r11-08-question-1-choice');
  await page.keyboard.press('1');
  await expect(page.getByRole('status').filter({ hasText: 'Yes!' })).toBeVisible();
  await shot(page, 'r11-09-question-1-graded');
  await page.keyboard.press('Space');

  // Question 2 (choice), answered wrong on purpose so the reveal is seen.
  await expect(page.getByText(QUESTIONS[1].prompt)).toBeVisible();
  await page.keyboard.press('2');
  await expect(page.getByText('The answer was: Light')).toBeVisible();
  await shot(page, 'r11-10-question-2-wrong-reveal');
  await page.keyboard.press('Space');

  // Question 3 (short answer): Enter submits the typed sentence.
  await expect(page.getByText(QUESTIONS[2].prompt)).toBeVisible();
  const shortField = page.getByRole('textbox');
  await expect(shortField).toBeFocused();
  await shortField.fill('Put a bean in a wet paper towel against the cup.');
  await shot(page, 'r11-11-question-3-short');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nice — you got it.')).toBeVisible();
  await shot(page, 'r11-12-question-3-graded');
  await page.keyboard.press('Space');

  // Summary: thanks, the level reason, the visible bonus reasons, on time, no
  // level number, no quiz tally, and no silver figure (bank is dry-run).
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(summary.getByText(/Thanks for telling me about school/)).toBeVisible();
  await expect(summary.getByText(LEVEL_REASON)).toBeVisible();
  await expect(summary.getByText('You told me a real moment')).toBeVisible();
  await expect(summary.getByText('You explained it so someone could try it')).toBeVisible();
  await expect(summary.getByText('On time')).toBeVisible();
  await expect(summary).not.toContainText(/questions right|level|\/5/i);
  await expect(summary.getByText('Coins start soon')).toBeVisible();
  await expect(summary).not.toContainText(/silver/i);
  await shot(page, 'r11-13-summary');
  expect(world.economyReads.length).toBeGreaterThan(0);
  expect(world.debrief.state.completed).toBe(true);
});

test('debrief: a rejected day shows "talk to a grown-up" and Enter leaves', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await installWorld(page);
  Object.assign(world.debrief.state, { opened: true, entries: { teach: { text: 'stuff', via: 'typed' } }, questions: QUESTIONS, completed: true, rejected: true });
  await page.goto(`${BASE}/school/go/${LEARNER}/school-debrief`);
  const notice = page.getByRole('region', { name: 'Talk to a grown-up' });
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByText('A grown-up wants to talk with you about this one.')).toBeVisible();
  await expect(page.getByText(/Pick up where you left off|Question \d of/)).toHaveCount(0);
  await shot(page, 'r11-14-rejected-notice');
  await page.keyboard.press('Enter');
  await expect(notice).toHaveCount(0, { timeout: 10_000 });
  expect(world.debrief.state.calls.filter((c) => c !== 'GET ')).toEqual([]);
});

test('debrief: today already done shows the summary with "Coins start soon" (bank dry-run)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await installWorld(page);
  Object.assign(world.debrief.state, { opened: true, entries: { teach: { text: 'Plants need light', via: 'typed' } }, questions: QUESTIONS,
    answers: { q1: { response: QUESTIONS[0].answer, correct: true } }, completed: true });
  await page.goto(`${BASE}/school/go/${LEARNER}/school-debrief`);
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary.getByText('Coins start soon')).toBeVisible();
  await expect(summary).not.toContainText(/silver/i);
  await expect(summary.getByText(LEVEL_REASON)).toBeVisible();
  await shot(page, 'r11-15-done-today-summary');
  expect(world.economyReads.length).toBeGreaterThan(0);
});
