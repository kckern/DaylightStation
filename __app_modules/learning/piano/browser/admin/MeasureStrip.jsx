import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Button, Group, Text, TextInput, Tooltip } from '@mantine/core';
import { IconArrowsHorizontal, IconGitMerge, IconPlus, IconScissors, IconTrash } from '@tabler/icons-react';

/** How many tint colours the strip and the engraving overlay cycle through. */
export const SEGMENT_COLORS = 6;

/** Printed number of the measure at layout position `i` (the kiosk's own label). */
export const printedNumber = (measures, i) => {
  const value = measures?.[i]?.number;
  return value == null || value === '' ? String(i + 1) : String(value);
};

export const barsLabel = (measures, start, end) => (start === end
  ? `Bar ${printedNumber(measures, start)}`
  : `Bars ${printedNumber(measures, start)}-${printedNumber(measures, end)}`);

/**
 * What a grown-up calls a segment: its name, else its position ("Segment 2"), the
 * way the kiosk labels it. Ids stay internal to the editor.
 */
export const segmentLabel = (segment, index) => segment?.name || `Segment ${index + 1}`;

/** A proposed boundary below this p is drawn as weak. */
export const WEAK_BOUNDARY_P = 0.6;

/** Runs of consecutive measure positions no segment covers, as [start, end]. */
export function uncoveredRuns(segments, measureCount) {
  const covered = new Array(Math.max(measureCount, 0)).fill(false);
  for (const s of segments) {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end)) continue;
    for (let i = Math.max(s.start, 0); i <= Math.min(s.end, measureCount - 1); i += 1) covered[i] = true;
  }
  const runs = [];
  covered.forEach((c, i) => {
    if (c) return;
    const last = runs[runs.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else runs.push([i, i]);
  });
  return runs;
}

/**
 * One cell per layout measure with the segments as bands. Editable strips put a
 * control in every barline gap: a split button inside a segment, a handle between
 * two touching segments, and a handle on a segment edge that borders uncovered bars
 * (drag a handle, or focus it and use the arrow keys). Each run of uncovered bars
 * gets an "Add segment" button that covers it. Selecting a band opens its actions
 * below the strip: rename, merge with the next segment, remove. Every change goes
 * out as a segmentEditor action via `dispatch`.
 */
