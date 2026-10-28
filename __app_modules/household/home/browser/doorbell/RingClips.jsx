import { useEffect, useMemo, useState } from 'react';
import { Button } from '@mantine/core';
import { Skeleton, ErrorState } from '@/lib/ui';
import { matchRingToClip } from './matchRingToClip.js';
import { useRingClips } from './useRingClips.js';
import homeLogger from '../homeLogger.js';
import './RingClips.scss';

const logger = homeLogger.child({ component: 'ring-clips' });

const TOLERANCE_MS = 120_000;
// Each player fetches its clip's first frame from the camera; past the
// newest few, a ring offers its clip on request instead.
const EAGER_PLAYERS = 4;

const dayFormat = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The local days a set of rings (and a clip just across midnight) could be filed under. */
export function ringDays(marks, timeZone) {
  const fmt = dayFormat(timeZone);
  const days = new Set();
  for (const t of marks) for (const at of [t - TOLERANCE_MS, t, t + TOLERANCE_MS]) days.add(fmt.format(new Date(at)));
  return [...days].sort();
}

export const clipFileUrl = (camera, name) => (
  `/api/v1/camera/${encodeURIComponent(camera)}/clips/file?name=${encodeURIComponent(name)}#t=0.1`
);

function ringLabel(t, timeZone, withDay) {
  const opts = { timeZone, hour: 'numeric', minute: '2-digit' };
  if (withDay) opts.weekday = 'short';
  return new Date(t).toLocaleString(undefined, opts).replace(/\s?(AM|PM)$/i, (m) => m.toLowerCase());
}

function RingClip({ camera, clip, ringMs, eager }) {
  const [shown, setShown] = useState(eager);
  if (!shown) {
    return <Button size="xs" variant="light" onClick={() => setShown(true)}>Show clip</Button>;
  }
  return (
    <video
      className="home-rings__video"
      preload="metadata"
      controls
      playsInline
      src={clipFileUrl(camera, clip.name)}
      onPlay={() => logger.info('home.ring.play', { camera, ringMs, clip: clip.name })}
    />
  );
}

/**
 * The rings in a range, newest first: when each was, and the camera's clip
 * of it (its first frame stands in for a snapshot) — or, when the camera
 * kept nothing near that moment, a plain line saying so.
 */
export function RingClips({ camera, marks, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }) {
  const rings = useMemo(() => [...new Set(marks || [])].sort((a, b) => b - a), [marks]);
  const days = useMemo(() => ringDays(rings, timeZone), [rings, timeZone]);
  const { clips, loading, error, reload } = useRingClips(camera, days);
  const withDay = useMemo(() => new Set(rings.map((t) => dayFormat(timeZone).format(new Date(t)))).size > 1, [rings, timeZone]);

  useEffect(() => {
    logger.debug('home.ring.list', { camera, rings: rings.length, days: days.length });
  }, [camera, rings.length, days.length]);

  let body;
  if (!rings.length) body = <p className="home-rings__empty">No rings in this range</p>;
  else if (error) body = <ErrorState error={error} onRetry={reload} label="Clips" />;
  else if (loading) body = <Skeleton height={120} radius="sm" />;
  else {
    let players = 0;
    body = (
      <ol className="home-rings__list">
        {rings.map((t) => {
          const clip = matchRingToClip(t, clips, { toleranceMs: TOLERANCE_MS });
          const eager = clip ? players++ < EAGER_PLAYERS : false;
          return (
            <li key={t} className="home-rings__ring">
              <time className="home-rings__time" dateTime={new Date(t).toISOString()}>{ringLabel(t, timeZone, withDay)}</time>
              {clip
                ? <RingClip camera={camera} clip={clip} ringMs={t} eager={eager} />
                : <p className="home-rings__none">No recording near this ring</p>}
            </li>
          );
        })}
      </ol>
    );
  }
  return (
    <section className="home-rings" aria-label="Rings">
      <h4 className="home-rings__title">Rings</h4>
      {body}
    </section>
  );
}

export default RingClips;
