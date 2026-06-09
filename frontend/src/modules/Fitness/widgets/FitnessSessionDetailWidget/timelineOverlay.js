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

/**
 * Challenge markers as duration spans. Each marker carries x..xEnd (width) from the
 * event's start/end, plus type/zoneId so the renderer can tint by challenge type
 * (cycle) or HR zone (warm/hot). An unfinished challenge (`end` null/absent) extends
 * to the axis end so it reads as "still running at session end" rather than a sliver.
 */
export function computeChallengeMarkers(events, opts) {
  if (!Array.isArray(events) || !Number.isFinite(opts?.sessionStartMs)) return [];
  // Absolute ms at the right edge of the compressed axis (last tick).
  const axisEndMs = opts.sessionStartMs + Math.max(0, (opts.effectiveTicks - 1)) * opts.intervalMs;
  return events
    .filter((e) => e?.type === 'challenge' && Number.isFinite(e.data?.start))
    .map((e) => {
      const startMs = e.data.start;
      const endMs = Number.isFinite(e.data.end) ? e.data.end : axisEndMs;
      const x = clampX(msToTickX(startMs - opts.sessionStartMs, opts), opts);
      const xEnd = clampX(msToTickX(Math.max(endMs, startMs) - opts.sessionStartMs, opts), opts);
      return {
        x,
        xEnd,
        width: Math.max(0, xEnd - x),
        type: resolveChallengeMarkerType(e),
        zoneId: e.data.zoneId ?? null,
        result: e.data.result || null,
        label: e.data.zoneLabel || e.data.title || null,
        requiredCount: Number.isFinite(e.data.requiredCount) ? e.data.requiredCount : null
      };
    });
}

/**
 * Resolve 1-D badge positions so fixed-size badges never overlap.
 * Greedy left-to-right pass enforces minGap; if the last badge spills past
 * `max`, a right-to-left pass walks the cluster back; a final left clamp
 * re-spreads forward. Input must be ascending. Pure; returns a new array.
 */
export function resolveBadgeXs(desired, { minGap, min, max }) {
  const xs = [...desired];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] < xs[i - 1] + minGap) xs[i] = xs[i - 1] + minGap;
  }
  if (xs.length && xs[xs.length - 1] > max) {
    xs[xs.length - 1] = max;
    for (let i = xs.length - 2; i >= 0; i--) {
      if (xs[i] > xs[i + 1] - minGap) xs[i] = xs[i + 1] - minGap;
    }
  }
  if (xs.length && xs[0] < min) {
    xs[0] = min;
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] < xs[i - 1] + minGap) xs[i] = xs[i - 1] + minGap;
    }
  }
  return xs;
}

/**
 * Decorate challenge markers with a collision-free `badgeX` (anchored at each
 * marker's xEnd). Sorts by xEnd internally but preserves the input order and
 * does not mutate the input.
 */
export function withBadgeXs(markers, opts) {
  const order = markers.map((_, i) => i).sort((a, b) => markers[a].xEnd - markers[b].xEnd);
  const resolved = resolveBadgeXs(order.map((i) => markers[i].xEnd), opts);
  const out = markers.map((m) => ({ ...m }));
  order.forEach((mi, k) => { out[mi].badgeX = resolved[k]; });
  return out;
}
