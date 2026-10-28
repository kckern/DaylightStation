import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, UnstyledButton } from '@mantine/core';
import { IconPlayerPlayFilled } from '@tabler/icons-react';
import { Skeleton } from '@/lib/ui';
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

/**
 * One ring's clip. Until tapped it is a picture — the clip's first frame,
 * no native controls, one play button over it; the controls appear once it
 * plays. A clip the camera cannot serve says so and offers a retry, which
 * mounts a fresh player rather than leaving a broken one on screen.
 */
function RingClip({ camera, clip, ringMs, eager, label }) {
  const [shown, setShown] = useState(eager);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const video = useRef(null);
  if (!shown) {
    return <Button size="xs" variant="light" onClick={() => setShown(true)}>Show clip</Button>;
  }
  if (failed) {
    return (
      <p className="home-rings__failed" role="alert">
        <span>Recording could not be loaded</span>
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() => {
            logger.info('home.ring.clip.retry', { camera, ringMs, clip: clip.name, attempt: attempt + 1 });
            setFailed(false);
            setStarted(false);
            setAttempt((n) => n + 1);
          }}
        >
          Retry
        </Button>
      </p>
    );
  }
  const play = () => {
    setStarted(true);
    try {
      video.current?.play?.()?.catch?.(() => { /* the native controls are there now */ });
    } catch { /* no media support (tests): the controls still appear */ }
  };
  return (
    <div className="home-rings__player">
      <video
        key={attempt}
        ref={video}
        className="home-rings__video"
        preload="metadata"
        controls={started}
        playsInline
        src={clipFileUrl(camera, clip.name)}
        onPlay={() => logger.info('home.ring.play', { camera, ringMs, clip: clip.name })}
        onError={(e) => {
          logger.warn('home.ring.clip.failed', { camera, ringMs, clip: clip.name, attempt, code: e.currentTarget?.error?.code ?? null });
          setFailed(true);
        }}
      />
      {started ? null : (
        <UnstyledButton className="home-rings__play" onClick={play} aria-label={`Play the clip of the ${label} ring`}>
          <IconPlayerPlayFilled className="home-rings__play-icon" aria-hidden="true" focusable="false" />
        </UnstyledButton>
      )}
    </div>
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
  else if (loading) body = <Skeleton height={120} radius="sm" />;
  else {
    // A failed clip read still lists every ring with its time: the ring
    // happened whether or not the camera answered.
    let players = 0;
    body = (
      <>
        {error ? (
          <p className="home-rings__failed" role="alert">
            <span>Clips could not be loaded.</span>
            <Button size="compact-xs" variant="subtle" onClick={() => { logger.info('home.ring.clips.retry', { camera }); reload(); }}>Retry</Button>
          </p>
        ) : null}
        <ol className="home-rings__list">
          {rings.map((t) => {
            const clip = error ? null : matchRingToClip(t, clips, { toleranceMs: TOLERANCE_MS });
            const eager = clip ? players++ < EAGER_PLAYERS : false;
            return (
              <li key={t} className="home-rings__ring">
                <time className="home-rings__time" dateTime={new Date(t).toISOString()}>{ringLabel(t, timeZone, withDay)}</time>
                {clip
                  ? <RingClip camera={camera} clip={clip} ringMs={t} eager={eager} label={ringLabel(t, timeZone, withDay)} />
                  : <p className="home-rings__none">No recording near this ring</p>}
              </li>
            );
          })}
        </ol>
      </>
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
