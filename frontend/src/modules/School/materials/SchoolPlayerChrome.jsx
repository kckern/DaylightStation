/**
 * SchoolPlayerChrome — the transport control bar for the School player. One
 * component, one layout for both media: progress numbers centered above a
 * seekable bar, then a control row of volume (left) · transport (centered) ·
 * exit (right). Audio and video render identically; `variant` only swaps the
 * colour treatment (a light persistent bar under the audio cover vs. white
 * controls on the tap-summoned video overlay) — the persistent-vs-overlay
 * container is the parent's job (SchoolMaterialPlayer), not this component's.
 * Controls: seekable progress, ∓15s, prev/next chapter, play/pause, volume, exit.
 *
 * There is no separate restart control: `onPrev` is the CD-player button —
 * back to the start of this track, and only to the previous track when you are
 * already at the start (the threshold lives in SchoolMaterialPlayer).
 *
 * Purely presentational: all state and commands come from useMediaChrome (via
 * SchoolMaterialPlayer). Icons are the School inline-SVG set.
 */
import { useRef, useState } from 'react';
import Icon from '../home/icons/Icon.jsx';

const fmt = (s) => {
  const v = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = v % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
};

export default function SchoolPlayerChrome({
  variant = 'audio',
  isPlaying, currentTime, duration, volume,
  onToggle, onSeek, onSkip, onPrev, onNext, onSetVolume, onExit,
  hasPrev = false, hasNext = false,
  onActivity,
}) {
  const barRef = useRef(null);
  const [volOpen, setVolOpen] = useState(false);
  const dur = duration > 0 ? duration : 0;
  const pct = dur ? Math.min(100, (currentTime / dur) * 100) : 0;

  const seekFromEvent = (e) => {
    onActivity?.();
    const el = barRef.current;
    if (!el || !dur) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    onSeek(Math.max(0, Math.min(dur, (x / rect.width) * dur)));
  };

  const act = (fn) => (e) => { e.stopPropagation(); onActivity?.(); fn?.(); };

  const transport = (
    <>
      <button type="button" className="school-chrome__btn" onClick={act(onPrev)} disabled={!hasPrev} aria-label="Restart, or previous chapter"><Icon name="prev" /></button>
      <button type="button" className="school-chrome__btn" onClick={act(() => onSkip(-15))} aria-label="Back 15 seconds"><Icon name="rewind" /></button>
      <button type="button" className="school-chrome__btn school-chrome__btn--play" onClick={act(onToggle)} aria-label={isPlaying ? 'Pause' : 'Play'}>
        <Icon name={isPlaying ? 'pause' : 'play'} />
      </button>
      <button type="button" className="school-chrome__btn" onClick={act(() => onSkip(15))} aria-label="Forward 15 seconds"><Icon name="forward" /></button>
      <button type="button" className="school-chrome__btn" onClick={act(onNext)} disabled={!hasNext} aria-label="Next chapter"><Icon name="next" /></button>
    </>
  );

  const volumeControl = (
    <div className="school-chrome__volume">
      <button type="button" className={`school-chrome__btn${volOpen ? ' is-on' : ''}`} onClick={act(() => setVolOpen((o) => !o))} aria-label="Volume">
        <Icon name={volume === 0 ? 'volume-mute' : 'volume'} />
      </button>
      {volOpen && (
        <div className="school-chrome__volume-pop" onPointerDown={(e) => e.stopPropagation()}>
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <button
              key={v}
              type="button"
              className={`school-chrome__vol-step${Math.abs(volume - v) < 0.13 ? ' is-active' : ''}`}
              onClick={act(() => onSetVolume(v))}
              aria-label={`Volume ${Math.round(v * 100)} percent`}
            >
              {Math.round(v * 100)}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const timeLabel = <span className="school-chrome__time">{fmt(currentTime)} / {fmt(dur)}</span>;

  return (
    <div className={`school-chrome school-chrome--${variant}`} onPointerDown={() => onActivity?.()}>
      {/* Progress numbers ride centered just above the seek bar (both media). */}
      <div className="school-chrome__time-float">{timeLabel}</div>
      <div className="school-chrome__bar" ref={barRef} onPointerDown={seekFromEvent}>
        <div className="school-chrome__progress" style={{ width: `${pct}%` }} />
      </div>
      {/* volume left · transport centered · exit right — one layout for both. */}
      <div className="school-chrome__row">
        {volumeControl}
        <div className="school-chrome__spacer" />
        {transport}
        <div className="school-chrome__spacer" />
        <button type="button" className="school-chrome__btn school-chrome__btn--exit" onClick={act(onExit)} aria-label="Exit"><Icon name="close" /></button>
      </div>
    </div>
  );
}