export default function MeasureStrip({
  measures = [],
  segments = [],
  editable = false,
  dispatch,
  variant = 'draft',
  title,
  errorIds = [],
  selectedId = null,
  onSelect,
  boundaries = null,
}) {
  const gridRef = useRef(null);
  // { kind: 'boundary'|'end'|'start', id } while a handle is being dragged.
  const [drag, setDrag] = useState(null);
  // A moved edge renders its handle in another cell (a new element), so focus
  // follows it by key after a keyboard move.
  const refocusRef = useRef(null);
  const n = measures.length;
  const runs = uncoveredRuns(segments, n);
  const uncoveredSet = new Set(runs.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k)));
  const errorSet = new Set(errorIds);
  const position = (s) => segments.indexOf(s);
  const send = (action) => { if (editable && dispatch) dispatch(action); };
  // Proposed p(phrase ends) per barline after measure k, drawn under the bands.
  const pAt = (k) => {
    const v = boundaries?.[k];
    return Number.isFinite(v) ? v : null;
  };
  const showBoundaries = Boolean(boundaries) && measures.some((_, k) => pAt(k) != null);

  /** The action that puts the dragged/keyed edge at the barline after measure k. */
  const moveTo = (kind, id, k) => (kind === 'boundary'
    ? { type: 'moveBoundary', leftId: id, newEnd: k }
    : { type: 'moveEdge', id, edge: kind, to: kind === 'end' ? k : k + 1 });

  /**
   * Nearest barline to a pointer x, as k = the measure it follows, read from the
   * cells. The left edge of the first cell is k = -1 (before bar 0).
   */
  const nearestBarline = useCallback((clientX) => {
    const cells = gridRef.current?.querySelectorAll('[data-measure-cell]') || [];
    let best = null;
    let bestDist = Infinity;
    const consider = (k, x) => {
      const dist = Math.abs(x - clientX);
      if (dist < bestDist) { bestDist = dist; best = k; }
    };
    cells.forEach((cell) => {
      const k = Number(cell.getAttribute('data-measure-cell'));
      const box = cell.getBoundingClientRect();
      if (k === 0) consider(-1, box.left);
      consider(k, box.right);
    });
    return best;
  }, []);

  const onPointerMove = (event) => {
    if (!drag) return;
    const k = nearestBarline(event.clientX);
    const seg = segments.find((s) => s.id === drag.id);
    if (k == null || !seg) return;
    const current = drag.kind === 'start' ? seg.start - 1 : seg.end;
    if (k === current) return;
    send(moveTo(drag.kind, drag.id, k));
  };

  // The handle under the pointer is replaced as the edge moves, so the drag ends on
  // the window's pointerup rather than on the element that started it.
  useEffect(() => {
    if (!drag) return undefined;
    const stop = () => setDrag(null);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [drag]);

  useEffect(() => {
    const key = refocusRef.current;
    if (!key) return;
    refocusRef.current = null;
    gridRef.current?.querySelector(`[data-handle="${CSS.escape(key)}"]`)?.focus();
  });

  const handle = (kind, seg, k, label, leading = false) => {
    const key = `${kind}:${seg.id}`;
    const onKeyDown = (event) => {
      const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      if (!step) return;
      event.preventDefault();
      refocusRef.current = key;
      send(moveTo(kind, seg.id, k + step));
    };
    return (
      <Tooltip label="Drag, or use the arrow keys" withArrow openDelay={400}>
        <button
          type="button"
          className={`sm-strip__handle${kind === 'boundary' ? '' : ' sm-strip__handle--edge'}${leading ? ' sm-strip__handle--leading' : ''}`}
          data-handle={key}
          aria-label={label}
          aria-keyshortcuts="ArrowLeft ArrowRight"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDrag({ kind, id: seg.id });
          }}
          onKeyDown={onKeyDown}
        >
          <IconArrowsHorizontal size={12} />
        </button>
      </Tooltip>
    );
  };

  /** The first segment's start handle on the barline before bar 0. */
  const leadingControl = () => {
    if (!editable || !n) return null;
    const first = segments.find((s) => s.start === 0);
    return first
      ? handle('start', first, -1, `Move start of segment ${position(first) + 1} before bar ${printedNumber(measures, 0)}`, true)
      : null;
  };

  const gapControl = (i) => {
    if (!editable) return null;
    if (i === n - 1) {
      // After the last bar: only the final segment's end, to pull it in.
      const last = segments.find((s) => s.end === i);
      return last ? handle('end', last, i, `Move end of segment ${position(last) + 1} after bar ${printedNumber(measures, i)}`) : null;
    }
    if (i > n - 1) return null;
    const left = segments.find((s) => s.end === i);
    const right = segments.find((s) => s.start === i + 1);
    const bar = printedNumber(measures, i);
    if (left && right) return handle('boundary', left, i, `Move boundary after bar ${bar}`);
    if (left) return handle('end', left, i, `Move end of segment ${position(left) + 1} after bar ${bar}`);
    if (right) return handle('start', right, i, `Move start of segment ${position(right) + 1} before bar ${printedNumber(measures, i + 1)}`);
    if (segments.some((s) => s.start <= i && i < s.end)) {
      return (
        <button
          type="button"
          className="sm-strip__split"
          aria-label={`Split after bar ${bar}`}
          onClick={() => send({ type: 'split', atBarline: i })}
        >
          <IconScissors size={11} />
        </button>
      );
    }
    return null;
  };

  const selected = segments.find((s) => s.id === selectedId) || null;
  const selectedIndex = selected ? position(selected) : -1;
  const next = selected ? segments[selectedIndex + 1] : null;
  const canMerge = Boolean(next && next.start === selected.end + 1);

  return (
    <div className={`sm-strip sm-strip--${variant}`} data-testid={`measure-strip-${variant}`}>
      {title ? <Text size="xs" fw={600} c="dimmed" mb={4}>{title}</Text> : null}
      <div className="sm-strip__scroll">
        <div
          ref={gridRef}
          className={`sm-strip__grid${showBoundaries ? ' sm-strip__grid--boundaries' : ''}`}
          style={{ gridTemplateColumns: `repeat(${Math.max(n, 1)}, minmax(34px, 1fr))` }}
          onPointerMove={onPointerMove}
        >
          {measures.map((m, i) => (
            <div
              key={`cell-${i}`}
              data-measure-cell={i}
              className={`sm-strip__cell${uncoveredSet.has(i) ? ' sm-strip__cell--uncovered' : ''}`}
              style={{ gridColumn: i + 1, gridRow: 1 }}
              title={uncoveredSet.has(i) ? 'Not in any segment' : undefined}
            >
              <span className="sm-strip__number">{printedNumber(measures, i)}</span>
              {i === 0 ? leadingControl() : null}
              {gapControl(i)}
            </div>
          ))}
          {segments.map((s, index) => {
            const inRange = Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end < n && s.end >= s.start;
            if (!inRange) return null;
            const classes = [
              'sm-strip__band',
              `sm-seg-c${index % SEGMENT_COLORS}`,
              s.id === selectedId ? 'sm-strip__band--selected' : '',
              errorSet.has(s.id) ? 'sm-strip__band--error' : '',
            ].filter(Boolean).join(' ');
            const label = `${segmentLabel(s, index)}, ${barsLabel(measures, s.start, s.end)}`;
            const style = { gridColumn: `${s.start + 1} / ${s.end + 2}`, gridRow: 2 };
            return editable ? (
              <button
                key={s.id}
                type="button"
                className={classes}
                style={style}
                aria-label={label}
                aria-pressed={s.id === selectedId}
                onClick={() => onSelect?.(s.id === selectedId ? null : s.id)}
              >
                <span className="sm-strip__band-text">{segmentLabel(s, index)}</span>
              </button>
            ) : (
              <div key={s.id} className={classes} style={style} aria-label={label} role="img">
                <span className="sm-strip__band-text">{segmentLabel(s, index)}</span>
              </div>
            );
          })}
          {showBoundaries ? measures.map((_, k) => {
            const p = pAt(k);
            if (p == null || k >= n - 1) return null;
            const weak = p < WEAK_BOUNDARY_P;
            return (
              <span
                key={`p-${k}`}
                className={`sm-strip__p${weak ? ' sm-strip__p--weak' : ''}`}
                style={{ gridColumn: k + 1, gridRow: 3 }}
                data-boundary={k}
                title={`Phrase end after bar ${printedNumber(measures, k)}: p ${p.toFixed(2)}${weak ? ' (weak)' : ''}`}
              >
                {p >= 1 ? 'mark' : p.toFixed(2).replace(/^0/, '')}
              </span>
            );
          }) : null}
          {editable ? runs.map(([start, end]) => (
            <button
              key={`add-${start}`}
              type="button"
              className="sm-strip__add"
              style={{ gridColumn: `${start + 1} / ${end + 2}`, gridRow: 2 }}
              aria-label={`Add segment over ${barsLabel(measures, start, end).toLowerCase()}`}
              onClick={() => send({ type: 'addSegment', start, end })}
            >
              <IconPlus size={12} />
              <span className="sm-strip__band-text">Add segment</span>
            </button>
          )) : null}
        </div>
      </div>
      {editable && selected ? (
        <SegmentActions
          key={selected.id}
          segment={selected}
          index={selectedIndex}
          measures={measures}
          canMerge={canMerge}
          nextLabel={next ? segmentLabel(next, selectedIndex + 1) : null}
          onRename={(name) => send({ type: 'rename', id: selected.id, name })}
          onMerge={() => send({ type: 'merge', id: selected.id })}
          onRemove={() => { send({ type: 'remove', id: selected.id }); onSelect?.(null); }}
        />
      ) : null}
    </div>
  );
}

