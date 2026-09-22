import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

// Food artwork failures used to fall back to the bowl glyph without a trace:
// a slug the icon route 404s, or a product photo that will not load, looked
// identical to "no icon chosen". Each distinct failure is reported once per
// page session — rows re-render every 15 s poll, and a broken slug on a
// favourite food would otherwise repeat forever.
const logger = createAppLogger('health').child('food-artwork');
const reported = new Set();

export function reportArtworkFailure(kind, key, data = {}) {
  const id = `${kind}:${key}`;
  if (!key || reported.has(id)) return;
  reported.add(id);
  logger.warn(`artwork.${kind}-failed`, { key, ...data });
}

/** Test seam: forget what has been reported. */
export function resetArtworkReports() { reported.clear(); }
