import { Text } from '@mantine/core';
import { rowAction } from './reviewScope.js';
import { timecode } from './ReviewList.jsx';

/**
 * Two lanes for the rows in the current scope: the whole film, and a window around the cursor.
 * A mark is a button (click = move the cursor there); colour = action, a ring = the cursor, a dot
 * = a verdict is in, a danger edge = redo. Geometry only; the page owns the cursor.
 */
export const WINDOW_SEC = 90;
const pct = (v) => `${Math.max(0, Math.min(100, v * 100))}%`;

function Lane({ name, label, rows, from, span, selectedId, onSelect }) {
  return (
    <div className="cf-timeline__lane" data-lane={name}>
      <span className="cf-timeline__label">{label}</span>
      <div className="cf-timeline__track">
        {rows.map((r) => {
          const out = Number.isFinite(r.out) ? r.out : r.in;
          const cls = ['cf-timeline__mark', `is-${rowAction(r) || 'other'}`,
            r.id === selectedId ? 'is-cursor' : '', r.verdict?.verdict === 'redo' ? 'is-redo' : '',
            r.verdict || r.reviewed ? 'has-verdict' : ''].filter(Boolean).join(' ');
          return (
            <button key={r.id} type="button" tabIndex={-1} data-mark={r.id} className={cls}
              aria-label={`${r.label}, ${timecode(r.in)}`} title={`${r.label} ${timecode(r.in)}–${timecode(out)}`}
              style={{ left: pct((r.in - from) / span), width: `max(4px, ${pct((out - r.in) / span)})` }}
              onMouseDown={(e) => e.preventDefault()} onClick={() => onSelect(r)} />
          );
        })}
      </div>
    </div>
  );
}

export function ReviewTimeline({ rows = [], selectedId = null, onSelect = () => {} }) {
  if (!rows.length) return <Text size="sm" c="dimmed">Nothing in this view. Change the filters.</Text>;
  const end = Math.max(1, ...rows.map((r) => (Number.isFinite(r.out) ? r.out : r.in)));
  const cursor = rows.find((r) => r.id === selectedId) || null;
  const centre = cursor ? cursor.in : Math.min(...rows.map((r) => r.in));
  const from = Math.max(0, Math.min(centre - WINDOW_SEC / 2, Math.max(0, end - WINDOW_SEC)));
  const near = rows.filter((r) => r.in >= from && r.in <= from + WINDOW_SEC);
  return (
    <div className="cf-timeline" aria-label="Timeline">
      <Lane name="film" label="Film" rows={rows} from={0} span={end} selectedId={selectedId} onSelect={onSelect} />
      <Lane name="window" label={`${timecode(from)}–${timecode(from + WINDOW_SEC)}`} rows={near} from={from} span={WINDOW_SEC} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
}

export default ReviewTimeline;
