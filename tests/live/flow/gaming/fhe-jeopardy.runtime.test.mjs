import { test, expect } from '@playwright/test';

// FHE Jeremiah Jeopardy on the living-room screen: three teams with a guest,
// skip controller binding (number keys stay on slots 1–3), a $100 picture clue,
// a keyboard buzz, and a host judgment. BASE_URL selects the deployment.
test('FHE Jeremiah Jeopardy: three teams, picture clue, buzz and judge', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 960, height: 540 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const gameFailures = [];
  const soundCues = [];
  page.on('response', response => {
    const url = response.url();
    if (!url.includes('/api/v1/gaming/')) return;
    if (response.status() >= 400) gameFailures.push({ url, status: response.status() });
    const cue = url.match(/\/api\/v1\/gaming\/media\/jeopardy\/([a-z-]+)\.mp3/)?.[1];
    if (cue && response.status() < 400) soundCues.push(cue);
  });

  await page.goto('/screens/living-room/party-games/jeopardy:fhe-jeremiah', { waitUntil: 'domcontentloaded' });

  const setup = page.getByTestId('team-setup');
  await expect(setup).toBeVisible({ timeout: 30_000 });
  const confirm = page.getByTestId('teams-confirm');
  for (let step = 0; step < 6 && !/3 teams/.test(await confirm.textContent()); step++) {
    const count = Number((await confirm.textContent()).match(/(\d+) teams/)?.[1]);
    if (count < 3) await page.getByRole('button', { name: '+ Team' }).click();
    else await page.getByRole('button', { name: 'Remove team' }).last().click();
  }
  await expect(confirm).toHaveText('Start with 3 teams');
  await page.getByRole('button', { name: '+ Guest' }).first().click();
  await confirm.click();

  await expect(page.getByText('Buzzer check')).toBeVisible();
  await page.getByRole('button', { name: 'Start game' }).click();

  await page.getByRole('button', { name: 'Fill the board' }).click({ timeout: 30_000 });
  const board = page.getByTestId('jeopardy-board');
  await expect(board).toBeVisible();
  await expect(board.getByRole('columnheader')).toHaveCount(5);
  await expect(board.getByRole('columnheader').first()).toHaveText('Called as a Child');

  await board.locator('.jp-board__tile').first().click();
  const clue = page.getByTestId('clue-screen');
  await expect(clue).toBeVisible();
  const picture = clue.locator('img.gp-media--image');
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(clue.locator('.jp-clue__media-error')).toHaveCount(0);

  await page.keyboard.press('1');
  const firstTeam = page.locator('.gp-scoreboard__team').first();
  await expect(firstTeam).toHaveClass(/is-locked/);
  await page.keyboard.press('ArrowUp');
  await expect(firstTeam.locator('.gp-scoreboard__score')).toContainText('100');

  expect(soundCues).toEqual(expect.arrayContaining(['board-fill', 'reveal', 'buzz', 'correct']));
  expect(gameFailures).toEqual([]);
  expect(pageErrors).toEqual([]);
});
