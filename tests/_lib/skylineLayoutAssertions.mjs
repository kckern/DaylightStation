import { expect } from '@playwright/test';

export async function readMenuGeometry(page) {
  return page.evaluate(() => {
    const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const host = document.querySelector('#host');
    const scroller = document.querySelector('[data-skyline-scroll]');
    const actions = document.querySelector('.skyline-menu-layout__actions');
    const frameRim = e => {
      const probe = document.createElement('i');
      probe.style.cssText = 'position:fixed;visibility:hidden;width:var(--sg-px);height:0;pointer-events:none';
      e.append(probe); const px = probe.getBoundingClientRect().width; probe.remove();
      return 2 * px;
    };
    return {
      host: box(host), root: box(host.querySelector('main')), content: box(scroller), actionRegion: box(actions),
      variant: document.querySelector('.skyline-menu-layout').dataset.variant,
      scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
      document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], viewport: [innerWidth, innerHeight],
      actions: [...actions.querySelectorAll('button')].map(e => ({ position: e.dataset.position, label: e.querySelector('strong')?.textContent || e.textContent, ...box(e) })),
      utility: box(document.querySelector('.skyline-menu-layout__utility')),
      frameClearance: [...document.querySelectorAll('.skyline-menus,.skyline-controls')].map(e => ({
        box: box(e), owner: box(e.closest('[data-skyline-scroll],.skyline-menu-layout__actions')),
        rim: frameRim(e),
      })),
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
  for (const frame of g.frameClearance) {
    expect(frame.box.left - frame.rim).toBeGreaterThanOrEqual(frame.owner.left - 1);
    expect(frame.box.right + frame.rim).toBeLessThanOrEqual(frame.owner.right + 1);
  }
  if (g.variant === 'touch' || g.host.width <= 760) {
    expect(g.content.bottom).toBeLessThanOrEqual(g.actionRegion.top + 1);
  } else expect(g.content.right).toBeLessThanOrEqual(g.actionRegion.left + 1);
  expect(Math.max(g.content.bottom, g.actionRegion.bottom)).toBeLessThanOrEqual(g.utility.top + 1);
}
export async function expectSelectedRowVisible(page) {
  await expect.poll(() => page.evaluate(() => {
    const row = document.querySelector('.skyline-menus__options [aria-pressed="true"]');
    const root = document.querySelector('[data-skyline-scroll]');
    const r = row.getBoundingClientRect(), b = root.getBoundingClientRect();
    return r.top >= b.top - 1 && (r.height > root.clientHeight ? r.top <= b.top + 20 : r.bottom <= b.bottom + 1);
  })).toBe(true);
}

/** Glyph fragments, not SVG rectangles or just the text element's own box. */
export async function readActionText(page) {
  return page.evaluate(() => {
    const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const fragments = e => {
      const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      const out = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim() || node.parentElement.closest('svg,[aria-hidden="true"]')) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        const kind = node.parentElement.closest('strong') ? 'label' : node.parentElement.closest('[data-hint-slot]') ? 'hint' : 'other';
        for (const r of range.getClientRects()) out.push({ text: node.textContent, kind, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      }
      return out;
    };
    const area = document.querySelector('.skyline-menu-layout__actions');
    return {
      scrolling: area.scrollHeight > area.clientHeight + 1,
      buttons: [...document.querySelectorAll('.skyline-menu-layout__actions button,.skyline-menu-layout__utility button')].map(e => ({
        position: e.dataset.position, box: box(e), label: e.querySelector('strong') ? box(e.querySelector('strong')) : null,
        hint: e.querySelector('[data-hint-slot]') ? box(e.querySelector('[data-hint-slot]')) : null,
        text: fragments(e),
      })),
    };
  });
}
export async function expectActionTextContained(page) {
  const geometry = await readActionText(page);
  expect(geometry.scrolling, 'built-in controls must fit without scrolling').toBe(false);
  for (const b of geometry.buttons) {
    expect(b.box.width).toBeGreaterThanOrEqual(48);
    expect(b.box.height).toBeGreaterThanOrEqual(48);
    for (const r of b.text) {
      expect(r.left, r.text).toBeGreaterThanOrEqual(b.box.left - 1);
      expect(r.right, r.text).toBeLessThanOrEqual(b.box.right + 1);
      expect(r.top, r.text).toBeGreaterThanOrEqual(b.box.top - 1);
      expect(r.bottom, r.text).toBeLessThanOrEqual(b.box.bottom + 1);
    }
    for (const label of b.text.filter(r => r.kind === 'label')) for (const hint of b.text.filter(r => r.kind === 'hint')) {
      const overlap = Math.min(label.right, hint.right) - Math.max(label.left, hint.left) > 1 && Math.min(label.bottom, hint.bottom) - Math.max(label.top, hint.top) > 1;
      expect(overlap, `${label.text} overlaps ${hint.text}`).toBe(false);
    }
  }
}

export async function expectContentTextContained(page) {
  const escaped = await page.evaluate(() => {
    const content = document.querySelector('[data-skyline-scroll]');
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const out = [];
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!node.textContent.trim() || parent.closest('svg,[aria-hidden="true"]') || getComputedStyle(parent).visibility === 'hidden') continue;
      const owner = parent.closest('button,.skyline-menus,.skyline-glider__notice') || content;
      const bounds = owner.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.left < bounds.left - 1 || r.right > bounds.right + 1) out.push({ text: node.textContent, left: r.left, right: r.right, ownerLeft: bounds.left, ownerRight: bounds.right });
    }
    return out;
  });
  expect(escaped).toEqual([]);
}
