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
  it(`keeps long summary readouts inside compact cards at ${width}px viewport / ${mainWidth}px main column`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      const labels = ['Protein', 'Carbs', 'Fat', 'Budget', 'Food', 'Exercise', 'Under'];
      const values = ['999+', '1,200', '999', '10,000', '12,345', '9,999', '10,000'];
      await page.setContent(`<style>
        :root { --ds-border: GrayText; --ds-surface: Canvas; --ds-text-high: CanvasText; --ds-text-mid: GrayText; --ds-text-low: GrayText; }
        * { box-sizing: border-box; } body { margin: 0; padding: 16px; font: 16px Arial; }
        ${css}
      </style><div class="health-today" style="width:${mainWidth}px"><div class="health-equation">
        <div style="width:194px">September 6, 2026</div>
        <div class="health-equation__math">${labels.map((label, index) => `
          <div class="health-daily-metric"><span class="health-daily-metric-label">${label}</span>
            <span class="health-daily-metric-readout"><span class="health-daily-metric-operator">${index > 3 ? '+' : ''}</span>
              <span class="health-daily-metric-value"><span class="health-daily-metric-number">${values[index]}</span></span>
              <span class="health-daily-metric-unit">${index < 3 ? 'g' : 'kcal'}</span>
            </span></div>`).join('')}</div></div></div>`);
      if (process.env.HEALTH_SUMMARY_SCREENSHOTS) {
        await page.screenshot({ path: `/tmp/health-summary-${width}-${mainWidth}.png` });
      }
      const geometry = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.health-daily-metric')];
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          height: document.querySelector('.health-equation').getBoundingClientRect().height,
          cards: cards.map(card => {
            const bounds = card.getBoundingClientRect();
            const number = card.querySelector('.health-daily-metric-number');
            const unit = card.querySelector('.health-daily-metric-unit');
            const n = number.getBoundingClientRect(); const u = unit.getBoundingClientRect();
            return { top: bounds.top, height: bounds.height, fontSize: getComputedStyle(number).fontSize,
              contained: [...card.querySelectorAll('.health-daily-metric-readout > *')].every(child => {
                const r = child.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right;
              }), inline: u.left >= n.right && u.top < n.bottom && u.bottom > n.top };
          }),
        };
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.cards.every(card => card.contained && card.inline)).toBe(true);
      expect(new Set(geometry.cards.map(card => card.fontSize)).size).toBe(1);
      expect(new Set(geometry.cards.map(card => card.height)).size).toBe(1);
      expect(geometry.height).toBeLessThan(width === 390 ? 180 : 120);
      const tops = geometry.cards.map(card => card.top);
      if (mainWidth > 1050) expect(new Set(tops).size).toBe(1);
      else {
        expect(new Set(tops.slice(0, 3)).size).toBe(1);
        expect(tops[3]).toBeGreaterThan(tops[0]);
        expect(new Set(tops.slice(3)).size).toBe(mainWidth <= 540 ? 2 : 1);
      }
    } finally { await page.close(); }
  });
}
