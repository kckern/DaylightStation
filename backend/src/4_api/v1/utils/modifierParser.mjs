/**
 * Parse URL path modifiers (playable, shuffle, recent_on_top) from a path string.
 *
 * Supports both slash-separated (/shuffle/playable) and comma-separated (shuffle,playable) formats.
 * Known modifiers are extracted; all other segments are preserved as the clean path.
 *
 * @param {string|undefined} rawPath - The raw path from URL (e.g., "folder/shuffle" or "folder/shuffle,playable")
 * @returns {{ modifiers: Object, localId: string }} Object with modifier flags and cleaned path
 */
export function parseModifiers(rawPath) {
  if (!rawPath) {
    return { modifiers: {}, localId: '' };
  }

  const parts = rawPath.split('/');
  const modifiers = {};
  const cleanParts = [];

  // Known modifiers that should be extracted from path
  const knownModifiers = ['playable', 'shuffle', 'recent_on_top'];

  for (const part of parts) {
    if (!part) {
      // Skip empty segments (from double slashes)
      continue;
    }

    if (knownModifiers.includes(part)) {
      // Direct modifier match
      modifiers[part] = true;
    } else if (part.includes(',')) {
      // Comma-separated modifiers (e.g., "shuffle,playable")
      const mods = part.split(',');
      let hasModifier = false;

      for (const mod of mods) {
        const trimmed = mod.trim();
        if (knownModifiers.includes(trimmed)) {
          modifiers[trimmed] = true;
          hasModifier = true;
        }
      }

      // If the comma-separated part contained only non-modifiers, treat as path
      if (!hasModifier) {
        cleanParts.push(part);
      }
    } else {
      // Regular path segment
      cleanParts.push(part);
    }
  }

  return { modifiers, localId: cleanParts.join('/') };
}

export default { parseModifiers };
