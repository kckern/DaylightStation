// surroundHostModules.js — module-list derivation for SurroundHost.jsx's
// mount log, split out so Fast Refresh can hot-reload the host on its own.

/**
 * The slots a definition can fill, in the order the frame lays them out.
 *
 * IT IS THE SLOTS THE FRAME RENDERS, and it has to stay that way: naming a slot
 * here that `SurroundFrame` does not lay out would put a module in this event
 * that never mounts — a smaller version of the exact lie this helper was written
 * to end. (`overlay` was dropped when the inert overlay layer was deleted.)
 */
const REGION_SLOTS = Object.freeze(['top', 'right', 'bottom']);

/**
 * Every module the shipped definition actually mounts, in layout order.
 *
 * THE MOUNT LOG USED TO LIE. It read `regions.right?.module` — a single object —
 * and `right` has been a LIST since the rail gained its carousel, so the rail's
 * modules vanished from the event; `top` was never included at all. For six
 * waves `surround.mount` reported the band and nothing else, and nobody noticed
 * because logs are read when something breaks and this one only ever ran when
 * things worked. Both shapes are legal in a definition (`SurroundFrame`'s own
 * `normalizeRegions` accepts either), so this reads them the same way the frame
 * does rather than the way one slot happened to be authored.
 */
export function definitionModules(definition) {
  const regions = definition?.regions;
  if (!regions || typeof regions !== 'object') return [];
  return REGION_SLOTS.flatMap((slot) => {
    const value = regions[slot];
    if (!value) return [];
    return (Array.isArray(value) ? value : [value])
      .map((r) => (r && typeof r === 'object' ? r.module : null))
      .filter((m) => typeof m === 'string' && m);
  });
}
