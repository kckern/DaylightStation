// A queue command may say `loop` (WakeAndLoad `?loop=1`, HA scripts); the Player
// reads `continuous`. The same alias parseAutoplayParams applies to URL params.
const OFF = new Set(['0', 'false', 'no', 'off', '']);

export function withLoopAlias(payload) {
  if (!payload || payload.loop == null || payload.continuous != null) return payload;
  return { ...payload, continuous: !OFF.has(String(payload.loop).trim().toLowerCase()) };
}
