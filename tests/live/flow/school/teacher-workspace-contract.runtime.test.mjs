import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'docs/_wip/audits/teacher-workspace');
fs.mkdirSync(OUT_DIR, { recursive: true });

const learnerB = { id: 'user_2', name: 'User_2' };
const session = {
  schema: 'school.teacher-session/v3',
  sessionId: 'ses_a6NVUhN9',
  revision: 4,
  taxonomy: {
    subject: 'civilization',
    courseTitle: 'United States Regions and States',
    moduleTitle: 'Midwest',
    lessonTitle: 'Illinois',
    posterUrl: '/api/v1/school/teacher/curriculum/civilization%2Fyoung-peoples-atlas-us/poster.jpg',
  },
  state: {
    learnerId: 'user_2',
    state: 'closed',
    machineGrade: { percent: 100 },
    effectiveGrade: { percent: 100 },
  },
  events: [{ type: 'graded', at: '2026-08-24T15:20:13.805Z', gradedBy: 'engine' }],
  assignment: {
    createdAt: '2026-08-24T14:28:43.031Z',
    questions: [{ itemId: 'illinois-capital', number: 1, prompt: 'What is the capital of Illinois?' }],
  },
  assessment: {
    items: [{ itemId: 'illinois-capital', questionNumber: 1, prompt: 'What is the capital of Illinois?', given: 'Springfield', verdict: 'correct' }],
  },
  artifacts: [
    { artifactId: 'worksheet-illinois', kind: 'assignment', availability: 'exact', originalPdfUrl: '/api/v1/school/teacher/artifacts/worksheet-illinois/original.pdf', thumbnailUrl: '/api/v1/school/teacher/artifacts/worksheet-illinois/thumbnail.png' },
    { artifactId: 'receipt-illinois', kind: 'result-receipt', availability: 'exact', originalUrl: '/api/v1/school/teacher/artifacts/receipt-illinois/original' },
  ],
};

const day = [{
  learnerId: 'user_2', effectiveScoreTotals: { correct: 6, total: 6 }, pendingReview: 0,
  sessions: [{
    sessionId: 'ses_a6NVUhN9', lessonTitle: 'Illinois', subject: 'civilization',
    courseTitle: 'United States Regions and States', moduleTitle: 'Midwest',
    posterUrl: '/api/v1/school/teacher/curriculum/civilization%2Fyoung-peoples-atlas-us/poster.jpg',
    // The plan-to-record join is by UNIT id, not subject — the fixture has to
    // carry one or it exercises only the fallback path.
    unitId: 'plex:illinois',
    studyDay: '2026-08-24', effectiveScore: { correctCount: 6, totalCount: 6, percent: 100 }, state: 'closed',
  }],
}];

// The plan side of the join: one section the record answers (done), one it
// doesn't (not started), and one the planner deferred.
const agendaSections = [
  { subject: 'civilization', next: { title: 'Illinois', unitId: 'plex:illinois' } },
  { subject: 'math', next: { title: 'Fractions Ep. 4', unitId: 'plex:fractions-4' } },
  { subject: 'reading', next: { title: 'Chapter 3' }, suppressed: { bySubject: 'civilization' } },
];

const onePagePdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length 45>>stream\nBT /F1 24 Tf 40 120 Td (Illinois worksheet) Tj ET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000260 00000 n \n0000000330 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n424\n%%EOF';

