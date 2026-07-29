// PianoVideoChrome.jsx
import { useRef } from 'react';
import Icon from '../../icons/Icon.jsx';
import VolumeControl from '../../transport/VolumeControl.jsx';

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
        {/* The chevron COUNT carries the magnitude (one = 15s, two = 30s) so the
            step size reads at a glance; the numeral spells it out. Without both,
            back-15 and back-30 are indistinguishable — they were the same glyph. */}
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--skip" onClick={() => onSkip(-30)} disabled={gateOpen} aria-label="Back 30 seconds"><Icon name="skip-back-30" /><span className="piano-video-chrome__skip-n">30</span></button>
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--skip" onClick={() => onSkip(-15)} disabled={gateOpen} aria-label="Back 15 seconds"><Icon name="skip-back-15" /><span className="piano-video-chrome__skip-n">15</span></button>
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--play" onClick={onToggle} disabled={gateOpen} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Icon name="pause" /> : <Icon name="play" />}</button>
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--skip" onClick={() => onSkip(15)} disabled={gateOpen || forwardDisabled} aria-label="Forward 15 seconds"><span className="piano-video-chrome__skip-n">15</span><Icon name="skip-forward-15" /></button>
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--skip" onClick={() => onSkip(30)} disabled={gateOpen || forwardDisabled} aria-label="Forward 30 seconds"><span className="piano-video-chrome__skip-n">30</span><Icon name="skip-forward-30" /></button>
        <div className="piano-video-chrome__spacer" />
        {!isSequential && (
          <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--rate" onClick={onCycleRate} disabled={gateOpen} aria-label="Playback speed">{rate}×</button>
        )}
        <div className={`piano-video-chrome__loop-group${hasLoop ? ' has-marks' : ''}`}>
          {/* Two families: the in/out brackets plant marks on the timeline; the
              cycle + trash act on the loop itself. `is-section-end` draws the
              divider between the two halves. */}
          <button type="button" className={`piano-video-chrome__btn${loop?.a != null && loop?.b == null ? ' is-arming' : ''}`} onClick={onMarkA} disabled={gateOpen} aria-label="Mark loop start"><Icon name="loop-in" /></button>
          <button type="button" className="piano-video-chrome__btn is-section-end" onClick={onMarkB} disabled={gateOpen} aria-label="Mark loop end"><Icon name="loop-out" /></button>
          <button type="button" className={`piano-video-chrome__btn piano-video-chrome__btn--loop-toggle${loopActive ? ' is-on' : ''}`} onClick={onToggleLoop} disabled={gateOpen || !bothMarks} aria-label="Toggle A-B loop"><Icon name="loop-toggle" /></button>
          <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--clear-loop" onClick={onClearLoop} disabled={gateOpen || !hasLoop} aria-label="Clear loop"><Icon name="clear-loop" /></button>
        </div>
        <VolumeControl disabled={gateOpen} className="piano-video-chrome__btn piano-video-chrome__btn--volume" />
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--fullscreen" onClick={onToggleFullscreen} disabled={gateOpen} aria-label="Toggle fullscreen"><Icon name="fullscreen" /></button>
      </div>
    </div>
  );
}
