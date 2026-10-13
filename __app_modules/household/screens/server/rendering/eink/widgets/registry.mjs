/**
 * Eink Widget Registry
 * @module 1_rendering/eink/widgets/registry
 *
 * Maps widget names to draw functions.
 * Each draw function signature: (ctx, box, data, theme) => void
 */

const widgets = new Map();

export function register(name, drawFn) {
  widgets.set(name, drawFn);
}

export function get(name) {
  return widgets.get(name) || null;
}

export function has(name) {
  return widgets.has(name);
}

export function clear() {
  widgets.clear();
}
