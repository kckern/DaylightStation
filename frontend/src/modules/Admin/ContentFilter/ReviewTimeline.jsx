import { useEffect, useRef, useState } from 'react';
import { Text } from '@mantine/core';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { plays, rowAction } from './reviewScope.js';
import { timecode } from './ReviewList.jsx';

/**
 * Two lanes for the rows in the current scope: the whole film, and a window around the cursor.
 * Everything on a lane goes somewhere when clicked (owner, 2026-11-22: "anything on a timeline, you
 * click it, it should go there"): a mark, or a click within 6 px of one, takes that part (and the
 * film seeks to it); a click on empty track seeks the film there and keeps the part in hand.
 * Colour = action, a ring = the cursor, faded = a verdict is in, an orange edge = redo; the amber
 * line is the film's playhead.
 */
export const WINDOW_SEC = 90;
const NEAR_PX = 6;
const PLAYHEAD_MS = 250;
const pct = (v) => `${Math.max(0, Math.min(100, v * 100))}%`;

function Lane({ name, label, title, rows, from, span, selectedId, onSelect, now }) {
  const track = useRef(null);
  const pick = (e) => {
    if (e.target.closest?.('[data-mark]')) return;
    const box = track.current?.getBoundingClientRect();
    if (!box?.width) return;
    const x = Math.min(Math.max(e.clientX - box.left, 0), box.width);
    const t = from + (x / box.width) * span;
    // The nearest mark within reach takes the click; otherwise the film goes to that time.
    let best = null;
    for (const r of rows) {
      const a = ((r.in - from) / span) * box.width;
      const b = (((Number.isFinite(r.out) ? r.out : r.in) - from) / span) * box.width;
      const d = x < a ? a - x : x > b ? x - b : 0;
      if (d <= NEAR_PX && (!best || d < best.d)) best = { r, d };
    }
    if (best) onSelect(best.r);
    else previewStore.seekTo(Math.round(t * 10) / 10);
  };
  return (
    <div className="cf-timeline__lane" data-lane={name}>
      <span className="cf-timeline__label" title={title}>{label}</span>
      <div className="cf-timeline__track" ref={track} onClick={pick} onMouseDown={(e) => e.preventDefault()} title={title}>
        {rows.map((r) => {
          const out = Number.isFinite(r.out) ? r.out : r.in;
          const cls = ['cf-timeline__mark', plays(r) ? 'is-plays' : `is-${rowAction(r) || 'other'}`,
            r.id === selectedId ? 'is-cursor' : '', r.verdict?.verdict === 'redo' ? 'is-redo' : '',
            r.verdict || r.reviewed ? 'has-verdict' : ''].filter(Boolean).join(' ');
          return (
            <button key={r.id} type="button" tabIndex={-1} data-mark={r.id} className={cls}
              aria-label={`${r.label}, ${timecode(r.in)}`} title={`${r.label} ${timecode(r.in)}–${timecode(out)}`}
              style={{ left: pct((r.in - from) / span), width: `max(4px, ${pct((out - r.in) / span)})` }}
              onMouseDown={(e) => e.preventDefault()} onClick={() => onSelect(r)} />
          );
        })}
        {now != null && now >= from && now <= from + span ? <span className="cf-timeline__playhead" style={{ left: pct((now - from) / span) }} /> : null}
      </div>
    </div>
  );
}

export function ReviewTimeline({ rows = [], selectedId = null, onSelect = () => {} }) {
  const [now, setNow] = useState(() => previewStore.currentTime());
  const [length, setLength] = useState(() => previewStore.duration());
  useEffect(() => {
    const timer = setInterval(() => { setNow(previewStore.currentTime()); setLength(previewStore.duration()); }, PLAYHEAD_MS);
    return () => clearInterval(timer);
  }, []);
  if (!rows.length) return <Text size="sm" c="dimmed">Nothing in this view. Change the filters.</Text>;
  // The Film lane is the whole film, to its real end once the player knows it (it used to stop at the last part).
  const end = Math.max(1, length || 0, ...rows.map((r) => (Number.isFinite(r.out) ? r.out : r.in)));
  const cursor = rows.find((r) => r.id === selectedId) || null;
  const centre = cursor ? cursor.in : Math.min(...rows.map((r) => r.in));
  const from = Math.max(0, Math.min(centre - WINDOW_SEC / 2, Math.max(0, end - WINDOW_SEC)));
  const near = rows.filter((r) => r.in >= from && r.in <= from + WINDOW_SEC);
  return (
    <div className="cf-timeline" aria-label="Timeline">
      <Lane name="film" label="Film" title={`The whole film, 0:00–${timecode(end)}`} rows={rows} from={0} span={end} selectedId={selectedId} onSelect={onSelect} now={now} />
      <Lane name="window" label="Near" title={`${timecode(from)}–${timecode(from + WINDOW_SEC)}`} rows={near} from={from} span={WINDOW_SEC} selectedId={selectedId} onSelect={onSelect} now={now} />
    </div>
  );
}

export default ReviewTimeline;
