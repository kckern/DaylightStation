// Shared measurements for the accessibility / parity journeys. Everything here
// reads computed layout from the live page — nothing is asserted from source.
export const SIZES = [
  ['phone', { width: 390, height: 844 }],
  ['tablet', { width: 820, height: 1180 }],
  ['laptop', { width: 1440, height: 900 }],
];

const INTERACTIVE = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem], [role=option], [role=switch], [role=checkbox], [role=radio], [tabindex]:not([tabindex="-1"])';

/** Visible interactive elements (portalled menus/dialogs included) smaller than 44 x 44 CSS px. */
export async function smallTargets(page, { scope = 'body', min = 44 } = {}) {
  return page.evaluate(({ scope, min, INTERACTIVE }) => {
    const root = document.querySelector(scope) ?? document.body;
    const seen = new Set();
    const out = [];
    for (const el of root.querySelectorAll(INTERACTIVE)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[inert], [hidden]')) continue;
      // A disabled control is not a target.
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Visually-hidden helpers (1px clip) are not hit targets.
      if (r.width <= 2 && r.height <= 2) continue;
      // A control is hit through its labelled wrapper when the wrapper is the larger target.
      const label = el.closest('label') ?? el.labels?.[0] ?? null;
      const lr = label ? label.getBoundingClientRect() : null;
      const w = Math.max(r.width, lr?.width ?? 0);
      const h = Math.max(r.height, lr?.height ?? 0);
      if (w >= min - 0.5 && h >= min - 0.5) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        id: el.getAttribute('data-testid'),
        name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 40),
        w: Math.round(w), h: Math.round(h),
      });
    }
    return out;
  }, { scope, min, INTERACTIVE });
}

/** Everything interactive that is visible but outside the viewport (function hidden by width/height). */
export async function offscreenControls(page, selectors) {
  const out = [];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (!(await loc.count())) { out.push({ sel, problem: 'missing' }); continue; }
    const b = await loc.boundingBox();
    const vp = page.viewportSize();
    if (!b || b.width === 0 || b.x < -0.5 || b.y < -0.5 || b.x + b.width > vp.width + 0.5 || b.y + b.height > vp.height + 0.5) {
      out.push({ sel, problem: 'outside-viewport', box: b });
    }
  }
  return out;
}

export const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
