// tests/live/flow/school/card-ladder-stage.runtime.test.mjs
//
// Stage screenshots for the card ladder's `/test` door (spec §8 Test mode):
// drives a real learner through three seeded scenarios in a real browser at
// the Portal's 1280x800 and checks that no `.wl-fit` region overflows its
// box. This is the render check the unit tests cannot make — see
// docs/reference/school/card-ladder.md for what each scenario seeds.
//
// The `test.skip` guard below is the ONLY allowed skip: it is a
// missing-parameter guard (no real learner id may be committed), not a
// hidden failure. Run with a real enrolled learner:
//
//   CARD_LADDER_TEST_LEARNER=<enrolled id> npx playwright test \
//     tests/live/flow/school/card-ladder-stage.runtime.test.mjs --reporter=line
//
// Then open every screenshot in test-results/ and look at it — a passing
// assertion over a visibly broken screen is a failure.
import { test, expect } from '@playwright/test';
import { getAppPort } from '../../../_lib/configHelper.mjs';

const BASE = `http://localhost:${getAppPort()}`;
const LEARNER = process.env.CARD_LADDER_TEST_LEARNER;

for (const scenario of ['fresh', 'due', 'round-end']) {
  test(`card ladder stage fits at 1280x800 — ${scenario}`, async ({ page }) => {
    test.skip(!LEARNER, 'set CARD_LADDER_TEST_LEARNER to an enrolled learner id');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/school/go/${LEARNER}/card-ladder/test?scenario=${scenario}`);
    await expect(page.getByText('TEST — nothing is saved')).toBeVisible();
    // The sitting opens on a Start tap (spec §6), which is also the audio unlock.
    await page.getByRole('button', { name: 'Start' }).click();
    for (let i = 0; i < 25; i += 1) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `test-results/card-ladder-${scenario}-${String(i).padStart(2, '0')}.png` });
      const overflow = await page.evaluate(() => [...document.querySelectorAll('.wl-fit')]
        .filter((el) => el.scrollWidth > el.parentElement.getBoundingClientRect().width + 1).map((el) => el.textContent));
      expect(overflow, 'text overflowing its region').toEqual([]);
      if (await page.getByRole('heading', { name: 'All done for today' }).isVisible()) break;
      const answer = page.getByLabel('Your answer');
      if (await answer.isVisible()) { await answer.fill('가'); await answer.press('Enter'); await page.keyboard.press(' '); continue; }
      await page.keyboard.press(' ');
      await page.keyboard.press('3');
      await page.keyboard.press('1');
    }
  });
}