async function installTeacherReadModel(page) {
  // The School shell also asks non-school endpoints for ambient app state.
  // This visual contract deliberately has no backend, so make those startup
  // reads inert instead of letting Vite proxy them to a real/absent service.
  await page.route('**/api/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/v1/school/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/sentence-ladder/courses')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'glossika-korean', label: 'Glossika Korean', languages: { source: 'EN', target: 'KR' }, size: 3000 },
      ]) });
      return;
    }
    if (pathname.endsWith('/sentence-ladder/preview/glossika-korean/day')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        schema: 'school.sentence-ladder-guest-preview/v1',
        corpus: { id: 'glossika-korean', label: 'Glossika Korean', languages: { source: 'EN', target: 'KR' }, size: 3000 },
        day: 1, dailyLimit: 5, chain: ['repetition'], creditChain: ['repetition'], missingCreditRungs: [],
        queue: [{ seq: 1, rung: 'repetition', done: false, text: { EN: 'Hello.', KR: '안녕하세요.' }, prompt: [{ role: 'source', language: 'EN' }, { role: 'target', language: 'KR' }], response: null }],
        summary: { total: 1, done: 0 }, rollover: { roll: false, reason: 'guest-preview' },
      }) });
      return;
    }
    if (pathname.endsWith('/artifacts/worksheet-illinois/thumbnail.png')) {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="210"><rect width="100%" height="100%" fill="#fff"/><text x="22" y="55" font-size="22">Illinois</text><text x="22" y="88" font-size="14">6 questions</text></svg>' });
      return;
    }
    if (pathname.endsWith('/artifacts/worksheet-illinois/original.pdf')) {
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: onePagePdf });
      return;
    }
    if (pathname.endsWith('/artifacts/receipt-illinois/original')) {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="400"><rect width="100%" height="100%" fill="#fff"/><text x="18" y="40" font-size="18">User_2 — Illinois</text><text x="18" y="75" font-size="14">6 of 6 correct</text></svg>' });
      return;
    }
    if (pathname.endsWith('/poster.jpg')) {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="100%" height="100%" fill="#b8873b"/><text x="10" y="58" font-size="12">Atlas</text></svg>' });
      return;
    }
    if (pathname.endsWith('/agenda/preview')) {
      const studyDay = new URL(route.request().url()).searchParams.get('studyDay');
      if (new URL(route.request().url()).searchParams.get('format') === 'json') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          learnerId: 'user_2', studyDay, sections: agendaSections, entries: [], errors: [],
        }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="100%" height="100%" fill="#fff"/><text x="24" y="70" font-size="24">User_2 agenda preview</text></svg>' });
      }
      return;
    }
    const data = pathname.endsWith('/roster') ? [learnerB]
      : pathname.endsWith('/teachers') ? { configured: true, teachers: [{ id: 'teacher', name: 'Teacher' }] }
        : pathname.endsWith('/teacher/auth/status') ? { active: false }
        : pathname.endsWith('/teacher/day') ? { schema: 'school.teacher-day/v2', studyDay: new URL(route.request().url()).searchParams.get('studyDay') ?? '2026-08-24', learners: day }
          : pathname.endsWith('/lifecycle/review') ? { items: [] }
              : pathname.endsWith('/print/pending') || pathname.endsWith('/quiz-requests') ? []
              : pathname.endsWith('/teacher/sessions/ses_a6NVUhN9') ? session
                : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
}

