import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Where a countdown may be drawn over a game, and where it may not.
 *
 * An emulated console does not fill the television. It is framed by bezel
 * artwork — a Game Boy shell, a Super Famicom fascia — with the game itself
 * showing through a hole in the middle. The hole is a different size and in a
 * different place for every system: the Game Boy's chrome is thick and its
 * screen is small and square; the N64's is a thin pillar either side of an
 * almost-full-width picture.
 *
 * So "put the timer in the bottom third" is not a placement. On the Game Boy the
 * bottom third is moulded plastic, which is ideal; on the NES it is the game.
 * A placement has to be stated per system, and the only honest source for it is
 * the bezel art itself.
 *
 * Every rectangle here is `[x, y, w, h]` normalised to 0..1 of the output
 * surface, so it survives a change of resolution and means the same thing to a
 * web overlay as it does to a screenshot.
 *
 * The invariant that matters: a zone NEVER intersects the screen rect. That is
 * checked here rather than trusted, because the cost of getting it wrong is a
 * countdown sitting on top of the game a child is trying to play.
 */

const EPSILON = 1e-6;

function requireRect(value, field) {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new ValidationError(`${field} must be [x, y, w, h]`, {
      code: 'INVALID_RECT', field, value,
    });
  }
  const rect = value.map(Number);
  if (rect.some((n) => !Number.isFinite(n))) {
    throw new ValidationError(`${field} must contain four numbers`, {
      code: 'INVALID_RECT', field, value,
    });
  }
  const [x, y, w, h] = rect;
  if (w <= 0 || h <= 0) {
    throw new ValidationError(`${field} must have positive width and height`, {
      code: 'INVALID_RECT', field, value,
    });
  }
  if (x < -EPSILON || y < -EPSILON || x + w > 1 + EPSILON || y + h > 1 + EPSILON) {
    throw new ValidationError(`${field} must lie within the unit square`, {
      code: 'RECT_OUT_OF_BOUNDS', field, value,
    });
  }
  return Object.freeze(rect);
}

/** Do two normalised rects share any area? Touching edges do not count. */
export function intersects(a, b) {
  return a[0] + a[2] > b[0] + EPSILON
    && b[0] + b[2] > a[0] + EPSILON
    && a[1] + a[3] > b[1] + EPSILON
    && b[1] + b[3] > a[1] + EPSILON;
}

/** Is `inner` wholly inside `outer`? */
export function contains(outer, inner) {
  return inner[0] >= outer[0] - EPSILON
    && inner[1] >= outer[1] - EPSILON
    && inner[0] + inner[2] <= outer[0] + outer[2] + EPSILON
    && inner[1] + inner[3] <= outer[1] + outer[3] + EPSILON;
}

/**
 * Validate one system's bezel geometry as it comes out of configuration.
 *
 * Configuration is measured by a person from artwork, so it is exactly the kind
 * of input that drifts. A zone that has crept over the game screen, or a toast
 * that has escaped its own zone, is rejected here instead of being discovered
 * on the television.
 */
export function parseBezel(raw, { system = 'bezel' } = {}) {
  if (!raw) return null;
  const screen = requireRect(raw.screen, `${system}.screen`);
  const zones = [];
  for (const [i, zone] of (raw.zones || []).entries()) {
    const where = `${system}.zones[${i}]`;
    const box = requireRect(zone?.box, `${where}.box`);
    if (intersects(box, screen)) {
      throw new ValidationError(`${where} (${zone?.name}) overlaps the game screen`, {
        code: 'ZONE_OVER_SCREEN', field: where, box, screen,
      });
    }
    const toast = zone?.toast ? requireRect(zone.toast, `${where}.toast`) : box;
    if (!contains(box, toast)) {
      throw new ValidationError(`${where}.toast escapes its own zone`, {
        code: 'TOAST_OUTSIDE_ZONE', field: where, box, toast,
      });
    }
    zones.push(Object.freeze({
      name: zone?.name ?? `zone-${i}`,
      box,
      toast,
      orientation: zone?.orientation === 'stacked' ? 'stacked' : 'wide',
    }));
  }
  return Object.freeze({ source: raw.source ?? null, screen, zones: Object.freeze(zones) });
}

/**
 * Pick where to draw, given a system's bezel.
 *
 * Zones arrive ordered quietest-artwork-first, so the default is simply the
 * first one. `prefer` lets a caller ask for a named zone and falls back rather
 * than failing — a preference is a preference, not a requirement.
 *
 * Returns null when the system has no room at all, which is a real answer: some
 * bezels are edge-to-edge and there is nowhere to put a countdown that is not
 * on top of the game. A caller that gets null should speak, not draw.
 */
export function choosePlacement(bezel, { prefer = null } = {}) {
  if (!bezel?.zones?.length) return null;
  const chosen = (prefer && bezel.zones.find((z) => z.name === prefer)) || bezel.zones[0];
  return Object.freeze({
    zone: chosen.name,
    box: chosen.box,
    toast: chosen.toast,
    orientation: chosen.orientation,
    screen: bezel.screen,
  });
}

export default { parseBezel, choosePlacement, intersects, contains };
