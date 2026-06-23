// PianoVideoChrome.jsx
import { useRef } from 'react';
import Icon from '../../icons/Icon.jsx';

const fmt = (s) => {
  let v = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`;
};

/**
 * Presentational transport bar for the piano video player. Big touch targets,
 * no drag sliders (tap-to-seek bar, discrete speed cycle, A/B loop taps).
 */
export default function PianoVideoChrome({
  isPlaying, currentTime, duration, rate, loop, playAlong,
  onToggle, onSkip, onCycleRate, onMarkA, onMarkB, onClearLoop, onSeek, onBack, onTogglePlayAlong,
}) {
  const barRef = useRef(null);
  const dur = duration > 0 ? duration : 0;
  const pct = dur ? Math.min(100, (currentTime / dur) * 100) : 0;
  const markPos = (v) => (dur && Number.isFinite(v) ? `${Math.min(100, (v / dur) * 100)}%` : null);
  const seekFromEvent = (e) => {
    const el = barRef.current; if (!el || !dur) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    onSeek(Math.max(0, Math.min(dur, (x / rect.width) * dur)));
  };
  const hasLoop = loop?.a != null || loop?.b != null;

  return (
    <div className="piano-video-chrome" data-testid="piano-video-chrome">
      <div className="piano-video-chrome__bar" ref={barRef} onPointerDown={seekFromEvent}>
        <div className="piano-video-chrome__progress" style={{ width: `${pct}%` }} />
        {markPos(loop?.a) && <span className="piano-video-chrome__mark piano-video-chrome__mark--a" style={{ left: markPos(loop.a) }} />}
        {markPos(loop?.b) && <span className="piano-video-chrome__mark piano-video-chrome__mark--b" style={{ left: markPos(loop.b) }} />}
      </div>
      <div className="piano-video-chrome__row">
        <button type="button" className="piano-video-chrome__btn" onClick={onBack}><Icon name="back" /> Course</button>
        <span className="piano-video-chrome__time">{fmt(currentTime)} / {fmt(dur)}</span>
        <div className="piano-video-chrome__spacer" />
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-30)} aria-label="Back 30 seconds"><Icon name="skip-back-30" /> 30</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-15)} aria-label="Back 15 seconds"><Icon name="skip-back-15" /> 15</button>
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--play" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Icon name="pause" /> : <Icon name="play" />}</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(15)} aria-label="Forward 15 seconds"><Icon name="skip-forward-15" /> 15</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(30)} aria-label="Forward 30 seconds"><Icon name="skip-forward-30" /> 30</button>
        <div className="piano-video-chrome__spacer" />
        <button type="button" className="piano-video-chrome__btn" onClick={onCycleRate} aria-label="Playback speed">{rate}×</button>
        <button type="button" className={`piano-video-chrome__btn${loop?.a != null && loop?.b == null ? ' is-arming' : ''}`} onClick={onMarkA} aria-label="Mark loop start">A</button>
        <button type="button" className="piano-video-chrome__btn" onClick={onMarkB} aria-label="Mark loop end">B</button>
        <button type="button" className="piano-video-chrome__btn" onClick={onClearLoop} disabled={!hasLoop} aria-label="Clear loop"><Icon name="clear-loop" /></button>
        <div className="piano-video-chrome__spacer" />
        <button type="button" className={`piano-video-chrome__btn${playAlong ? ' is-on' : ''}`} onClick={onTogglePlayAlong} aria-label={playAlong ? 'Hide play-along' : 'Show play-along'}><Icon name="play-along" /></button>
      </div>
    </div>
  );
}
