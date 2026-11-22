import { useEffect, useRef, useState } from 'react';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';

/**
 * A part's timing as a mini timeline (owner, 2026-11-22: "a mini timeline with handlebars i can
 * drag"): a window around the part with a tick every second, the part's span as a band with a
 * handle at each end, and the film's playhead. Drag a handle, or focus it and use ← → (0.1 s; with
 * Shift 0.5 s) and Home / End (put it at the playhead). A click on the strip seeks the film there.
 * It only edits `span`; RowEditor saves it.
 */
const MIN_GAP = 0.05;
const MIN_WINDOW = 12;
const PLAYHEAD_MS = 100;
const LABEL_STEPS = [5, 10, 15, 30, 60, 120, 300, 600];
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

/** m:ss.ss (hundredths: a hand-set edge is finer than the list's tenths). */
export function fineTimecode(t) {
  if (!Number.isFinite(t)) return '';
  const hundredths = Math.round(t * 100);
  const m = Math.floor(hundredths / 6000);
  const s = (hundredths % 6000) / 100;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
/** "44:24.30–44:25.10, 0.8 s" */
export const spanText = ([a, b]) => `${fineTimecode(a)}–${fineTimecode(b)}, ${Number((b - a).toFixed(2))} s`;

/** The window a span opens in: the part ± 6 s or ± half its length, at least 12 s wide, from 0. */
export function windowFor([a, b]) {
  const pad = Math.max(6, (b - a) / 2);
  let from = a - pad;
  let to = b + pad;
  if (to - from < MIN_WINDOW) { const more = (MIN_WINDOW - (to - from)) / 2; from -= more; to += more; }
  if (from < 0) { to -= from; from = 0; }
  return [Math.floor(from), Math.ceil(to)];
}

export function TimingStrip({ span, saved = span, onChange = () => {}, onNotice = () => {}, disabled = false }) {
  const [win, setWin] = useState(() => windowFor(saved));
  const [now, setNow] = useState(null);
  const track = useRef(null);
  const drag = useRef(null);
  // A new part (or a saved change) opens its own window.
  useEffect(() => { setWin(windowFor(saved)); }, [saved[0], saved[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const read = () => setNow(previewStore.currentTime());
    read();
    const timer = setInterval(read, PLAYHEAD_MS);
    return () => clearInterval(timer);
  }, []);

  const width = win[1] - win[0];
  const pct = (t) => `${((t - win[0]) / width) * 100}%`;
  const timeAt = (clientX) => {
    const box = track.current?.getBoundingClientRect();
    if (!box?.width) return null;
    return win[0] + (Math.min(Math.max(clientX - box.left, 0), box.width) / box.width) * width;
  };
  // Start stays under end; a handle pushed to the window's edge widens the window by a few seconds.
  const move = (edge, t, { grow = true } = {}) => {
    let v = edge === 0 ? Math.min(Math.max(0, t), span[1] - MIN_GAP) : Math.max(t, span[0] + MIN_GAP);
    v = round3(v);
    if (grow && v <= win[0]) setWin([Math.max(0, Math.floor(v - 3)), win[1]]);
    else if (grow && v >= win[1]) setWin([win[0], Math.ceil(v + 3)]);
    if (v !== span[edge]) onChange(edge === 0 ? [v, span[1]] : [span[0], v]);
  };

  const onDown = (edge) => (e) => {
    if (disabled) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus?.();
    drag.current = edge;
  };
  const onMove = (edge) => (e) => {
    if (drag.current !== edge || disabled) return;
    const t = timeAt(e.clientX);
    // While the pointer is down the window holds still, so the handle stays under the pointer.
    if (t != null) move(edge, Math.min(Math.max(round2(t), win[0]), win[1]), { grow: false });
  };
  const onUp = (edge) => (e) => {
    if (drag.current !== edge) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (span[edge] <= win[0] && win[0] > 0) setWin([Math.max(0, win[0] - 3), win[1]]);
    else if (span[edge] >= win[1]) setWin([win[0], win[1] + 3]);
  };
  const onKey = (edge) => (e) => {
    if (disabled || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { e.currentTarget.blur(); return; }
    const by = e.shiftKey ? 0.5 : 0.1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') move(edge, span[edge] + (e.key === 'ArrowLeft' ? -by : by));
    else if (e.key === 'Home' || e.key === 'End') {
      const t = previewStore.currentTime();
      if (t == null) onNotice('Play the film first.'); else move(edge, t);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const seek = (e) => {
    if (e.target.closest?.('[role="slider"]')) return;
    const t = timeAt(e.clientX);
    if (t != null) previewStore.seekTo(round2(t));
  };

  const minor = width <= 60 ? 1 : width <= 300 ? 5 : 30;
  const labelStep = LABEL_STEPS.find((s) => width / s <= 8) || 600;
  const ticks = [];
  for (let t = Math.ceil(win[0] / minor) * minor; t <= win[1]; t += minor) ticks.push(t);
  const handle = (edge, name) => (
    <span role="slider" tabIndex={disabled ? -1 : 0} aria-label={name} aria-orientation="horizontal" aria-disabled={disabled || undefined}
      aria-valuemin={edge === 0 ? win[0] : round3(span[0] + MIN_GAP)} aria-valuemax={edge === 0 ? round3(span[1] - MIN_GAP) : win[1]}
      aria-valuenow={span[edge]} aria-valuetext={fineTimecode(span[edge])}
      title={`${name}: drag, or ← → (Shift for 0.5 s); ${edge === 0 ? 'Home' : 'End'} sets it at the playhead`}
      className={`cf-strip__handle is-${edge === 0 ? 'start' : 'end'}`} style={{ left: pct(span[edge]) }}
      onPointerDown={onDown(edge)} onPointerMove={onMove(edge)} onPointerUp={onUp(edge)} onPointerCancel={onUp(edge)} onKeyDown={onKey(edge)} />
  );
  const changed = span[0] !== saved[0] || span[1] !== saved[1];
  return (
    <div className={`cf-strip${disabled ? ' is-disabled' : ''}`} aria-label="Timing">
      <div className="cf-strip__track" ref={track} onClick={seek} title="Click to play the film from here">
        {ticks.map((t) => (
          <span key={t} className={`cf-strip__tick${t % labelStep === 0 ? ' is-major' : ''}`} style={{ left: pct(t) }}>
            {t % labelStep === 0 ? <span className="cf-strip__label">{clock(t)}</span> : null}
          </span>
        ))}
        {changed ? <span className="cf-strip__saved" style={{ left: pct(Math.max(saved[0], win[0])), right: `${100 - parseFloat(pct(Math.min(saved[1], win[1])))}%` }} /> : null}
        <span className="cf-strip__band" style={{ left: pct(span[0]), right: `${100 - parseFloat(pct(span[1]))}%` }} />
        {now != null && now >= win[0] && now <= win[1] ? <span className="cf-strip__playhead" data-testid="playhead" style={{ left: pct(now) }} /> : null}
        {handle(0, 'Start')}
        {handle(1, 'End')}
      </div>
    </div>
  );
}

export default TimingStrip;
