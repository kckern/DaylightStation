import { beforeAll, afterAll, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { chromium } from '@playwright/test';
import * as sass from 'sass';
import { fileURLToPath } from 'node:url';
import { EquationStrip } from './EquationStrip.jsx';
import { EntryRow } from './EntryRow.jsx';
import { PortionContext } from './usePortionDraft.js';

const css = sass.compile(fileURLToPath(new URL('../health.scss', import.meta.url).href)).css;
const themed = ui => renderToStaticMarkup(<MantineProvider>{ui}</MantineProvider>);
const style = `<style>:root{--ds-border:gray;--ds-surface:white;--ds-surface-alt:#eee;--ds-text-high:#111;--ds-text-mid:#666;--ds-success:green;--ds-info:blue;--ds-warning:orange;--ds-danger:red}*{box-sizing:border-box}body{margin:16px;font:16px Arial}${css}</style>`;
let browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

for (const width of [390, 1366]) {
  it(`uses one endpoint color and neutral future space at ${width}px`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      for (const [food, color] of [[800, 'rgb(0, 0, 255)'], [1700, 'rgb(0, 128, 0)'], [2033, 'rgb(255, 165, 0)'], [2350, 'rgb(255, 0, 0)']]) {
        const budget = { food, exercise: 168, maintenance: 2000, budget: 1600, range: { floor: 1200, top: 1600 }, zone: 'in-range' };
        await page.setContent(style + themed(<EquationStrip budget={budget} date="2026-10-26" today="2026-10-26" onDateChange={() => {}} />));
        const actual = await page.evaluate(() => {
          const track = document.querySelector('[data-testid="budget-ruler"]');
          const fill = track.querySelector('[data-budget-consumed]');
          const hatch = track.querySelector('[data-budget-bonus]');
          const box = track.getBoundingClientRect();
          return {
            count: track.querySelectorAll('[data-budget-consumed]').length,
            color: getComputedStyle(fill).backgroundColor,
            future: getComputedStyle(track).backgroundColor,
            coloredFuture: track.querySelectorAll('[data-budget-available], [data-budget-goal-band], [data-budget-bonus="available"]').length,
            fillEnd: fill.getBoundingClientRect().right,
            hatchEnd: hatch?.getBoundingClientRect().right ?? null,
            hatch: hatch ? getComputedStyle(hatch).backgroundImage : null,
            posts: track.querySelectorAll('.health-budget__post').length,
            startColor: getComputedStyle(track.querySelector('.health-budget__post--floor')).borderLeftColor,
            goalColor: getComputedStyle(track.querySelector('.health-budget__post--plan')).borderLeftColor,
            overflow: document.documentElement.scrollWidth > innerWidth,
            contained: box.left >= 0 && box.right <= innerWidth,
          };
        });
        expect(actual.count).toBe(1);
        expect(actual.color).toBe(color);
        expect(actual.future).toBe('rgb(238, 238, 238)');
        expect(actual.coloredFuture).toBe(0);
        expect(actual.posts).toBe(4);
        expect(actual.startColor).toBe('rgb(0, 128, 0)');
        expect(actual.goalColor).toBe('rgb(0, 128, 0)');
        expect(actual.overflow).toBe(false);
        expect(actual.contained).toBe(true);
        if (food > 1600) {
          expect(actual.hatch).toContain('repeating-linear-gradient');
          expect(actual.hatchEnd).toBeLessThanOrEqual(actual.fillEnd + 0.5);
        } else expect(actual.hatch).toBeNull();
      }
    } finally { await page.close(); }
  });

  it(`keeps saving rows, columns and neighbors fixed at ${width}px`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      const row = { uuid: 'apple', name: 'Apple', grams: 100, amount: 100, unit: 'g', calories: 95 };
      const content = saving => {
        const view = render(<MantineProvider><PortionContext.Provider value={{ saving, locked: saving }}><EntryRow row={row} child onTap={() => {}} /></PortionContext.Provider></MantineProvider>);
        const html = view.container.querySelector('.health-row-line').outerHTML;
        view.unmount();
        return html;
      };
      await page.setContent(style + `<div class="health-meal">${content(false)}<div id="neighbor">Next food</div></div>`);
      const measure = () => page.evaluate(() => [...document.querySelectorAll('.health-row-line, .health-row__identity, .health-row__macros, .health-row__portion-cell, .health-row__kcal, .health-row__action, .health-row__menu, #neighbor')].map(el => {
        const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
      }));
      const before = await measure();
      await page.locator('.health-row-line').evaluate((el, html) => { el.outerHTML = html; }, content(true));
      const after = await measure();
      expect(after).toEqual(before);
      expect(await page.locator('.health-row__identity').evaluate(el => getComputedStyle(el).opacity)).toBe('0.6');
      // A child with an expanded control must keep its saving cue too.
      await page.locator('.health-row__menu').evaluate(el => el.setAttribute('aria-expanded', 'true'));
      expect(await page.locator('.health-row__identity').evaluate(el => getComputedStyle(el).opacity)).toBe('0.6');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await page.locator('.health-row__saving-spinner').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
      await page.locator('.health-row-line').evaluate((el, html) => { el.outerHTML = html; }, content(false));
      expect(await measure()).toEqual(before);
    } finally { await page.close(); }
  });
}
