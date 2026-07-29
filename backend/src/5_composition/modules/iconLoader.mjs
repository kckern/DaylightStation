/**
 * Resolve a config `icon:` name to SVG markup.
 *
 * Lives in composition, not rendering, for one reason: `1_rendering/` must not
 * touch the filesystem. Loading here keeps every renderer a pure function of its
 * inputs and testable without a disk.
 *
 * Icons are read once and cached for the process. A sheet repeats the same handful
 * across dozens of cells, and the files never change under a running backend.
 *
 * @module composition/modules/iconLoader
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {object} deps
 * @param {string} deps.dir Root the `icon:` names are relative to.
 * @param {object} [deps.logger]
 * @returns {(name: string) => (string|null)} SVG markup, or null when unresolvable.
 */
export function createIconLoader({ dir, logger = console }) {
  const cache = new Map();
  const warned = new Set();

  return function loadIcon(name) {
    if (!name) return null;
    if (cache.has(name)) return cache.get(name);

    // Contain the lookup to `dir`. `icon:` comes from config, which is trusted, but
    // a traversing name would still be a confusing way to read an arbitrary file and
    // there is no case where one is legitimate.
    const rel = `${name}.svg`;
    const file = path.resolve(dir, rel);
    if (!file.startsWith(path.resolve(dir) + path.sep)) {
      logger.warn?.('sheet.icon.rejected', { name, reason: 'escapes icon dir' });
      cache.set(name, null);
      return null;
    }

    let svg = null;
    try {
      svg = fs.readFileSync(file, 'utf8');
    } catch {
      // Warn once per name. Decoration missing is not worth a line per cell, but it
      // must not be silent either — a sheet quietly losing every icon should be
      // visible in the log, not just on the paper.
      if (!warned.has(name)) {
        warned.add(name);
        logger.warn?.('sheet.icon.missing', { name, file });
      }
    }
    cache.set(name, svg);
    return svg;
  };
}
