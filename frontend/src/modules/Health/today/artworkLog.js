import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { DaylightAPI } from '../../../lib/api.mjs';

// Food artwork failures used to fall back to the bowl glyph without a trace:
// a slug the icon route 404s, or a product photo that will not load, looked
// identical to "no icon chosen". Each distinct failure is reported once per
// page session — rows re-render every 15 s poll, and a broken slug on a
// favourite food would otherwise repeat forever.
//
// Reported twice over: a warn log (as before), and a POST to the artwork
// remediation queue, which finds the food the nearest real icon or its product
// photo and keeps retrying until it is fixed.
const logger = createAppLogger('health').child('food-artwork');
const reported = new Set();

export const artworkFailuresPath = 'api/v1/health/nutrition/artwork-failures';
const QUEUE_KINDS = { icon: 'icon-failed', photo: 'photo-failed' };
const text = value => (typeof value === 'string' && value ? value.slice(0, 300) : null);

export function reportArtworkFailure(kind, key, data = {}) {
  const id = `${kind}:${key}`;
  if (!key || reported.has(id)) return;
  reported.add(id);
  logger.warn(`artwork.${kind}-failed`, { key, ...data });
  const queueKind = QUEUE_KINDS[kind];
  if (!queueKind) return;
  // Fire-and-forget: a render path must never wait on, or throw from, this.
  try {
    Promise.resolve(DaylightAPI(artworkFailuresPath, { kind: queueKind, key: String(key).slice(0, 200),
      uuid: text(data.uuid), name: text(data.name), icon: text(data.icon) }, 'POST'))
      .catch(error => logger.warn('artwork.queue.report-failed', { kind: queueKind, key, error: error?.message }));
  } catch (error) {
    logger.warn('artwork.queue.report-failed', { kind: queueKind, key, error: error?.message });
  }
}

/** Test seam: forget what has been reported. */
export function resetArtworkReports() { reported.clear(); }
