import { beforeAll, afterAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { render, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { chromium } from '@playwright/test';
import * as sass from 'sass';
import { DayInputBar } from './DayInputBar.jsx';

// Real layout, which jsdom cannot see: the bar's height, its fit on a phone, and
// that what it has to say opens over the meals instead of pushing them down.
const require = createRequire(import.meta.url);
const mantine = readFileSync(require.resolve('@mantine/core/styles.css'), 'utf8');
const css = sass.compile(fileURLToPath(new URL('./mealWorkflow.scss', import.meta.url).href)).css;
const date = '2026-11-18';
const entries = [{ uuid: 'eggs', name: 'Eggs', date, mealTime: 'morning' }];
const bar = rows => {
  const { container } = render(<MantineProvider><DayInputBar date={date} today={date} entries={rows} onResult={() => {}} onMoveDay={() => {}} /></MantineProvider>);
  const html = container.innerHTML;
  cleanup();
  return html;
};
const page = rows => `<style>${mantine}${css}*{box-sizing:border-box}body{margin:0;padding:0 16px;font:16px Arial}</style>${bar(rows)}<div class="health-log" style="height:400px">meals</div>`;
const OVERLAY = `<div class="health-day-input__overlay"><div class="health-day-input__panel"><span>Which food did you mean?</span>
  <div class="health-day-input__actions"><button class="mantine-Button-root" style="padding:0 8px">A very long food name that has to wrap on a narrow phone screen somehow</button><input type="date"></div></div></div>`;
const SHEET_ROW = '<div class="health-day-move"><label class="health-day-move__row"><input type="checkbox"><span class="health-day-move__name">Eggs</span></label></div>';

let browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

for (const width of [320, 390]) {
  it(`fits a ${width}px phone with full-size targets, and feedback moves nothing`, async () => {
    const tab = await browser.newPage({ viewport: { width, height: 800 } });
    try {
      await tab.setContent(page(entries));
      const result = await tab.evaluate(({ overlay, sheetRow }) => {
        const root = document.querySelector('.health-day-input');
        const log = document.querySelector('.health-log');
        const size = selector => { const box = document.querySelector(selector).getBoundingClientRect(); return [Math.round(box.width), Math.round(box.height)]; };
        const before = { height: root.getBoundingClientRect().height, logTop: log.getBoundingClientRect().top };
        const targets = { field: size('.health-day-input__field input'), mic: size('.health-day-input__mic'), send: size('.health-day-input__send'), move: size('.health-day-input__move') };
        root.insertAdjacentHTML('beforeend', overlay);
        document.body.insertAdjacentHTML('beforeend', sheetRow);
        const panel = document.querySelector('.health-day-input__overlay').getBoundingClientRect();
        return { before, targets, sheetRow: size('.health-day-move__row'), choice: size('.health-day-input__actions .mantine-Button-root'), dateField: size('.health-day-input__actions input'),
          after: { height: root.getBoundingClientRect().height, logTop: log.getBoundingClientRect().top },
          overlayInside: panel.left >= 0 && panel.right <= innerWidth, overflow: document.documentElement.scrollWidth > innerWidth };
      }, { overlay: OVERLAY, sheetRow: SHEET_ROW });
      expect(result.after).toEqual(result.before);
      expect(result.overflow).toBe(false);
      expect(result.overlayInside).toBe(true);
      for (const [name, [, height]] of Object.entries({ ...result.targets, sheetRow: result.sheetRow, choice: result.choice, dateField: result.dateField })) expect(height, name).toBeGreaterThanOrEqual(44);
      for (const name of ['mic', 'send', 'move']) expect(result.targets[name][0], name).toBeGreaterThanOrEqual(44);
      expect(result.targets.field[0]).toBeGreaterThanOrEqual(90);
    } finally { await tab.close(); }
  });
}

it('keeps its height when a day has no food to move', async () => {
  const tab = await browser.newPage({ viewport: { width: 390, height: 800 } });
  try {
    const height = async rows => { await tab.setContent(page(rows)); return tab.evaluate(() => document.querySelector('.health-day-input').getBoundingClientRect().height); };
    expect(await height([])).toBe(await height(entries));
  } finally { await tab.close(); }
});