function SegmentActions({ segment, index, measures, canMerge, nextLabel, onRename, onMerge, onRemove }) {
  const [name, setName] = useState(segment.name || '');
  const inputRef = useRef(null);
  // Selecting a band moves the keyboard to its actions.
  useEffect(() => { inputRef.current?.focus(); }, []);
  const commit = () => { if ((segment.name || '') !== name.trim()) onRename(name); };
  return (
    <Group className="sm-strip__actions" gap="xs" align="flex-end" mt="xs" wrap="wrap">
      <Text size="sm" fw={600}>{`Segment ${index + 1}`}</Text>
      <Text size="sm" c="dimmed">{barsLabel(measures, segment.start, segment.end)}</Text>
      <TextInput
        ref={inputRef}
        size="xs"
        label="Name"
        placeholder="Optional"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      />
      <Button
        size="xs"
        variant="default"
        leftSection={<IconGitMerge size={14} />}
        disabled={!canMerge}
        onClick={onMerge}
      >
        {canMerge ? `Merge with ${nextLabel}` : 'Merge with next'}
      </Button>
      <ActionIcon variant="default" size="md" aria-label={`Remove segment ${index + 1}`} onClick={onRemove}>
        <IconTrash size={14} />
      </ActionIcon>
    </Group>
  );
}
