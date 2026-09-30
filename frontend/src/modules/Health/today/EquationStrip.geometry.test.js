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
        :root { --ds-border: GrayText; --ds-surface: Canvas; --ds-surface-alt: Canvas; --ds-text-high: CanvasText; --ds-text-mid: GrayText; --ds-text-low: GrayText; --ds-success: green; --ds-warning: orange; --ds-danger: red; }
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
            <div class="health-budget__rail health-budget__rail--above">
              <span class="health-budget__goal-label health-budget__label--end" style="left:55.00%">Goal 20,000 + 2,345</span></div>
            <div class="health-budget__track health-budget__track--ruler">
              <span class="health-budget__food health-budget__food--in-range" style="left:0.00%;width:44.00%"></span>
              <span class="health-budget__tier health-budget__tier--free" style="left:44.00%;width:11.00%"><span class="health-budget__seg-label">10,000 free</span></span>
              <span class="health-budget__goal-line" style="left:55.00%"></span>
              <span class="health-budget__ceiling-line" style="left:62.00%"></span>
              <span class="health-budget__food-label health-budget__food-label--in-range" style="right:56.00%">12,345 eaten</span>
              <span class="health-budget__even" style="left:89.00%"></span></div>
            <div class="health-budget__rail health-budget__ticks">
              <span class="health-budget__tick" style="left:20.00%"><span class="health-budget__tick-label">5,000</span></span>
              <span class="health-budget__tick" style="left:40.00%"><span class="health-budget__tick-label">10,000</span></span></div>
            <div class="health-budget__rail health-budget__rail--below">
              <span class="health-budget__even-label health-budget__label--end" style="left:89.00%">Break even <b>22,345</b></span></div>
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
        const macros = [...document.querySelectorAll('.health-macro-meter')].map(el => el.getBoundingClientRect());
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          height: document.querySelector('.health-equation').getBoundingClientRect().height,
          // The lead is display: contents on wide screens (no box of its own), so
          // measure its children, the headline and sub-line, instead.
          contained: [...document.querySelectorAll('.health-budget__head > :not(.health-budget__lead), .health-budget__lead > *, .health-budget__goal-label, .health-budget__even-label, .health-budget__tick-label, .health-macro-meter__value')].every(inside),
          barWidth: bar.width, mathWidth: math.width, barBottom: bar.bottom,
          macroTops: macros.map(r => r.top), macroLefts: macros.map(r => r.left),
        };
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.contained).toBe(true);
      // The bar is the summary's widest element — at least half the row.
      expect(geometry.barWidth).toBeGreaterThan(geometry.mathWidth * 0.5);
      // Regression guards for the ranged ruler card (three rails + 18px track), measured 2026-09-25 at 220 / 160 / 119px.
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
