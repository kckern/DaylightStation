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

/** WCAG contrast ratio of the rendered text colour against its effective (alpha-flattened) background. */
export async function contrastOf(page, selector) {
  return page.evaluate((selector) => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const over = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1,
    });
    const lum = ({ r, g, b }) => {
      const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const el = document.querySelector(selector);
    if (!el) return { selector, missing: true };
    // Background: stack every translucent layer up to the first opaque one.
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break; }
    }
    let base = { r: 16, g: 17, b: 19, a: 1 }; // the app's body colour, if nothing opaque was found
    if (layers.length && layers[layers.length - 1].a >= 1) base = layers.pop();
    for (const l of layers.reverse()) base = over(l, base);
    const fg = parse(getComputedStyle(el).color);
    const eff = fg.a < 1 ? over(fg, base) : fg;
    const [hi, lo] = [lum(eff), lum(base)].sort((a, b) => b - a);
    return { selector, ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, fg: getComputedStyle(el).color, bg: `rgb(${Math.round(base.r)}, ${Math.round(base.g)}, ${Math.round(base.b)})`, size: getComputedStyle(el).fontSize };
  }, selector);
}

/** Total layout-shift score observed while `action` runs (excluding shifts right after a person's input). */
export async function layoutShiftDuring(page, action) {
  await page.evaluate(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: false });
  });
  await action();
  return page.evaluate(() => window.__cls);
}
