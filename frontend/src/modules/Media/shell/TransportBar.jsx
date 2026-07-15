// frontend/src/modules/Media/shell/TransportBar.jsx
// Transport controls bound to any session controller — used by Now Playing
// (local). Two rows: primary (prev · rew 10s · play/pause · ffw 10s · next)
// and secondary (shuffle · repeat · speed · volume · stop). Prev/next disable
// when the queue has no neighbor to move to. Playback speed has NO
// controller/session pathway (LocalSessionController config exposes only
// shuffle/repeat/shader/volume), so it drives the media element handed in by
// the host view (`mediaEl`) — and is hidden entirely when no element exists,
// never a dead button.
import React, { useEffect, useRef, useState } from 'react';
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconPlayerStopFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconRewindBackward10,
  IconRewindForward10,
  IconArrowsShuffle,
  IconRepeat,
  IconRepeatOnce,
  IconVolume,
} from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';
import { playbackRateLabel } from './stateCopy.js';
import './NowPlaying.scss';

const PLAYING_STATES = new Set(['playing', 'buffering']);
const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };
const REPEAT_LABEL = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };
const SKIP_STEP_S = 10;
// 1× → 1.25× → 1.5× → 2× → 0.75× → 1×
const RATE_CYCLE = [1, 1.25, 1.5, 2, 0.75];

function nextRate(rate) {
  const idx = RATE_CYCLE.indexOf(rate);
  return RATE_CYCLE[(idx + 1) % RATE_CYCLE.length] ?? 1;
}

/** Speed chip driving the media element directly (no session pathway). */
function RateControl({ mediaEl }) {
  const [rate, setRate] = useState(1);
  const chosenRef = useRef(null);

  // When the element (re)appears: re-assert the user's chosen rate on the new
  // element (item changes remount the media element at rate 1), or adopt the
  // element's current rate when the user hasn't touched the control.
  useEffect(() => {
    if (!mediaEl) return;
    if (chosenRef.current != null) {
      try { mediaEl.playbackRate = chosenRef.current; } catch { /* ignore */ }
      setRate(chosenRef.current);
    } else {
      const r = Number(mediaEl.playbackRate);
      if (Number.isFinite(r) && r > 0) setRate(r);
    }
  }, [mediaEl]);

  const cycle = () => {
    const next = nextRate(rate);
    chosenRef.current = next;
    try { mediaEl.playbackRate = next; } catch { /* ignore */ }
    setRate(next);
  };

  return (
    <button
      type="button"
      data-testid="np-rate"
      className={`np-rate-btn ${rate !== 1 ? 'np-rate-btn--engaged' : ''}`}
      aria-label={`Playback speed: ${playbackRateLabel(rate)}`}
      onClick={cycle}
    >
      {playbackRateLabel(rate)}
    </button>
  );
}

export function TransportBar({ target, mediaEl = null }) {
  const { snapshot, transport, config } = useSessionController(target);
  if (!snapshot?.currentItem) return null;

  const isPlaying = PLAYING_STATES.has(snapshot.state);
  const shuffle = !!snapshot.config?.shuffle;
  const repeat = snapshot.config?.repeat ?? 'off';
  const volume = snapshot.config?.volume ?? 100;

  const items = snapshot.queue?.items ?? [];
  const currentIndex = snapshot.queue?.currentIndex ?? -1;
  // Neighbor checks mirror advancement.js: skipPrev never wraps; skipNext
  // wraps only under repeat='all'.
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0
    && (currentIndex < items.length - 1 || (repeat === 'all' && items.length > 1));

  const canSeek = !snapshot.currentItem.isLive;

  return (
    <div className="np-transport" data-testid="np-transport">
      <div className="np-transport-main">
        <button
          type="button"
          data-testid="np-prev"
          className="np-icon-btn"
          aria-label="Previous"
          disabled={!hasPrev}
          onClick={() => transport.skipPrev?.()}
        >
          <IconPlayerSkipBackFilled size={22} />
        </button>
        {canSeek && (
          <button
            type="button"
            data-testid="np-rew"
            className="np-icon-btn"
            aria-label="Back 10 seconds"
            onClick={() => transport.seekRel?.(-SKIP_STEP_S)}
          >
            <IconRewindBackward10 size={22} />
          </button>
        )}
        <button
          type="button"
          data-testid="np-toggle"
          className="np-icon-btn np-icon-btn--primary"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={() => (isPlaying ? transport.pause?.() : transport.play?.())}
        >
          {isPlaying ? <IconPlayerPauseFilled size={30} /> : <IconPlayerPlayFilled size={30} />}
        </button>
        {canSeek && (
          <button
            type="button"
            data-testid="np-ffw"
            className="np-icon-btn"
            aria-label="Forward 10 seconds"
            onClick={() => transport.seekRel?.(SKIP_STEP_S)}
          >
            <IconRewindForward10 size={22} />
          </button>
        )}
        <button
          type="button"
          data-testid="np-next"
          className="np-icon-btn"
          aria-label="Next"
          disabled={!hasNext}
          onClick={() => transport.skipNext?.()}
        >
          <IconPlayerSkipForwardFilled size={22} />
        </button>
      </div>

      <div className="np-transport-secondary">
        <button
          type="button"
          data-testid="np-shuffle"
          className={`np-icon-btn ${shuffle ? 'np-icon-btn--on' : ''}`}
          aria-label="Shuffle"
          aria-pressed={shuffle}
          onClick={() => config.setShuffle?.(!shuffle)}
        >
          <IconArrowsShuffle size={20} />
        </button>
        <button
          type="button"
          data-testid="np-repeat"
          className={`np-icon-btn ${repeat !== 'off' ? 'np-icon-btn--on' : ''}`}
          aria-label={REPEAT_LABEL[repeat] ?? 'Repeat off'}
          onClick={() => config.setRepeat?.(REPEAT_NEXT[repeat])}
        >
          {repeat === 'one' ? <IconRepeatOnce size={20} /> : <IconRepeat size={20} />}
        </button>
        {mediaEl && <RateControl mediaEl={mediaEl} />}
        <span className="np-volume-group">
          <IconVolume size={18} aria-hidden="true" />
          <input
            type="range"
            data-testid="np-volume"
            className="np-volume"
            min={0}
            max={100}
            step={1}
            value={volume}
            aria-label="Volume"
            onChange={(e) => config.setVolume?.(Number(e.target.value))}
          />
        </span>
        <button
          type="button"
          data-testid="np-stop"
          className="np-icon-btn"
          aria-label="Stop"
          onClick={() => transport.stop?.()}
        >
          <IconPlayerStopFilled size={20} />
        </button>
      </div>
    </div>
  );
}

export default TransportBar;
