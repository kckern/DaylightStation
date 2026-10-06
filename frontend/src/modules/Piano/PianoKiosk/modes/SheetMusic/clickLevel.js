// Gains leave room for the standard 25/18 accent boost, even at Max.
export const CLICK_LEVELS = Object.freeze([
  { id: 'soft', label: 'Soft', gain: 0.08 },
  { id: 'medium', label: 'Medium', gain: 0.18 },
  { id: 'loud', label: 'Loud', gain: 0.36 },
  { id: 'max', label: 'Max', gain: 0.6 },
].map(Object.freeze));

const KEY = 'piano.learn.click-level';
const resolveLevel = (id) => CLICK_LEVELS.find((level) => level.id === id) ?? CLICK_LEVELS[2];

export function readClickLevel(storage) {
  try { return resolveLevel(storage?.getItem(KEY)); }
  catch { return resolveLevel(); }
}

export function writeClickLevel(storage, id) {
  try { storage?.setItem(KEY, resolveLevel(id).id); }
  catch { /* Storage may be blocked or full; the current selection still works. */ }
}
