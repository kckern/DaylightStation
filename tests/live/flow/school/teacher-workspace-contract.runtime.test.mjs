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
    subject: 'Civilization',
    courseTitle: 'United States Regions and States',
    moduleTitle: 'Midwest',
    lessonTitle: 'Illinois',
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
  artifacts: [],
};

async function installTeacherReadModel(page) {
  await page.route('**/api/v1/school/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const data = pathname.endsWith('/roster') ? [milo]
      : pathname.endsWith('/teachers') ? { configured: true, teachers: [{ id: 'teacher', name: 'Teacher' }] }
        : pathname.endsWith('/teacher/auth/status') ? { active: false }
          : pathname.endsWith('/lifecycle/review') ? { items: [] }
            : pathname.endsWith('/print/pending') ? []
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
    await expect(page.getByText('Milo · United States Regions and States · Midwest', { exact: true })).toBeVisible();
    await expect(page.getByText('Couldn’t load this session.')).not.toBeVisible();
    await expect(page.getByText('Paper issued', { exact: true })).toBeVisible();
    await expect(page.getByText('Answers and result', { exact: true })).toBeVisible();

    await page.screenshot({ path: path.join(OUT_DIR, 'session-inspector.png'), fullPage: true });
  });
});
