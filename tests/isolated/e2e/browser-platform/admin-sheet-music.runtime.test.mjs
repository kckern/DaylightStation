import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const scoreId = 'files:docs/sheet-music/classical/fur-elise.musicxml';
const scorePath = `/admin/content/sheet-music/view/${scoreId}`;

test('Admin Sheet Music library opens the score through its wildcard route', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/v1/admin/sheet-music') {
      return route.fulfill({ json: { folders: ['classical'], scores: [{
        id: scoreId,
        folder: 'classical',
        file: 'fur-elise.musicxml',
        format: 'musicxml',
        title: 'Fur Elise',
        composer: 'Beethoven',
        poster: 'scan',
        learn: 'approved',
        learners: [],
      }] } });
    }
    if (pathname.startsWith('/api/v1/proxy/media/stream/')) {
      return route.fulfill({ status: 200, contentType: 'application/xml', body: '<score-partwise/>' });
    }
    if (pathname === '/api/v1/admin/sheet-music/learn') {
      return route.fulfill({ json: { version: 1, scoreId, segments: [] } });
    }
    if (pathname === '/api/v1/admin/apps/piano/config') {
      return route.fulfill({ json: { parsed: {} } });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/content/sheet-music');
  await expect(page.getByRole('heading', { name: 'Sheet music' })).toBeVisible();
  await page.getByRole('link', { name: 'Fur Elise' }).click();

  await expect.poll(() => new URL(page.url()).pathname).toBe(scorePath);
  await expect(page.getByRole('heading', { name: 'fur-elise.musicxml' })).toBeVisible();
  await expect(page.getByText(scoreId, { exact: true })).toBeVisible();
});
