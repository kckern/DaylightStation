/**
 * FlexAllocator
 *
 * Pure, stateless flex-distribution algorithm modeled after CSS flexbox.
 * Runs identically at both nesting levels (batch → tier, tier → source).
 *
 * @module applications/feed/services
 */

const MAX_ITERATIONS = 10;

export class FlexAllocator {
  /**
   * @param {number} containerSize
   * @param {Array<{key: string, grow: number, shrink: number, basis: number|'auto', min: number, max: number, available: number}>} children
   * @returns {Map<string, number>}
   */
  static distribute(containerSize, children) {
    if (!children.length) return new Map();

    const items = children.map(c => ({
      key: c.key,
      grow: c.grow,
      shrink: c.shrink,
      basis: FlexAllocator.#resolveBasis(c.basis, c.available, containerSize),
      min: c.min,
      max: Math.min(c.max === Infinity ? containerSize : c.max, c.available),
      available: c.available,
      frozen: c.available === 0,
      size: 0,
    }));

    for (const item of items) {
      if (item.frozen) item.size = 0;
    }

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const unfrozen = items.filter(i => !i.frozen);
      if (!unfrozen.length) break;

      const frozenSum = items.filter(i => i.frozen).reduce((s, i) => s + i.size, 0);
      const availableSpace = containerSize - frozenSum;
      const basisSum = unfrozen.reduce((s, i) => s + i.basis, 0);
      const delta = availableSpace - basisSum;

      for (const item of unfrozen) {
        item.size = item.basis;
      }

      if (delta > 0) {
        const totalGrow = unfrozen.reduce((s, i) => s + i.grow, 0);
        if (totalGrow > 0) {
          for (const item of unfrozen) {
            item.size = item.basis + (delta * item.grow / totalGrow);
          }
        }
      } else if (delta < 0) {
        const weightedTotal = unfrozen.reduce((s, i) => s + i.shrink * i.basis, 0);
        if (weightedTotal > 0) {
          for (const item of unfrozen) {
            const reduction = (-delta) * (item.shrink * item.basis) / weightedTotal;
            item.size = item.basis - reduction;
          }
        }
      }

      let anyFrozen = false;
      for (const item of unfrozen) {
        const clamped = Math.max(item.min, Math.min(item.max, item.size));
        if (Math.abs(clamped - item.size) > 0.001) {
          item.size = clamped;
          item.frozen = true;
          anyFrozen = true;
        }
      }

      if (!anyFrozen) break;
    }

    // Implicit floor: available > 0 → at least 1
    for (const item of items) {
      if (item.available > 0 && item.size < 1) {
        item.size = 1;
      }
    }

    return FlexAllocator.#roundToIntegers(items, containerSize);
  }

  static #resolveBasis(basis, available, containerSize) {
    if (basis === 'auto') return Math.min(available, containerSize);
    if (typeof basis === 'number') return basis * containerSize;
    return 0;
  }

  static #roundToIntegers(items, containerSize) {
    const entries = items.map(item => ({
      key: item.key,
      floored: Math.max(0, Math.floor(item.size)),
      remainder: Math.max(0, item.size - Math.floor(item.size)),
      grow: item.grow,
    }));

    let total = entries.reduce((s, e) => s + e.floored, 0);
    let toDistribute = Math.max(0, containerSize - total);

    if (toDistribute > 0) {
      const sorted = [...entries]
        .sort((a, b) => b.grow - a.grow || b.remainder - a.remainder);
      for (const entry of sorted) {
        if (toDistribute <= 0) break;
        entry.floored += 1;
        toDistribute -= 1;
      }
    }

    const result = new Map();
    for (const entry of entries) {
      result.set(entry.key, entry.floored);
    }
    return result;
  }
}
