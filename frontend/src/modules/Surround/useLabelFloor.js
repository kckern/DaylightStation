// frontend/src/modules/Surround/useLabelFloor.js
//
// THE TEN-FOOT LABEL FLOOR, FOR THE MODULES THAT DRAW THEIR OWN TYPE.
//
// Most of the frame's labels are set in a stylesheet and read the floor as a
// custom property: `SurroundFrame` measures the screen root it fills and
// publishes `--label-floor`, and every rule takes `var(--label-floor, …)`. Two
// modules cannot do that, because their type is not laid out by CSS — the map
// and the era timeline PLACE their labels themselves, in SVG and in absolute
// percentages, and both have to know the size in JS before anything is drawn:
// the map to decide whether a neighbour's name will overlap its own border, the
// timeline to decide whether an era's name fits its band or has to be dropped.
// A size those two only discovered from `getComputedStyle` after paint would be
// a size their geometry was already solved without.
//
// So they read the same number through this hook, from the same function the
// frame publishes from (`labelFloorPx`), measured off the same element (the
// `.surround-frame` box). One floor, three consumers, one derivation.
//
// WHY IT IS THE ANCHOR UNTIL MEASURED, never the fleet's smallest: a module
// rendered outside a frame — a spec, a rail on its own — must get the number the
// office screen would give it. Falling back to the low clamp would silently draw
// living-room type on every surface that has no frame around it.

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { labelFloorPx, rootWidthOf, LABEL_FLOOR_ANCHOR_PX } from './fit.js';

/**
 * The label floor in px for the root the given element is painted in.
 *
 * @param {{current: Element|null}} ref an element inside the frame — its own
 *   root is fine; the frame is found with `closest`.
 * @returns {number} px, re-read whenever the frame's own box changes size.
 */
export function useLabelFloorPx(ref) {
  const [floorPx, setFloorPx] = useState(LABEL_FLOOR_ANCHOR_PX);

  const read = useCallback(() => {
    const el = ref?.current;
    if (!el) return;
    // An unmeasurable root resolves to the anchor inside `labelFloorPx`, so a
    // tree that has not been laid out cannot pin this at the fleet's smallest.
    setFloorPx(labelFloorPx(rootWidthOf(el)));
  }, [ref]);

  // LAYOUT EFFECT, so the floor is known before the browser paints: these two
  // modules draw geometry from it, and a first frame drawn at the anchor and a
  // second at the root's floor is a visible jump in a label's position, not just
  // in its size.
  //
  // NO DEPENDENCY ARRAY, DELIBERATELY. Both consumers return `null` before their
  // data arrives, so on the render that matters the ref is still empty — a
  // once-at-mount read would measure nothing and leave the anchor in place for
  // the life of the slide, which is the bug this comment exists to prevent. The
  // cost is one `getBoundingClientRect` per render of two modules that render on
  // data changes and resizes only, and `setFloorPx` bails on an unchanged value,
  // so a stable frame settles after one pass.
   
  useLayoutEffect(read);

  useEffect(() => {
    const el = ref?.current;
    const frame = el?.closest?.('.surround-frame');
    if (!frame || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [ref, read]);

  return floorPx;
}

export default useLabelFloorPx;
