import { useEffect, useRef, useState } from 'react';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';

/**
 * A part's timing as a mini timeline (owner, 2026-11-22: "a mini timeline with handlebars i can
 * drag"): a window around the part with a tick every second, the part's span as a band with a
 * handle at each end, and the film's playhead. Drag a handle, or focus it with Tab and use ← →
 * (0.1 s; with Shift 0.5 s) and Home / End (put it at the playhead). A handle dragged with the
 * pointer does not keep the keyboard: ← → go on stepping through the parts (review 2026-11-22).
 * Each band carries its part's label (the word to listen for); a band too narrow for it shows an
 * ellipsis, and hovering the band names it in full. Bands take pointer events only for that tooltip:
 * presses, clicks and right-clicks still reach the track.
 * `applying`: a save is in flight; the marker under the band jumps to the new span at once, in a
 * pending colour, and returns to grey once the film's timing is refreshed.
 * A click on the strip seeks the film there. It only edits `span`; RowEditor saves it.
 */
const MIN_GAP = 0.05;
const MIN_WINDOW = 12;
const PLAYHEAD_MS = 100;
const LABEL_STEPS = [5, 10, 15, 30, 60, 120, 300, 600];
// Labels sit right of their tick; past this share of the track there is no room for one.
const LABEL_UNTIL = 0.86;
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${m}`);
/** m:ss.ss, or h:mm:ss.ss from an hour on (hundredths: a hand-set edge is finer than the list's tenths). */
export function fineTimecode(t) {
  if (!Number.isFinite(t)) return '';
  const hundredths = Math.round(t * 100);
  const m = Math.floor(hundredths / 6000);
  const s = (hundredths % 6000) / 100;
  return `${hm(m)}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
