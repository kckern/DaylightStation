import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

for (const editor of [
  {
    name: 'Device',
    path: '/admin/household/devices/fixture',
    label: 'fixtureField',
    payload: { device: { id: 'fixture', type: 'linux-pc', os_control: { fixtureField: 'Original value' } } },
    submitted: body => body.os_control.fixtureField,
  },
  {
    name: 'Member',
    path: '/admin/household/members/fixture',
    label: 'Display Name',
    payload: { member: { username: 'fixture', display_name: 'Original value', type: 'family_member' } },
    submitted: body => body.display_name,
  },
]) {
  test(`Admin ${editor.name} SaveBar owns keyboard save and revert for the active editor`, async ({ page }) => {
    const acknowledgement = Promise.withResolvers();
    const writes = [];
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/v1' + editor.path) {
        if (request.method() === 'PUT') {
          writes.push(editor.submitted(request.postDataJSON()));
          await acknowledgement.promise;
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: editor.payload });
      }
      return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });
    await page.goto(editor.path);
    const field = page.getByLabel(editor.label, { exact: true });
    const save = page.getByTestId('config-save-button');
    const revert = page.getByRole('button', { name: 'Revert', exact: true });
    await expect(field).toHaveValue('Original value');
    await field.fill('Submitted value');
    await save.focus();
    try {
      if (editor.name === 'Member') {
        await save.evaluate(button => button.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ы', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true,
        })));
      } else {
        await page.keyboard.press('Control+s');
      }
      await expect.poll(() => writes).toEqual(['Submitted value']);
      await expect(save).toBeDisabled();
      await page.keyboard.press('Control+s');
    } finally {
      acknowledgement.resolve();
    }

    await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
    await field.fill('Next draft');
    await revert.focus();
    await page.keyboard.press('Control+Shift+z');
    await expect(field).toHaveValue('Next draft');

    if (editor.name === 'Device') {
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      const cancel = page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true });
      await cancel.focus();
      // Dispatch only the page events so the browser's own Save and Undo stay out of this check.
      const allowed = await cancel.evaluate(button => ['s', 'z'].map(key =>
        button.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }))));
      expect(allowed).toEqual([true, true]);
      await cancel.click();
      await expect(field).toHaveValue('Next draft');
    }

    await revert.focus();
    await page.keyboard.press('Control+z');
    await expect(field).toHaveValue('Submitted value');
    await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
    expect(writes).toEqual(['Submitted value']);
  });
}