test.describe('Teacher workspace route contracts', () => {
  test('opens Sentence Ladder as a stateless guest preview', async ({ page }) => {
    const learnerWrites = [];
    page.on('request', (request) => {
      if (/\/sentence-ladder\/users\//.test(new URL(request.url()).pathname)) learnerWrites.push(request.url());
    });
    await page.setViewportSize({ width: 1200, height: 900 });
    await installTeacherReadModel(page);
    await page.goto('/school/sentence-ladder-preview/glossika-korean');

    await expect(page.getByText('Sentence Ladder · guest preview — nothing is saved', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Glossika Korean · Day 1' })).toBeVisible();
    await expect(page.getByText('Hello.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review' })).toHaveCount(0);
    expect(learnerWrites).toEqual([]);
    await page.screenshot({ path: path.join(OUT_DIR, 'sentence-ladder-guest-preview.png'), fullPage: true });
  });

  test('opens a historical session read-only with the real lesson taxonomy', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installTeacherReadModel(page);
    await page.goto('/school/teacher/students/user_2/history/sessions/ses_a6NVUhN9');

    await expect(page.getByRole('heading', { name: 'Illinois' })).toBeVisible();
    await expect(page.getByText('Civilization', { exact: true })).toBeVisible();
    await expect(page.getByText('User_2’s lesson record', { exact: false })).toBeVisible();
    await expect(page.getByText('United States Regions and States', { exact: true })).toBeVisible();
    await expect(page.getByText('Midwest', { exact: true })).toBeVisible();
    await expect(page.locator('.teacher-subject-identity .teacher-subject-identity__icon')).toHaveCount(1);
    await expect(page.locator('.teacher-lesson-identity__poster')).toHaveAttribute('src', /teacher\/curriculum\/.*\/poster\.jpg$/);
    await expect(page.getByText('Couldn’t load this session.')).not.toBeVisible();
    await expect(page.getByText('Questions and answers', { exact: true })).toBeVisible();
    await expect(page.getByText('Issued materials and results', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open worksheet' })).toHaveAttribute('href', /artifacts\/worksheet-illinois\/original\.pdf$/);
    await expect(page.getByRole('link', { name: 'Open receipt' })).toHaveAttribute('href', /receipt-illinois\/original$/);
    await expect(page.getByText(/Artifact lineage|Historical document|Open replayed worksheet|Score record/i)).toHaveCount(0);
    await expect(page.locator('a[href*="/results/"]')).toHaveCount(0);

    await page.screenshot({ path: path.join(OUT_DIR, 'session-inspector.png'), fullPage: true });
  });

  test('uses the issued artifact record, not the legacy printable queue, on the dashboard', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await installTeacherReadModel(page);
    await page.goto('/school/teacher');
    await page.waitForTimeout(750);
    await expect(page.getByText(/This tab hit a rendering error/i)).toHaveCount(0);
    await page.locator('.teacher-roster__card').filter({ hasText: 'User_2' }).click();

    // The drill-in still NAMES the lesson — it just no longer re-renders the
    // day beneath it. The issued paper lives on the day record now.
    const details = page.locator('.teacher-roster__details');
    await expect(details.getByText('Illinois', { exact: true })).toBeVisible();
    await expect(details.getByText('Civilization', { exact: true })).toBeVisible();
    await expect(details.locator('.teacher-subject-identity__icon')).toHaveCount(1);
    await expect(details.locator('.teacher-lesson-identity__poster')).toHaveAttribute('src', /teacher\/curriculum\/.*\/poster\.jpg$/);
    await expect(page.getByText('Today’s paper and results')).toHaveCount(0);
    await expect(page.getByText('Processed today')).toHaveCount(0);

    const dayLink = details.getByRole('link', { name: /Open the full day record/ });
    await expect(dayLink).toHaveAttribute('href', /\/students\/user_2\/day$/);
    await dayLink.click();

    // One route, and real artifacts are directly available on the lesson row.
    await expect(page.getByRole('heading', { name: 'User_2’s day' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the worksheet' })).toHaveAttribute('href', /artifacts\/worksheet-illinois\/original\.pdf$/);
    await expect(page.getByRole('button', { name: 'Open the result receipt' })).toBeVisible();
    await expect(page.getByText(/No printable lessons/i)).toHaveCount(0);
    await expect(page.getByText(/^assessment$/i)).toHaveCount(0);
    await expect(page.getByText(/P044/i)).toHaveCount(0);

    await page.locator('.teacher-day-rows').screenshot({ path: path.join(OUT_DIR, 'today-issued-artifacts.png') });
  });

  test('retraces any study day in one place — plan, record, and paper', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await installTeacherReadModel(page);
    await page.goto('/school/teacher/students/user_2/day/2026-08-24');

    await expect(page.getByText('Monday, Aug 24')).toBeVisible();
    await expect(page.getByTestId('day-summary')).toBeVisible();
    // The join answers all three plan sections: one done, one untouched, one deferred.
    await expect(page.getByTestId('day-summary')).toHaveText('1 done · 1 not started · 1 deferred');
    await expect(page.getByText('Illinois', { exact: true })).toBeVisible();
    await expect(page.getByText('Fractions Ep. 4', { exact: true })).toBeVisible();
    await expect(page.getByText('Deferred for civilization focus', { exact: true })).toBeVisible();
    // The study day is stated once for the page, never repeated per row (IA2).
    await expect(page.getByText('Monday, Aug 24')).toHaveCount(1);

    await expect(page.getByRole('link', { name: 'Open the worksheet' }))
      .toHaveAttribute('href', /artifacts\/worksheet-illinois\/original\.pdf$/);

    await page.getByRole('button', { name: /previous day/i }).click();
    await expect(page).toHaveURL(/\/day\/2026-08-23$/);

    await page.screenshot({ path: path.join(OUT_DIR, 'learner-day.png'), fullPage: true });
  });

  test('dry-runs the printed agenda without minting a session, ticket, or code', async ({ page }) => {
    const writes = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() !== 'GET' && /\/agenda\//.test(url.pathname)) {
        writes.push({ method: request.method(), path: url.pathname });
      }
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await installTeacherReadModel(page);
    await page.goto('/school/teacher/students/user_2/day/2026-08-24');

    await page.getByRole('button', { name: /preview printable agenda/i }).click();
    const printed = page.getByAltText(/printed agenda/i);
    await expect(printed).toBeVisible();
    await expect(printed).toHaveAttribute('src', /agenda\/preview\?.*studyDay=2026-08-24/);
    await expect(page.getByText(/codes on this copy don’t work/i)).toBeVisible();
    // No affordance anywhere that would send this to a real printer.
    await expect(page.getByRole('button', { name: /print .* agenda/i })).toHaveCount(0);
    expect(writes).toEqual([]);

    await page.screenshot({ path: path.join(OUT_DIR, 'printed-agenda-preview.png'), fullPage: true });
  });

  test('lets a teacher preview any agenda day without creating an agenda record or printer dispatch', async ({ page }) => {
    const writes = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() !== 'GET' && /\/agenda\/(dispatch|preview)/.test(url.pathname)) writes.push({ method: request.method(), path: url.pathname });
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installTeacherReadModel(page);
    await page.goto('/school/teacher/students/user_2/day');

    const studyDay = page.locator('input[type="date"]');
    await expect(studyDay).toHaveCount(1);
    await studyDay.fill('2099-01-01');
    // The day picker drives the URL, so a previewed day is bookmarkable.
    await expect(page).toHaveURL(/\/students\/user_2\/day\/2099-01-01$/);
    await expect(page.locator('.teacher-day-nav__label')).toContainText('Thursday, Jan 1');
    // The dry-run promise now rides the printed agenda it describes.
    await page.getByRole('button', { name: 'Preview printable agenda' }).click();
    await expect(page.getByText('This is the paper as it would print — but the codes on this copy don’t work. Nothing here starts a lesson.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print User_2’s agenda' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /print .* agenda/i })).toHaveCount(0);
    expect(writes).toEqual([]);
    await page.screenshot({ path: path.join(OUT_DIR, 'future-agenda-preview.png'), fullPage: true });
  });
});
