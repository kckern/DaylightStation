// Pure layout sizing math for the race screen.
//
// columnTemplateFor: a panel's sizeHint → its relative weight in the top grid
// row, so a 'focus' panel (the broadcast camera) gets more width than a
// 'standard' one. Returns a CSS grid-template-columns string.
const HINT_WEIGHT = { focus: 2, wide: 1, standard: 1 };

export function columnTemplateFor(sizeHints = []) {
  const list = (Array.isArray(sizeHints) ? sizeHints : []).filter(Boolean);
  if (list.length === 0) return '1fr';
  return list.map((h) => `${HINT_WEIGHT[h] || 1}fr`).join(' ');
}

// fitScale: the largest uniform scale (≤ 1) that fits `content` inside `zone`
// without overflow. 1 when it already fits or when a dimension is unknown.
export function fitScale(content = {}, zone = {}) {
  const cw = Number(content.width) || 0;
  const ch = Number(content.height) || 0;
  const zw = Number(zone.width) || 0;
  const zh = Number(zone.height) || 0;
  if (cw <= 0 || ch <= 0 || zw <= 0 || zh <= 0) return 1;
  return Math.min(1, zw / cw, zh / ch);
}

export default { columnTemplateFor, fitScale };
