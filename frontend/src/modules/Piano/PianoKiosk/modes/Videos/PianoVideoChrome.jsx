// PianoVideoChrome.jsx
import { useRef } from 'react';
import TransportButton from '../../transport/TransportButton.jsx';
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
        <TransportButton icon="previous" ariaLabel="Restart from beginning" className="piano-video-chrome__btn piano-video-chrome__btn--restart" disabled={gateOpen} onPress={onRestart} />
        <span className="piano-video-chrome__time">{fmt(currentTime)} / {fmt(dur)}</span>
        <div className="piano-video-chrome__spacer" />
        {/* The chevron COUNT carries the magnitude (one = 15s, two = 30s) so the
            step size reads at a glance; the numeral spells it out. Without both,
            back-15 and back-30 are indistinguishable — they were the same glyph. */}
        <TransportButton icon="skip-back-30" label="30" ariaLabel="Back 30 seconds" className="piano-video-chrome__btn" disabled={gateOpen} onPress={() => onSkip(-30)} />
        <TransportButton icon="skip-back-15" label="15" ariaLabel="Back 15 seconds" className="piano-video-chrome__btn" disabled={gateOpen} onPress={() => onSkip(-15)} />
        <TransportButton icon={isPlaying ? 'pause' : 'play'} ariaLabel={isPlaying ? 'Pause' : 'Play'} emphasis="primary" className="piano-video-chrome__btn" disabled={gateOpen} onPress={onToggle} />
        <TransportButton icon="skip-forward-15" label="15" ariaLabel="Forward 15 seconds" className="piano-video-chrome__btn" disabled={gateOpen || forwardDisabled} onPress={() => onSkip(15)} />
        <TransportButton icon="skip-forward-30" label="30" ariaLabel="Forward 30 seconds" className="piano-video-chrome__btn" disabled={gateOpen || forwardDisabled} onPress={() => onSkip(30)} />
        <div className="piano-video-chrome__spacer" />
        {!isSequential && (
          <TransportButton label={`${rate}×`} ariaLabel="Playback speed" className="piano-video-chrome__btn piano-video-chrome__btn--rate" disabled={gateOpen} onPress={onCycleRate} />
        )}
        <div className={`piano-video-chrome__loop-group${hasLoop ? ' has-marks' : ''}`}>
          {/* Two families: the in/out brackets plant marks on the timeline; the
              cycle + trash act on the loop itself. `is-section-end` draws the
              divider between the two halves. */}
          <TransportButton icon="loop-in" ariaLabel="Mark loop start" className={`piano-video-chrome__btn${loop?.a != null && loop?.b == null ? ' is-arming' : ''}`} disabled={gateOpen} onPress={onMarkA} />
          <TransportButton icon="loop-out" ariaLabel="Mark loop end" className="piano-video-chrome__btn is-section-end" disabled={gateOpen} onPress={onMarkB} />
          <TransportButton icon="loop-toggle" ariaLabel="Toggle A-B loop" className="piano-video-chrome__btn piano-video-chrome__btn--loop-toggle" on={loopActive} disabled={gateOpen || !bothMarks} onPress={onToggleLoop} />
          <TransportButton icon="clear-loop" ariaLabel="Clear loop" className="piano-video-chrome__btn piano-video-chrome__btn--clear-loop" disabled={gateOpen || !hasLoop} onPress={onClearLoop} />
        </div>
        <VolumeControl disabled={gateOpen} className="piano-video-chrome__btn piano-video-chrome__btn--volume" />
        <TransportButton icon="fullscreen" ariaLabel="Toggle fullscreen" className="piano-video-chrome__btn" disabled={gateOpen} onPress={onToggleFullscreen} />
      </div>
    </div>
  );
}
