import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'docs/_wip/audits/teacher-workspace');
fs.mkdirSync(OUT_DIR, { recursive: true });

const milo = { id: 'milo', name: 'Milo' };
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
    learnerId: 'milo',
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
    { artifactId: 'worksheet-illinois', kind: 'assignment', availability: 'deterministic-replay', originalPdfUrl: '/api/v1/school/teacher/sessions/ses_a6NVUhN9/worksheet.pdf', thumbnailUrl: '/api/v1/school/teacher/sessions/ses_a6NVUhN9/worksheet.thumbnail.png' },
    { artifactId: 'receipt-illinois', kind: 'result-receipt', availability: 'exact', originalUrl: '/api/v1/school/teacher/artifacts/receipt-illinois/original' },
  ],
};

const day = [{
  learnerId: 'milo', effectiveScoreTotals: { correct: 6, total: 6 }, pendingReview: 0,
  sessions: [{
    sessionId: 'ses_a6NVUhN9', lessonTitle: 'Illinois', subject: 'civilization',
    courseTitle: 'United States Regions and States', moduleTitle: 'Midwest',
    posterUrl: '/api/v1/school/teacher/curriculum/civilization%2Fyoung-peoples-atlas-us/poster.jpg',
    studyDay: '2026-08-24', effectiveScore: { correctCount: 6, totalCount: 6, percent: 100 }, state: 'closed',
  }],
}];

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
    if (pathname.endsWith('/worksheet.thumbnail.png')) {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="210"><rect width="100%" height="100%" fill="#fff"/><text x="22" y="55" font-size="22">Illinois</text><text x="22" y="88" font-size="14">6 questions</text></svg>' });
      return;
    }
    if (pathname.endsWith('/worksheet.pdf')) {
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: onePagePdf });
      return;
    }
    if (pathname.endsWith('/artifacts/receipt-illinois/original')) {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="400"><rect width="100%" height="100%" fill="#fff"/><text x="18" y="40" font-size="18">Milo — Illinois</text><text x="18" y="75" font-size="14">6 of 6 correct</text></svg>' });
      return;
    }
    if (pathname.endsWith('/poster.jpg')) {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="100%" height="100%" fill="#b8873b"/><text x="10" y="58" font-size="12">Atlas</text></svg>' });
      return;
    }
    const data = pathname.endsWith('/roster') ? [milo]
      : pathname.endsWith('/teachers') ? { configured: true, teachers: [{ id: 'teacher', name: 'Teacher' }] }
        : pathname.endsWith('/teacher/auth/status') ? { active: false }
          : pathname.endsWith('/teacher/day') ? day
          : pathname.endsWith('/lifecycle/review') ? { items: [] }
              : pathname.endsWith('/print/pending') || pathname.endsWith('/quiz-requests') ? []
              : pathname.endsWith('/teacher/sessions/ses_a6NVUhN9') ? session
                : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
}

test.describe('Teacher workspace route contracts', () => {
  test('opens a historical session read-only with the real lesson taxonomy', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installTeacherReadModel(page);
    await page.goto('/school/teacher/students/milo/history/sessions/ses_a6NVUhN9');

    await expect(page.getByRole('heading', { name: 'Illinois' })).toBeVisible();
    await expect(page.getByText('Civilization', { exact: true })).toBeVisible();
    await expect(page.getByText('Milo completed this lesson', { exact: false })).toBeVisible();
    await expect(page.getByText('United States Regions and States', { exact: true })).toBeVisible();
    await expect(page.getByText('Midwest', { exact: true })).toBeVisible();
    await expect(page.getByText('Couldn’t load this session.')).not.toBeVisible();
    await expect(page.getByText('Worksheet and questions', { exact: true })).toBeVisible();
    await expect(page.getByText('Answers and result', { exact: true })).toBeVisible();
    await expect(page.getByText('Issued materials and results', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open worksheet' })).toHaveAttribute('href', /worksheet\.pdf$/);
    await expect(page.getByRole('link', { name: 'Open receipt' })).toHaveAttribute('href', /receipt-illinois\/original$/);
    await expect(page.getByText(/Artifact lineage|Historical document|Open replayed worksheet/i)).toHaveCount(0);

    await page.screenshot({ path: path.join(OUT_DIR, 'session-inspector.png'), fullPage: true });
  });

  test('uses the issued artifact record, not the legacy printable queue, on the dashboard', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await installTeacherReadModel(page);
    await page.goto('/school/teacher');
    await page.waitForTimeout(750);
    await expect(page.getByText(/This tab hit a rendering error/i)).toHaveCount(0);
    await page.locator('.teacher-roster__card').filter({ hasText: 'Milo' }).click();

    await expect(page.getByText('Illinois', { exact: true })).toBeVisible();
    await expect(page.getByText('Civilization', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open worksheet' })).toHaveAttribute('href', /worksheet\.pdf$/);
    await expect(page.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('download', '');
    await expect(page.getByRole('link', { name: 'Open receipt' })).toHaveAttribute('href', /receipt-illinois\/original$/);
    await expect(page.getByText(/No printable lessons/i)).toHaveCount(0);
    await expect(page.getByText(/^assessment$/i)).toHaveCount(0);
    await expect(page.getByText(/P044/i)).toHaveCount(0);

    await page.locator('.teacher-roster__details').screenshot({ path: path.join(OUT_DIR, 'today-issued-artifacts.png') });
  });
});
