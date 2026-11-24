// "Nothing clipped" on the office canvas, measured in the page.
//
// Every visible leaf (an element carrying text, an <svg> or an <img>) must lie
// inside the 1280×720 canvas and inside every ancestor that clips; text must not
// be cut by its own box (ellipsis, line clamp); and a leaf that takes hits must
// be the thing on top at its centre (not drawn under a sibling, the way a
// squeezed keyboard once slid under the passage path).
// Returns a list of findings; an empty list is a pass.
export function findClipping({ rootSelector = '#root', scope = null, ignore = [] } = {}) {
  const root = document.querySelector(rootSelector);
  if (!root) return ['no canvas'];
  // `scope` is the surface on top (the launcher, Sheet Music): what lies beneath it is meant to be covered.
  const canvas = scope ? document.querySelector(scope) : root;
  if (!canvas) return [`no ${scope}`];
  const box = root.getBoundingClientRect();
  const findings = [];
  const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className ?? '').trim().split(/\s+/).slice(0, 2).join('.')}${el.textContent?.trim() ? ` "${el.textContent.trim().slice(0, 30)}"` : ''}`;
  const outside = (r, b) => r.left < b.left - 1 || r.top < b.top - 1 || r.right > b.right + 1 || r.bottom > b.bottom + 1;
  const visible = (el) => {
    for (let at = el; at && at !== document.body; at = at.parentElement) {
      const s = getComputedStyle(at);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  for (const el of canvas.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (el.closest('svg') && tag !== 'svg') continue;
    if (ignore.some((selector) => el.closest(selector))) continue;
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!ownText && tag !== 'svg' && tag !== 'img') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || !visible(el)) continue;
    if (outside(r, box)) { findings.push(`off the canvas: ${name(el)}`); continue; }
    for (let at = el.parentElement; at && at !== canvas; at = at.parentElement) {
      const s = getComputedStyle(at);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      if (outside(r, at.getBoundingClientRect())) { findings.push(`cut by ${name(at)}: ${name(el)}`); break; }
    }
    const s = getComputedStyle(el);
    if (ownText && ((s.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) || (s.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1))) {
      findings.push(`text cut: ${name(el)}`);
    }
    // Text and whole drawings (a staff, a keyboard), not glyph-sized icons, whose boxes overlap their pills by design.
    if (s.pointerEvents !== 'none' && (ownText || r.height >= 48)) {
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const drawing = (node) => node?.closest?.('svg') ?? null;
      // Two SVG layers of one drawing (a staff's lines under its notes) stack by design.
      const layered = tag === 'svg' && drawing(top) && drawing(top).parentElement === el.parentElement;
      if (top && top !== el && !el.contains(top) && !top.contains(el) && !layered && !(drawing(top) && el.contains(drawing(top)))) {
        findings.push(`under ${name(top)}: ${name(el)}`);
      }
    }
  }
  return findings;
}
