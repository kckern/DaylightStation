import {expect} from '@playwright/test';

/** Check the owned archived fixture using the same keyboard path as Admin users. */
export async function assertArchivedHistory(page, fixtureId, expectedTitle) {
  const history=page.locator('details').filter({has:page.getByText('Archived agendas',{exact:true})});
  const summary=history.locator('summary');
  await expect(history).not.toHaveAttribute('open');
  const ownLink=history.locator(`a[href="/admin/content/agendas/${fixtureId}"]`);
  await expect(ownLink).toHaveCount(1);
  await expect(ownLink).toHaveText(expectedTitle);
  await expect(ownLink).toBeHidden();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(history).toHaveAttribute('open');
  await expect(ownLink).toBeVisible();
  await expect(ownLink).toHaveText(expectedTitle);
  await page.keyboard.press('Enter');
  await expect(history).not.toHaveAttribute('open');
  await expect(ownLink).toBeHidden();
}