const clock = (t) => `${hm(Math.floor(t / 60))}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
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

const SCRUB_MS = 100;
const FOCUS = '__focus';
const GRAB_PX = 12;

/**
 * `neighbours` (Fable design 2026-11-22, owner: two bleeps close together must both show and be
 * adjustable): other parts that overlap the window, `{ id, span, saved, editable, family, label }`.
 * They draw in their effect family's colour; an editable one has handles and reports through
 * `onNeighbourChange(id, span)`. Every dragged span is a draft until the card saves it.
 * `onPartMenu(row, { x, y })`: a right-click on a band opens that part's menu (PartMenu.jsx); the
 * part in hand's band passes `row`, a neighbour's its own `row`.
 */
export function TimingStrip({ span, saved = span, onChange = () => {}, onNotice = () => {}, disabled = false, neighbours = [], onNeighbourChange = () => {},
  row = null, onPartMenu = null, applying = false, onDragging = () => {} }) {
  const [win, setWin] = useState(() => windowFor(saved));
  const [now, setNow] = useState(null);
  const [dragging, setDragging] = useState(null);
  const track = useRef(null);
  const drag = useRef(null);
  const scrubAt = useRef(0);
  const suppressClick = useRef(false);
  useEffect(() => { setWin(windowFor(saved)); }, [saved[0], saved[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const read = () => setNow(previewStore.currentTime());
    read();
    const timer = setInterval(read, PLAYHEAD_MS);
    return () => clearInterval(timer);
  }, []);

  const parts = [{ id: FOCUS, span, saved, editable: true, focus: true },
    ...neighbours.filter((n) => n.span[1] >= win[0] && n.span[0] <= win[1])];
  const spanOf = (id) => parts.find((x) => x.id === id)?.span;
  const report = (id, next) => (id === FOCUS ? onChange(next) : onNeighbourChange(id, next));

  const width = win[1] - win[0];
  const pct = (t) => `${((t - win[0]) / width) * 100}%`;
  const timeAt = (clientX) => {
    const box = track.current?.getBoundingClientRect();
    if (!box?.width) return null;
    return win[0] + (Math.min(Math.max(clientX - box.left, 0), box.width) / box.width) * width;
  };
  const move = (id, edge, t, { grow = true } = {}) => {
    const cur = spanOf(id);
    if (!cur) return;
    // A part never crosses another one in the window (review 2026-11-22: neighbours overlapped).
    const others = parts.filter((x) => x.id !== id);
    const floor = Math.max(0, ...others.filter((x) => x.span[1] <= cur[0] + 1e-6).map((x) => x.span[1]));
    const ceil = Math.min(Infinity, ...others.filter((x) => x.span[0] >= cur[1] - 1e-6).map((x) => x.span[0]));
    let v = edge === 0 ? Math.min(Math.max(floor, t), cur[1] - MIN_GAP) : Math.min(Math.max(t, cur[0] + MIN_GAP), ceil);
    v = round3(v);
    if (grow && v <= win[0]) setWin([Math.max(0, Math.floor(v - 3)), win[1]]);
    else if (grow && v >= win[1]) setWin([win[0], Math.ceil(v + 3)]);
    if (v !== cur[edge]) report(id, edge === 0 ? [v, cur[1]] : [cur[0], v]);
  };

  // The track decides which handle a press means: the nearest edge bar within GRAB_PX, so two close
  // parts' handles never steal each other (review 2026-11-22). A press farther away is a click (seek).
  const grab = (e) => {
    // Only the main button drags: a right-click is the part menu, never a nudge.
    if (disabled || (e.button != null && e.button !== 0)) return;
    const box = track.current?.getBoundingClientRect();
    if (!box?.width) return;
    const x = e.clientX - box.left;
    let best = null;
    for (const part of parts.filter((q) => q.editable)) {
      for (const edge of [0, 1]) {
        const d = Math.abs(((part.span[edge] - win[0]) / width) * box.width - x);
        if (d <= GRAB_PX && (!best || d < best.d)) best = { id: part.id, edge, d };
      }
    }
    if (!best) return;
    e.preventDefault?.();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const t = timeAt(e.clientX);
    drag.current = { id: best.id, edge: best.edge, offset: t == null ? 0 : t - spanOf(best.id)[best.edge], moved: false };
    setDragging({ id: best.id, edge: best.edge });
    onDragging(true);
  };
  const trackMove = (e) => { const d = drag.current; if (d) onMove(d.id, d.edge)(e); };
  const trackUp = (e) => {
    const d = drag.current;
    if (!d) return;
    onUp(d.id, d.edge)(e);
    suppressClick.current = true;
    // A pointer drag never keeps the keyboard: ← → go on stepping through the parts.
    const focused = document.activeElement;
    if (focused?.getAttribute?.('role') === 'slider' && track.current?.contains(focused)) focused.blur();
  };
  const onMove = (id, edge) => (e) => {
    const d = drag.current;
    if (!d || d.id !== id || d.edge !== edge || disabled) return;
    const t = timeAt(e.clientX);
    if (t == null) return;
    const v = Math.min(Math.max(round2(t - d.offset), win[0]), win[1]);
    move(id, edge, v, { grow: false });
    // The paused film follows the handle, so the edge is judged by eye.
    const at = Date.now();
    if (at - scrubAt.current >= SCRUB_MS) { scrubAt.current = at; previewStore.seekTo(v); }
  };
  const onUp = (id, edge) => (e) => {
    const d = drag.current;
    if (!d || d.id !== id || d.edge !== edge) return;
    drag.current = null;
    setDragging(null);
    onDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    e.currentTarget.blur?.();
    const v = spanOf(id)?.[edge];
    if (v <= win[0] && win[0] > 0) setWin([Math.max(0, win[0] - 3), win[1]]);
    else if (v >= win[1]) setWin([win[0], win[1] + 3]);
  };
  const onKey = (id, edge) => (e) => {
    if (disabled || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { e.currentTarget.blur(); return; }
    const by = e.shiftKey ? 0.5 : 0.1;
    const cur = spanOf(id);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') move(id, edge, cur[edge] + (e.key === 'ArrowLeft' ? -by : by));
    else if (e.key === 'Home' || e.key === 'End') {
      const t = previewStore.currentTime();
      if (t == null) onNotice('Play the film first.'); else move(id, edge, t);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const seek = (e) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (e.target.closest?.('[role="slider"]')) return;
    const t = timeAt(e.clientX);
    if (t != null) previewStore.seekTo(round2(t));
  };

  // Right-click: the menu of the part under the pointer (the bands take no pointer events, so the
  // track finds it by time). Empty track keeps the browser's own menu.
  const partMenu = (e) => {
    if (!onPartMenu) return;
    const t = timeAt(e.clientX);
    if (t == null) return;
    const hit = parts.find((x) => x.focus && t >= x.span[0] && t <= x.span[1])
      || parts.find((x) => !x.focus && x.row && t >= x.span[0] && t <= x.span[1]);
    const target = hit?.focus ? row : hit?.row;
    if (!target) return;
    e.preventDefault();
    onPartMenu(target, { x: e.clientX, y: e.clientY });
  };

  const minor = width <= 60 ? 1 : width <= 300 ? 5 : 30;
  const labelStep = LABEL_STEPS.find((st) => width / st <= 8) || 600;
  const ticks = [];
  for (let t = Math.ceil(win[0] / minor) * minor; t <= win[1]; t += minor) ticks.push(t);
  const handle = (part, edge) => {
    const name = `${part.focus ? '' : `${part.label}: `}${edge === 0 ? 'Start' : 'End'}`;
    const value = part.span[edge];
    const live = dragging && dragging.id === part.id && dragging.edge === edge;
    return (
      <span key={`${part.id}:${edge}`} role="slider" tabIndex={disabled ? -1 : 0} aria-label={name} aria-orientation="horizontal" aria-disabled={disabled || undefined}
        aria-valuemin={edge === 0 ? win[0] : round3(part.span[0] + MIN_GAP)} aria-valuemax={edge === 0 ? round3(part.span[1] - MIN_GAP) : win[1]}
        aria-valuenow={value} aria-valuetext={fineTimecode(value)}
        title={`${name} ${fineTimecode(value)}: drag, or Tab to it and use ← → (Shift 0.5 s); Home or End sets it at the playhead`}
        className={`cf-strip__handle is-${edge === 0 ? 'start' : 'end'}${part.focus ? '' : ' is-neighbour'}${live ? ' is-dragging' : ''}`} style={{ left: pct(value) }}
        onMouseDown={(e) => e.preventDefault()} onKeyDown={onKey(part.id, edge)}>
        {live ? <span className="cf-strip__bubble">{fineTimecode(value)}</span> : null}
      </span>
    );
  };
  const changed = span[0] !== saved[0] || span[1] !== saved[1];
  const band = (a, b) => ({ left: pct(Math.max(a, win[0])), right: `${100 - parseFloat(pct(Math.min(b, win[1])))}%` });
  return (
    <div className={`cf-strip${disabled ? ' is-disabled' : ''}`} aria-label="Timing">
      <div className="cf-strip__track" ref={track} onClick={seek} title="Click to move the film here"
        onPointerDown={grab} onPointerMove={trackMove} onPointerUp={trackUp} onPointerCancel={trackUp} onContextMenu={partMenu}>
        {ticks.map((t) => (
          <span key={t} className={`cf-strip__tick${t % labelStep === 0 ? ' is-major' : ''}`} style={{ left: pct(t) }}>
            {t % labelStep === 0 && (t - win[0]) / width <= LABEL_UNTIL ? <span className="cf-strip__label">{clock(t)}</span> : null}
          </span>
        ))}
        {applying
          ? <span className="cf-strip__saved is-pending" title="Saving: not applied yet" style={band(span[0], span[1])} />
          : changed ? <span className="cf-strip__saved" style={band(saved[0], saved[1])} /> : null}
        {parts.filter((x) => !x.focus).map((x) => (
          <span key={x.id} className={`cf-strip__band is-neighbour is-${x.family || 'other'}${x.editable ? '' : ' is-locked'}`} style={band(x.span[0], x.span[1])} title={x.label}>
            {x.label ? <span className="cf-strip__bandlabel">{x.label}</span> : null}
          </span>
        ))}
        <span className="cf-strip__band" style={band(span[0], span[1])} title={row?.label}>
          {row?.label ? <span className="cf-strip__bandlabel">{row.label}</span> : null}
        </span>
        {now != null && now >= win[0] && now <= win[1] ? <span className="cf-strip__playhead" data-testid="playhead" style={{ left: pct(now) }} /> : null}
        {/* Handles in time order, so Tab walks the strip left to right. */}
        {parts.filter((x) => x.editable).flatMap((x) => [[x, 0], [x, 1]])
          .sort((a, b) => a[0].span[a[1]] - b[0].span[b[1]]).map(([x, edge]) => handle(x, edge))}
      </div>
    </div>
  );
}

export default TimingStrip;
