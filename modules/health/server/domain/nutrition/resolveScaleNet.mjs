import { computeNet } from "./index.mjs";

/**
 * Resolve a scanned container id against the table and apply its tare.
 *
 * SINGLE SOURCE for the scale path's net weight: both the prompt the user reads
 * and the grams that get persisted derive from one call to this, so they cannot
 * disagree. They used to — the prompt rendered `gross - tare` while the log kept
 * the gross, so a 420 g mug of soup on a 350 g tare printed "= 70 g net" and then
 * billed 588 kcal instead of 98.
 *
 * The arithmetic itself is the domain's (`computeNet`), which clamps a negative
 * net to 0 and refuses non-finite input.
 *
 * A tare that would leave nothing behind is REFUSED, not applied: `FoodItem`
 * requires `grams > 0`, so computeNet's clamp-to-0 is unstorable, and a 0 g entry
 * would in any case be the "silent 0 kcal" the domain exists to prevent. Refusing
 * keeps the gross on the record and surfaces a warning in the prompt, which is
 * exactly what the button path (`SelectScaleContainer`) has always done for
 * `tare >= gross`. Both paths now express that rule once, here.
 *
 * `computeNet` THROWS on a malformed container row (a `grams` that is not a
 * finite number — reachable when a raw, un-normalized config is injected). It is
 * caught here rather than allowed to escape, and the failure degrades to the
 * UNTARED weight: the entry is still worth recording, and because the prompt
 * reads the same `error` flag the user sees the tare was not applied. Letting it
 * throw would take down the relay call for a config typo.
 *
 * @param {{ gross: number, composition?: object }} args
 * @param {{ items?: Array<{id:string,label?:string,emoji?:string,grams:number}> }} [containers]
 * @returns {{net:number, gross:number, container:object|null, tared:boolean,
 *            refused:boolean, unknownId:string|null, error:Error|null}}
 */
export function resolveScaleNet({ gross, composition = {} }, containers = { items: [] }) {
  const base = { net: gross, gross, container: null, tared: false, refused: false, unknownId: null, error: null };

  const containerId = composition?.container;
  if (!containerId || containerId === 'none') return base;

  const item = (containers?.items || []).find((c) => c.id === containerId);
  if (!item) return { ...base, unknownId: containerId };

  let result;
  try {
    result = computeNet(gross, item);
  } catch (error) {
    return { ...base, container: item, error };
  }

  // `clamped` is computeNet's negative-net flag; `netG <= 0` also covers a tare
  // exactly equal to the gross. Either way there is no food to log.
  if (result.clamped || result.netG <= 0) {
    return { ...base, container: item, refused: true };
  }
  return { ...base, net: result.netG, container: item, tared: result.tared };
}
