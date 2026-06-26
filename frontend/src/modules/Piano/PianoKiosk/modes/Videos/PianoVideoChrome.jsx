// PianoVideoChrome.jsx
import { useRef, useState } from 'react';
import Icon from '../../icons/Icon.jsx';
import { usePianoMix } from '../../PianoMixContext.jsx';
import MixControls from '../../MixControls.jsx';

const fmt = (s) => {
  let v = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`;
};

export default function PianoVideoChrome({
  isPlaying, currentTime, duration, rate, loop, playAlong,
  onToggle, onSkip, onRestart, onCycleRate, onMarkA, onMarkB, onToggleLoop, onClearLoop, onSeek, onTogglePlayAlong,
  isSequential = false,
  furthestWatched = 0,
}) {
  const barRef = useRef(null);
  const [mixOpen, setMixOpen] = useState(false);
  const { pianoLevel, mediaLevel, setPianoLevel, setMediaLevel } = usePianoMix();
  const dur = duration > 0 ? duration : 0;
  const pct = dur ? Math.min(100, (currentTime / dur) * 100) : 0;
  const markPos = (v) => (dur && Number.isFinite(v) ? `${Math.min(100, (v / dur) * 100)}%` : null);
  // Sequential: can't advance past the furthest point already reached (1s tolerance).
  const forwardDisabled = isSequential && currentTime >= furthestWatched - 1;
  const seekFromEvent = (e) => {
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
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--restart" onClick={onRestart} aria-label="Restart from beginning"><Icon name="previous" /></button>
        <span className="piano-video-chrome__time">{fmt(currentTime)} / {fmt(dur)}</span>
        <div className="piano-video-chrome__spacer" />
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-15)} aria-label="Back 15 seconds"><Icon name="skip-back-15" /></button>
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--play" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Icon name="pause" /> : <Icon name="play" />}</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(15)} disabled={forwardDisabled} aria-label="Forward 15 seconds"><Icon name="skip-forward-15" /></button>
        <div className="piano-video-chrome__spacer" />
        {!isSequential && (
          <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--rate" onClick={onCycleRate} aria-label="Playback speed">{rate}×</button>
        )}
        <div className={`piano-video-chrome__loop-group${hasLoop ? ' has-marks' : ''}`}>
          <button type="button" className={`piano-video-chrome__btn${loop?.a != null && loop?.b == null ? ' is-arming' : ''}`} onClick={onMarkA} aria-label="Mark loop start"><Icon name="loop-a" /></button>
          <button type="button" className="piano-video-chrome__btn" onClick={onMarkB} aria-label="Mark loop end"><Icon name="loop-b" /></button>
          <button type="button" className={`piano-video-chrome__btn${loopActive ? ' is-on' : ''}`} onClick={onToggleLoop} disabled={!bothMarks} aria-label="Toggle A-B loop"><Icon name="repeat" /></button>
          <button type="button" className="piano-video-chrome__btn" onClick={onClearLoop} disabled={!hasLoop} aria-label="Clear loop"><Icon name="clear-loop" /></button>
        </div>
        <div className="piano-video-chrome__mix-wrap">
          <button type="button" className={`piano-video-chrome__btn${mixOpen ? ' is-on' : ''}`} onClick={() => setMixOpen((v) => !v)} aria-label="Toggle mix controls"><Icon name="volume-up" /></button>
          {mixOpen && (
            <div className="piano-video-chrome__mix-flyout">
              <MixControls
                pianoLevel={pianoLevel}
                mediaLevel={mediaLevel}
                onPiano={(d) => setPianoLevel(pianoLevel + d)}
                onMedia={(d) => setMediaLevel(mediaLevel + d)}
                btnClass="piano-video-chrome__btn"
              />
            </div>
          )}
        </div>
        <button type="button" className={`piano-video-chrome__btn${playAlong ? ' is-on' : ''}`} onClick={onTogglePlayAlong} aria-label={playAlong ? 'Hide play-along' : 'Show play-along'}><Icon name="play-along" /></button>
      </div>
    </div>
  );
}
