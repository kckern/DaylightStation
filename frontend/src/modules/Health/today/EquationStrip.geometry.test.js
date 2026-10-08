// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import * as sass from 'sass';
import { fileURLToPath } from 'node:url';

let browser;
const css = sass.compile(fileURLToPath(new URL('../health.scss', import.meta.url))).css;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

for (const { width, mainWidth } of [{ width: 390, mainWidth: 358 }, { width: 800, mainWidth: 768 }, { width: 1440, mainWidth: 1088 }, { width: 1440, mainWidth: 1408 }]) {
  it(`fits the budget bar and macros without overflow at ${width}px viewport / ${mainWidth}px main column`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      const macro = (label, value, target) => `<div class="health-macro-meter health-macro-tone--protein">
        <span class="health-macro-meter__label">${label}</span>
        <span class="health-macro-meter__value">${value}<span class="health-macro-meter__target"> / ${target}</span> g</span>
        <span class="health-macro-meter__track"><span class="health-macro-meter__fill" style="width:60%"></span></span></div>`;
      await page.setContent(`<style>
        :root { --ds-border: GrayText; --ds-surface: Canvas; --ds-surface-alt: Canvas; --ds-text-high: CanvasText; --ds-text-mid: GrayText; --ds-text-low: GrayText; --ds-success: green; --ds-info: blue; --ds-warning: orange; --ds-danger: red; }
        * { box-sizing: border-box; } body { margin: 0; padding: 16px; font: 16px Arial; }
        ${css}
      </style><div class="health-today" style="width:${mainWidth}px"><div class="health-equation">
        <div style="width:194px">September 6, 2026</div>
        <div class="health-equation__math"><div class="health-budget">
          <div class="health-budget__head"><span class="health-budget__lead"><span class="health-budget__headline"><strong>10,000</strong> kcal free</span>
            <span class="health-budget__sub">then 2,345 workout · 12,345 deficit · 22,345 to break even</span></span>
            <span class="health-budget__terms"><span>12,345 eaten</span><span class="health-budget__sep">·</span>
            <span>2,345 burned</span></span>
            <span class="health-dayclose"><button class="health-dayclose-pill"><span>Close day</span></button></span></div>
          <div class="health-budget__ruler">
            <div class="health-budget__goal-rail"><span class="health-budget__goal-bracket" style="left:35%;width:27%"></span>
              <span class="health-budget__goal-range-label health-budget__goal-range-label--end" style="left:62%">Goal 12,000–22,345</span></div>
            <div class="health-budget__track health-budget__track--ruler health-budget__track--in-range">
              <span class="health-budget__goal-band" style="left:35%;width:27%"></span>
              <span class="health-budget__consumed health-budget__consumed--base" style="left:0%;width:44%"></span>
              <span class="health-budget__available health-budget__available--base" style="left:44%;width:11%"></span>
              <span class="health-budget__bonus health-budget__bonus--spent" style="left:55%;width:4%"></span>
              <span class="health-budget__bonus health-budget__bonus--available" style="left:59%;width:3%"></span>
              <span class="health-budget__post health-budget__post--plan" style="left:62%"></span>
              <span class="health-budget__post health-budget__post--even" style="left:89%"></span>
              <span class="health-budget__cursor health-budget__cursor--baseline" style="left:58%"></span>
              <span class="health-budget__cursor" style="left:44%"></span></div>
            <div class="health-budget__key"><span class="health-budget__key-item">Log floor 12,000</span>
              <span class="health-budget__key-item">Base target 20,000</span>
              <span class="health-budget__key-item">Plan end 22,345</span>
              <span class="health-budget__key-item">Break even 32,345</span></div>
          </div>
        </div><div class="health-equation__macros">${macro('Protein', '999+', '1,400')}${macro('Carbs', '1,200', '1,800')}${macro('Fat', '999', '700')}</div></div>
      </div></div>`);
      if (process.env.HEALTH_SUMMARY_SCREENSHOTS) {
        await page.screenshot({ path: `/tmp/health-summary-${width}-${mainWidth}.png` });
      }
      const geometry = await page.evaluate(() => {
        const math = document.querySelector('.health-equation__math').getBoundingClientRect();
        const inside = el => { const r = el.getBoundingClientRect(); return r.left >= math.left - 0.5 && r.right <= math.right + 0.5; };
        const bar = document.querySelector('.health-budget__track').getBoundingClientRect();
        const goalBandZ = Number(getComputedStyle(document.querySelector('.health-budget__goal-band')).zIndex);
        const consumedZ = Number(getComputedStyle(document.querySelector('.health-budget__consumed')).zIndex);
        const bonusZ = Number(getComputedStyle(document.querySelector('.health-budget__bonus')).zIndex);
        const baselineCursorZ = Number(getComputedStyle(document.querySelector('.health-budget__cursor--baseline')).zIndex);
        const macros = [...document.querySelectorAll('.health-macro-meter')].map(el => el.getBoundingClientRect());
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          height: document.querySelector('.health-equation').getBoundingClientRect().height,
          // The lead is display: contents on wide screens (no box of its own), so
          // measure its children, the headline and sub-line, instead.
          contained: [...document.querySelectorAll('.health-budget__head > :not(.health-budget__lead), .health-budget__lead > *, .health-budget__goal-range-label, .health-budget__key-item, .health-macro-meter__value')].every(inside),
          barWidth: bar.width, mathWidth: math.width, barBottom: bar.bottom,
          goalBandAboveConsumed: goalBandZ > consumedZ,
          baselineCursorAboveBonus: baselineCursorZ > bonusZ,
          macroTops: macros.map(r => r.top), macroLefts: macros.map(r => r.left),
        };
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.contained).toBe(true);
      expect(geometry.goalBandAboveConsumed).toBe(true);
      expect(geometry.baselineCursorAboveBonus).toBe(true);
      // The bar is the summary's widest element — at least half the row.
      expect(geometry.barWidth).toBeGreaterThan(geometry.mathWidth * 0.5);
      // The key may wrap, but the summary must remain compact.
      expect(geometry.height).toBeLessThan(width === 390 ? 230 : width === 800 ? 180 : 140);
      if (mainWidth > 1050) {
        // Wide: macros stack in a column beside the bar.
        expect(geometry.macroLefts.every(left => left === geometry.macroLefts[0])).toBe(true);
      } else {
        // Narrow: macros share one row under the bar.
        expect(new Set(geometry.macroTops).size).toBe(1);
        expect(geometry.macroTops[0]).toBeGreaterThan(geometry.barBottom);
      }
    } finally { await page.close(); }
  });
}

it('wraps four clustered marker labels inside a 320px viewport', async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 480 } });
  try {
    await page.setContent(`<style>
      * { box-sizing: border-box; } body { margin: 0; padding: 16px; font: 16px Arial; }
      ${css}
    </style><div class="health-budget__ruler" style="width:288px">
      <div class="health-budget__track health-budget__track--ruler"></div>
      <div class="health-budget__key">
        <span class="health-budget__key-item"><i class="health-budget__key-mark health-budget__key-mark--floor"></i>Log floor 1,200</span>
        <span class="health-budget__key-item"><i class="health-budget__key-mark health-budget__key-mark--base"></i>Base target 1,200</span>
        <span class="health-budget__key-item"><i class="health-budget__key-mark health-budget__key-mark--plan"></i>Plan end 1,210</span>
        <span class="health-budget__key-item"><i class="health-budget__key-mark health-budget__key-mark--even"></i>Break even 1,220</span>
      </div></div>`);
    const result = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      itemsInside: [...document.querySelectorAll('.health-budget__key-item')]
        .every(el => el.getBoundingClientRect().right <= 304),
    }));
    expect(result.scrollWidth).toBe(320);
    expect(result.itemsInside).toBe(true);
  } finally { await page.close(); }
});
