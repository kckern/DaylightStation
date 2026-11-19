import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const member = { username: 'amy', displayName: 'Amy' };
const plan = '/api/v1/life/plan/';

const forms = [
  {
    noun: 'goal', section: 'goals', read: 'goals',
    fields: { Goal: 'name', 'Why does this matter?': 'why', 'First milestone': 'milestone' },
    result: (id, draft) => ({ id, ...draft, state: 'dream' }),
    row: draft => draft.name,
  },
  {
    noun: 'value', section: 'values', read: '',
    fields: { Value: 'name' },
    result: (id, draft) => ({ id, ...draft, rank: id }),
    row: draft => draft.name,
  },
  {
    noun: 'belief', section: 'beliefs', read: 'beliefs',
    fields: { 'If I…': 'if_hypothesis', '…then': 'then_outcome' },
    result: (id, draft) => ({ id, if_hypothesis: draft.if_hypothesis, then_expectation: draft.then_outcome, state: 'testing' }),
    row: draft => 'If ' + draft.if_hypothesis,
  },
];

for (const { noun, section, read, fields, result, row } of forms) {
  for (const firstStatus of [201, 422]) {
    test('Life ' + noun + ' creation keeps the reopened draft after a late ' + firstStatus, async ({ page }) => {
      const submitted = [];
      const saved = [];
      const first = Promise.withResolvers();
      const second = Promise.withResolvers();
      const fieldNames = Object.keys(fields);
      const draft = prefix => Object.fromEntries(Object.values(fields).map(name => [name, prefix + ' ' + name]));
      const oldDraft = draft('Original');
      const currentDraft = draft('Replacement');
      const title = 'Add ' + noun;
      const submitLabel = 'Create ' + noun;

      await page.routeWebSocket('**/*', () => {});
      await page.route('**/api/**', async route => {
        const request = route.request();
        const { pathname, searchParams } = new URL(request.url());
        if (pathname === '/api/v1/life/users') return route.fulfill({ json: { users: [member] } });
        if (pathname === '/api/v1/life/user') return route.fulfill({ json: member });
        if (pathname === plan + read && request.method() === 'GET') {
          return route.fulfill({ json: { [section]: saved } });
        }
        if (pathname === plan + section && request.method() === 'POST') {
          const body = request.postDataJSON();
          submitted.push([searchParams.get('username'), body]);
          if (submitted.length === 1) {
            await first.promise;
            if (firstStatus === 422) return route.fulfill({ status: 422, json: { error: 'Original rejected' } });
          }
          if (submitted.length === 2) {
            await second.promise;
            return route.fulfill({ status: 422, json: { error: 'Replacement rejected' } });
          }
          const item = result(saved.length + 1, body);
          saved.push(item);
          return route.fulfill({ status: 201, json: item });
        }
        return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
      });

      await page.goto('/life/plan/' + section);
      const opener = page.getByRole('button', { name: title, exact: true });
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      const input = label => dialog.getByRole('textbox', { name: label, exact: true });
      const fill = async values => {
        for (const label of fieldNames) await input(label).fill(values[fields[label]]);
      };
      const submit = dialog.getByRole('button', { name: submitLabel, exact: true });

      try {
        await opener.press('Enter');
        await fill(oldDraft);
        await submit.click();
        await expect.poll(() => submitted).toEqual([['amy', oldDraft]]);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
        await opener.press('Enter');
        await fill(currentDraft);

        const completed = page.waitForResponse(response =>
          new URL(response.url()).pathname === plan + section && response.request().method() === 'POST');
        first.resolve();
        const response = await completed;
        expect(response.status()).toBe(firstStatus);
        await response.finished();

        if (firstStatus === 201) {
          await expect(page.getByText(row(oldDraft), { exact: true })).toBeVisible();
        } else {
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
        await expect(dialog).toBeVisible();
        await expect(input(fieldNames[0])).toHaveValue(currentDraft[fields[fieldNames[0]]]);
        await expect(dialog.getByRole('alert')).toHaveCount(0);

        await input(fieldNames[0]).press('Enter');
        await expect.poll(() => submitted).toEqual([['amy', oldDraft], ['amy', currentDraft]]);
        const form = dialog.getByRole('form', { name: title, exact: true });
        await form.evaluate(element => element.requestSubmit());
        second.resolve();
        await expect(dialog.getByRole('alert')).toContainText('Replacement rejected');
        await expect(input(fieldNames[0])).toHaveValue(currentDraft[fields[fieldNames[0]]]);
        expect(submitted).toHaveLength(2);
        await input(fieldNames[0]).press('Enter');
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
        await expect(page.getByText(row(currentDraft), { exact: true })).toBeVisible();
        expect(submitted).toEqual([['amy', oldDraft], ['amy', currentDraft], ['amy', currentDraft]]);
      } finally {
        first.resolve();
        second.resolve();
      }
    });
  }
}
