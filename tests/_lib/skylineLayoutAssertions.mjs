import { expect } from '@playwright/test';

export async function readMenuGeometry(page) {
  return page.evaluate(() => {
    const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const host = document.querySelector('#host');
    const scroller = document.querySelector('[data-skyline-scroll]');
    const actions = document.querySelector('.skyline-menu-layout__actions');
    return {
      host: box(host), root: box(host.querySelector('main')), content: box(scroller), actionRegion: box(actions),
      scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
      document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], viewport: [innerWidth, innerHeight],
      actions: [...actions.querySelectorAll('button')].map(e => ({ position: e.dataset.position, label: e.querySelector('strong')?.textContent || e.textContent, ...box(e) })),
      utility: box(document.querySelector('.skyline-menu-layout__utility')),
    };
  });
}
export async function expectMenuGeometry(page) {
  const g = await readMenuGeometry(page);
  expect(g.document).toEqual(g.viewport);
  for (const r of [g.root, g.content, g.actionRegion, g.utility]) {
    expect(r.left).toBeGreaterThanOrEqual(g.host.left - 1);
    expect(r.top).toBeGreaterThanOrEqual(g.host.top - 1);
    expect(r.right).toBeLessThanOrEqual(g.host.right + 1);
    expect(r.bottom).toBeLessThanOrEqual(g.host.bottom + 1);
  }
}
export async function expectSelectedRowVisible(page) {
  await expect.poll(() => page.evaluate(() => {
    const row = document.querySelector('.skyline-menus__options [aria-pressed="true"]');
    const root = document.querySelector('[data-skyline-scroll]');
    const r = row.getBoundingClientRect(), b = root.getBoundingClientRect();
    return r.top >= b.top - 1 && (r.height > root.clientHeight ? r.top <= b.top + 20 : r.bottom <= b.bottom + 1);
  })).toBe(true);
}
