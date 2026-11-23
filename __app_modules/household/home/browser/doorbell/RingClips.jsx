import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, UnstyledButton } from '@mantine/core';
import { IconPlayerPlayFilled } from '@tabler/icons-react';
import { Skeleton, useRetryRegion } from '@/lib/ui';
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
  const sourceUrl = clipFileUrl(camera, clip.name);
  const [shown, setShown] = useState(eager);
  const [attempt, setAttempt] = useState(0);
  const [playerState, setPlayerState] = useState(() => ({ source: sourceUrl, failed: false, started: false }));
  const failed = playerState.source === sourceUrl && playerState.failed;
  const started = playerState.source === sourceUrl && playerState.started;
  const video = useRef(null);
  const playButton = useRef(null);
  const retryButton = useRef(null);
  const focusPlayAfterReveal = useRef(false);
  const focusRetryAfterFailure = useRef(false);
  if (playerState.source !== sourceUrl) {
    const ownerDocument = video.current?.ownerDocument
      ?? retryButton.current?.ownerDocument
      ?? playButton.current?.ownerDocument;
    const activeElement = ownerDocument?.activeElement;
    if (activeElement === retryButton.current
      || activeElement === playButton.current
      || activeElement === video.current) {
      focusPlayAfterReveal.current = true;
    }
    setPlayerState({ source: sourceUrl, failed: false, started: false });
  }
  useLayoutEffect(() => {
    if (focusRetryAfterFailure.current && failed) {
      focusRetryAfterFailure.current = false;
      retryButton.current?.focus({ preventScroll: true });
      return;
    }
    if (!focusPlayAfterReveal.current || !shown || failed || started) return;
    focusPlayAfterReveal.current = false;
    playButton.current?.focus({ preventScroll: true });
  }, [shown, failed, started, attempt, sourceUrl]);
  useEffect(() => {
    if (started) video.current?.focus({ preventScroll: true });
  }, [started]);
  if (!shown) {
    return <Button size="xs" variant="light" aria-label={`Show clip of the ${label} ring`} onClick={(event) => {
      focusPlayAfterReveal.current = event.currentTarget.ownerDocument.activeElement === event.currentTarget;
      setShown(true);
    }}>Show clip</Button>;
  }
  if (failed) {
    return (
      <p className="home-rings__failed" role="alert">
        <span>Recording could not be loaded</span>
        <Button
          ref={retryButton}
          size="compact-xs"
          variant="subtle"
          aria-label={`Retry recording from the ${label} ring`}
          onClick={(event) => {
            focusPlayAfterReveal.current = event.currentTarget.ownerDocument.activeElement === event.currentTarget;
            logger.info('home.ring.clip.retry', { camera, ringMs, clip: clip.name, attempt: attempt + 1 });
            setPlayerState(current => current.source === sourceUrl
              ? { ...current, failed: false, started: false }
              : current);
            setAttempt((n) => n + 1);
          }}
        >
          Retry
        </Button>
      </p>
    );
  }
  const play = () => {
    setPlayerState(current => current.source === sourceUrl ? { ...current, started: true } : current);
    try {
      video.current?.play?.()?.catch?.(() => { /* the native controls are there now */ });
    } catch { /* no media support (tests): the controls still appear */ }
  };
  return (
    <div className="home-rings__player">
      <video
        key={`${sourceUrl}:${attempt}`}
        ref={video}
        className="home-rings__video"
        preload="metadata"
        controls={started}
        tabIndex={started ? 0 : -1}
        playsInline
        aria-label={`Recording from the ${label} ring`}
        src={sourceUrl}
        onPlay={() => logger.info('home.ring.play', { camera, ringMs, clip: clip.name })}
        onError={(e) => {
          logger.warn('home.ring.clip.failed', { camera, ringMs, clip: clip.name, attempt, code: e.currentTarget?.error?.code ?? null });
          const activeElement = e.currentTarget.ownerDocument.activeElement;
          focusRetryAfterFailure.current = activeElement === playButton.current || activeElement === e.currentTarget;
          setPlayerState(current => current.source === sourceUrl ? { ...current, failed: true } : current);
        }}
      />
      {started ? null : (
        <UnstyledButton ref={playButton} className="home-rings__play" onClick={play} aria-label={`Play the clip of the ${label} ring`}>
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
  const { clips, failedDays, loading, error, reload } = useRingClips(camera, days);
  const { regionProps, retry } = useRetryRegion(reload, loading);
  const withDay = useMemo(() => new Set(rings.map((t) => dayFormat(timeZone).format(new Date(t)))).size > 1, [rings, timeZone]);
  const previousRingScope = useRef(null);

  useEffect(() => {
    logger.debug('home.ring.list', { camera, rings: rings.length, days: days.length });
  }, [camera, rings.length, days.length]);

  useEffect(() => {
    const previous = previousRingScope.current;
    const dayList = days.join(',');
    previousRingScope.current = { camera, timeZone, dayList, rings };
    if (!previous || previous.camera !== camera || previous.timeZone !== timeZone) return;
    // useRingClips already starts a read when its day list changes.
    if (previous.dayList !== dayList) return;
    const knownRings = new Set(previous.rings);
    if (!rings.some((ring) => !knownRings.has(ring))) return;
    logger.info('home.ring.clips.refresh-new-rings', { camera, added: rings.filter((ring) => !knownRings.has(ring)).length });
    // A reload supersedes the hook's in-flight batch, so refresh every day in
    // this visit to avoid dropping another day's still-pending lookup.
    reload();
  }, [camera, rings, timeZone, reload]);

  let body;
  if (!rings.length) body = <p className="home-rings__empty">No rings in this range</p>;
  else if (loading && clips.length === 0) body = <Skeleton height={120} radius="sm" />;
  else {
    // A failed clip read still lists every ring with its time: the ring
    // happened whether or not the camera answered.
    let players = 0;
    body = (
      <>
        {error ? (
          <p className="home-rings__failed" role="alert">
            <span>Clips could not be loaded.</span>
            <Button size="compact-xs" variant="subtle" onClick={() => { logger.info('home.ring.clips.retry', { camera }); retry(); }}>Retry</Button>
          </p>
        ) : null}
        <ol className="home-rings__list">
          {rings.map((t) => {
            const clip = matchRingToClip(t, clips, { toleranceMs: TOLERANCE_MS });
            const unavailableDays = !clip && !error
              ? ringDays([t], timeZone).filter(day => failedDays.includes(day))
              : [];
            const eager = clip ? players++ < EAGER_PLAYERS : false;
            return (
              <li key={t} className="home-rings__ring">
                <time className="home-rings__time" dateTime={new Date(t).toISOString()}>{ringLabel(t, timeZone, withDay)}</time>
                {clip
                  ? <RingClip camera={camera} clip={clip} ringMs={t} eager={eager} label={ringLabel(t, timeZone, withDay)} />
                  : unavailableDays.length > 0 ? (
                    <p className="home-rings__failed" role="alert">
                      <span>Recording availability unknown</span>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        disabled={loading}
                        onClick={() => { logger.info('home.ring.clips.retry', { camera, days: unavailableDays }); reload(unavailableDays); }}
                      >
                        Retry unavailable day lookups
                      </Button>
                    </p>
                  ) : !error ? <p className="home-rings__none">No recording near this ring</p> : null}
              </li>
            );
          })}
        </ol>
      </>
    );
  }
  return (
    <section className="home-rings" aria-label="Rings" {...regionProps}>
      <h4 className="home-rings__title">Rings</h4>
      {body}
    </section>
  );
}

export default RingClips;
