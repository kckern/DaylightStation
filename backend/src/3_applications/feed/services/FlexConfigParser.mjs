// backend/src/3_applications/feed/services/FlexConfigParser.mjs
/**
 * FlexConfigParser
 *
 * Parses flex config nodes from YAML into normalized descriptors for FlexAllocator.
 * Supports: shorthand strings, explicit keys, named aliases, and legacy key migration.
 *
 * @module applications/feed/services
 */

const ALIASES = Object.freeze({
  filler:   { grow: 1, shrink: 1, basis: 0 },
  fixed:    { grow: 0, shrink: 0, basis: 'auto' },
  none:     { grow: 0, shrink: 0, basis: 'auto' },
  dominant: { grow: 2, shrink: 0, basis: 'auto' },
  padding:  { grow: 1, shrink: 0, basis: 0 },
  auto:     { grow: 1, shrink: 1, basis: 'auto' },
});

const DEFAULTS = Object.freeze({ grow: 0, shrink: 1, basis: 'auto', min: 0, max: Infinity });

export class FlexConfigParser {
  /**
   * Parse a config node into a normalized flex descriptor.
   *
   * Precedence (highest to lowest):
   * 1. Explicit keys (grow:, shrink:, basis:, min:, max:)
   * 2. flex: shorthand (string, number, or alias)
   * 3. Legacy keys (allocation, max_per_batch, min_per_batch, role, padding)
   * 4. Defaults
   *
   * @param {Object} node - Raw YAML config node
   * @param {number} parentSize - Parent container size (for normalizing integers to proportions)
   * @returns {{ grow: number, shrink: number, basis: number|'auto', min: number, max: number }}
   */
  static parseFlexNode(node, parentSize) {
    const legacy = FlexConfigParser.#parseLegacy(node, parentSize);
    const flexParsed = FlexConfigParser.#parseFlex(node.flex, parentSize);
    const explicit = FlexConfigParser.#parseExplicit(node, parentSize);

    return {
      grow:   explicit.grow   ?? flexParsed.grow   ?? legacy.grow   ?? DEFAULTS.grow,
      shrink: explicit.shrink ?? flexParsed.shrink ?? legacy.shrink ?? DEFAULTS.shrink,
      basis:  explicit.basis  ?? flexParsed.basis  ?? legacy.basis  ?? DEFAULTS.basis,
      min:    explicit.min    ?? flexParsed.min    ?? legacy.min    ?? DEFAULTS.min,
      max:    explicit.max    ?? flexParsed.max    ?? legacy.max    ?? DEFAULTS.max,
    };
  }

  static #parseFlex(flex, parentSize) {
    const result = { grow: undefined, shrink: undefined, basis: undefined, min: undefined, max: undefined };
    if (flex == null) return result;

    if (typeof flex === 'number') {
      result.grow = flex;
      result.shrink = 1;
      result.basis = 0;
      return result;
    }

    if (typeof flex !== 'string') return result;

    const alias = ALIASES[flex.trim().toLowerCase()];
    if (alias) {
      result.grow = alias.grow;
      result.shrink = alias.shrink;
      result.basis = alias.basis;
      return result;
    }

    const parts = flex.trim().split(/\s+/);
    if (parts.length >= 1) result.grow = Number(parts[0]);
    if (parts.length >= 2) result.shrink = Number(parts[1]);
    if (parts.length >= 3) {
      result.basis = parts[2] === 'auto' ? 'auto' : FlexConfigParser.#normalizeBasis(Number(parts[2]), parentSize);
    }

    return result;
  }

  static #parseExplicit(node, parentSize) {
    return {
      grow:   node.grow   !== undefined ? node.grow   : undefined,
      shrink: node.shrink !== undefined ? node.shrink : undefined,
      basis:  node.basis  !== undefined ? FlexConfigParser.#normalizeBasis(node.basis, parentSize) : undefined,
      min:    node.min    !== undefined ? node.min    : undefined,
      max:    node.max    !== undefined ? node.max    : undefined,
    };
  }

  static #parseLegacy(node, parentSize) {
    const result = { grow: undefined, shrink: undefined, basis: undefined, min: undefined, max: undefined };

    if (node.role === 'filler') {
      const alias = ALIASES.filler;
      result.grow = alias.grow;
      result.shrink = alias.shrink;
      result.basis = alias.basis;
    }

    if (node.padding === true) {
      const alias = ALIASES.padding;
      result.grow = alias.grow;
      result.shrink = alias.shrink;
      result.basis = alias.basis;
    }

    if (node.allocation !== undefined) {
      result.basis = FlexConfigParser.#normalizeBasis(node.allocation, parentSize);
    }

    if (node.max_per_batch !== undefined) result.max = node.max_per_batch;
    if (node.min_per_batch !== undefined) result.min = node.min_per_batch;

    return result;
  }

  static #normalizeBasis(value, parentSize) {
    if (value === 'auto') return 'auto';
    if (value === 0) return 0;
    if (typeof value === 'number' && value > 0 && value <= 1) return value;
    if (typeof value === 'number' && value > 1 && parentSize > 0) return value / parentSize;
    return value;
  }
}
