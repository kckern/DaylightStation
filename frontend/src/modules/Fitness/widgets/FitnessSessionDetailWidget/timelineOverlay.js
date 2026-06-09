// Pure geometry helpers for overlaying race bands + seams on the tick-based timeline axis.
import { mediaDisplayUrl } from './sessionDetailUtils.js';
import { resolveChallengeMarkerType } from '@/modules/Fitness/lib/activities/challengeTypeRegistry.js';

export function msToTickX(ms, { intervalMs, effectiveTicks, plotWidth, marginLeft = 0 }) {
  if (!(effectiveTicks > 1)) return marginLeft;
  const tick = intervalMs > 0 ? ms / intervalMs : 0;
  return marginLeft + (tick / (effectiveTicks - 1)) * plotWidth;
}

function clampX(x, { marginLeft = 0, plotWidth }) {
  return Math.min(marginLeft + plotWidth, Math.max(marginLeft, x));
}

export function computeRaceBands(activities, opts) {
  if (!Array.isArray(activities) || !activities.length) return [];
  const bands = [];
  for (const act of activities) {
    for (const it of act.items || []) {
      if (!Number.isFinite(it.axisStartMs) || !Number.isFinite(it.axisEndMs)) continue;
      const x = clampX(msToTickX(it.axisStartMs, opts), opts);
      const xEnd = clampX(msToTickX(it.axisEndMs, opts), opts);
      bands.push({ x, width: Math.max(0, xEnd - x), winnerId: it.meta?.winnerId ?? null, raceId: it.meta?.raceId ?? null });
    }
  }
  return bands;
}

export function computeSeamLines(seams, opts) {
  if (!Array.isArray(seams) || !seams.length) return [];
  return seams.map((s) => ({ x: clampX(msToTickX(s.atMs, opts), opts), gapMs: s.gapMs }));
}

const isVideoMedia = (evt) => {
  const d = evt?.data || {};
  return evt?.type === 'media' && d.contentType !== 'track' && !d.artist;
};

/**
 * Video-change markers. The first video (the opening slot — warm-up OR hero)
 * gets no flag; videos 2..N are marked at their start. Event `start` is absolute
 * epoch ms, rebased onto the tick axis via opts.sessionStartMs.
 */
export function computeVideoMarkers(events, opts) {
  if (!Array.isArray(events) || !Number.isFinite(opts?.sessionStartMs)) return [];
  const videos = events
    .filter(isVideoMedia)
    .filter((e) => Number.isFinite(e.data?.start))
    .sort((a, b) => a.data.start - b.data.start);
  return videos.slice(1).map((e) => {
    const offsetMs = e.data.start - opts.sessionStartMs;
    return {
      x: clampX(msToTickX(offsetMs, opts), opts),
      episodeName: e.data.title || null,
      posterUrl: mediaDisplayUrl(e.data.grandparentId),
      thumbUrl: mediaDisplayUrl(e.data.contentId)
    };
  });
}

/** Challenge markers (dotted). Type resolved via the registry classifier. */
export function computeChallengeMarkers(events, opts) {
  if (!Array.isArray(events) || !Number.isFinite(opts?.sessionStartMs)) return [];
  return events
    .filter((e) => e?.type === 'challenge' && Number.isFinite(e.data?.start))
    .map((e) => ({
      x: clampX(msToTickX(e.data.start - opts.sessionStartMs, opts), opts),
      type: resolveChallengeMarkerType(e),
      result: e.data.result || null,
      label: e.data.zoneLabel || e.data.title || null,
      requiredCount: Number.isFinite(e.data.requiredCount) ? e.data.requiredCount : null
    }));
}
