// PianoVideoChrome.jsx
import { useRef, useState } from 'react';
import Icon from '../../icons/Icon.jsx';
import VolumeModal from '../../VolumeModal.jsx';

const fmt = (s) => {
  let v = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`;
};

export default function PianoVideoChrome({
  isPlaying, currentTime, duration, rate, loop,
  onToggle, onSkip, onRestart, onCycleRate, onMarkA, onMarkB, onToggleLoop, onClearLoop, onSeek, onToggleFullscreen,
  isSequential = false,
  furthestWatched = 0,
  gateOpen = false,
}) {
  const barRef = useRef(null);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const dur = duration > 0 ? duration : 0;
  const pct = dur ? Math.min(100, (currentTime / dur) * 100) : 0;
  const markPos = (v) => (dur && Number.isFinite(v) ? `${Math.min(100, (v / dur) * 100)}%` : null);
  // Sequential: can't advance past the furthest point already reached (1s tolerance).
  const forwardDisabled = isSequential && currentTime >= furthestWatched - 1;
  const seekFromEvent = (e) => {
    if (gateOpen) return;                               // engagement gate blocks the scrubber
    const el = barRef.current; if (!el || !dur) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    const pos = Math.max(0, Math.min(dur, (x / rect.width) * dur));
    onSeek(isSequential ? Math.min(pos, furthestWatched) : pos);
  };
  const hasLoop = loop?.a != null || loop?.b != null;
  const bothMarks = loop?.a != null && loop?.b != null;
  const loopActive = !!loop?.active;

  return (
    <div className="piano-video-chrome" data-testid="piano-video-chrome">
      <div className="piano-video-chrome__bar" ref={barRef} onPointerDown={seekFromEvent}>
        <div className="piano-video-chrome__progress" style={{ width: `${pct}%` }} />
        {markPos(loop?.a) && <span className="piano-video-chrome__mark piano-video-chrome__mark--a" style={{ left: markPos(loop.a) }} />}
        {markPos(loop?.b) && <span className="piano-video-chrome__mark piano-video-chrome__mark--b" style={{ left: markPos(loop.b) }} />}
      </div>
      <div className="piano-video-chrome__row">
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--restart" onClick={onRestart} disabled={gateOpen} aria-label="Restart from beginning"><Icon name="previous" /></button>
        <span className="piano-video-chrome__time">{fmt(currentTime)} / {fmt(dur)}</span>
        <div className="piano-video-chrome__spacer" />
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-30)} disabled={gateOpen} aria-label="Back 30 seconds"><Icon name="skip-back-30" /></button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-15)} disabled={gateOpen} aria-label="Back 15 seconds"><Icon name="skip-back-15" /></button>
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--play" onClick={onToggle} disabled={gateOpen} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Icon name="pause" /> : <Icon name="play" />}</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(15)} disabled={gateOpen || forwardDisabled} aria-label="Forward 15 seconds"><Icon name="skip-forward-15" /></button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(30)} disabled={gateOpen || forwardDisabled} aria-label="Forward 30 seconds"><Icon name="skip-forward-30" /></button>
        <div className="piano-video-chrome__spacer" />
        {!isSequential && (
          <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--rate" onClick={onCycleRate} disabled={gateOpen} aria-label="Playback speed">{rate}×</button>
        )}
        <div className={`piano-video-chrome__loop-group${hasLoop ? ' has-marks' : ''}`}>
          <button type="button" className={`piano-video-chrome__btn${loop?.a != null && loop?.b == null ? ' is-arming' : ''}`} onClick={onMarkA} disabled={gateOpen} aria-label="Mark loop start"><Icon name="loop-a" /></button>
          <button type="button" className="piano-video-chrome__btn" onClick={onMarkB} disabled={gateOpen} aria-label="Mark loop end"><Icon name="loop-b" /></button>
          <button type="button" className={`piano-video-chrome__btn${loopActive ? ' is-on' : ''}`} onClick={onToggleLoop} disabled={gateOpen || !bothMarks} aria-label="Toggle A-B loop"><Icon name="repeat" /></button>
          <button type="button" className="piano-video-chrome__btn" onClick={onClearLoop} disabled={gateOpen || !hasLoop} aria-label="Clear loop"><Icon name="clear-loop" /></button>
        </div>
        <button type="button" className={`piano-video-chrome__btn${volumeOpen ? ' is-on' : ''}`} onClick={() => setVolumeOpen(true)} disabled={gateOpen} aria-label="Volume"><Icon name="volume-up" /></button>
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--fullscreen" onClick={onToggleFullscreen} disabled={gateOpen} aria-label="Toggle fullscreen"><Icon name="fullscreen" /></button>
      </div>
      <VolumeModal open={volumeOpen} onClose={() => setVolumeOpen(false)} />
    </div>
  );
}
