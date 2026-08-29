import { readTextFromPath } from '#system/utils/FileIO.mjs';
import path from 'node:path';

export function createIconLoader({ dir, logger = console }) {
  const cache = new Map();
  const warned = new Set();
  return function loadIcon(name) {
    if (!name) return null;
    if (cache.has(name)) return cache.get(name);
    const file = path.resolve(dir, `${name}.svg`);
    if (!file.startsWith(path.resolve(dir) + path.sep)) {
      logger.warn?.('sheet.icon.rejected', { name, reason: 'escapes icon dir' });
      cache.set(name, null);
      return null;
    }
    let svg = null;
    try {
      svg = readTextFromPath(file);
    } catch {
      if (!warned.has(name)) {
        warned.add(name);
        logger.warn?.('sheet.icon.missing', { name, file });
      }
    }
    cache.set(name, svg);
    return svg;
  };
}
