import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Button, Group, Text, TextInput, Tooltip } from '@mantine/core';
import { IconArrowsHorizontal, IconGitMerge, IconScissors, IconTrash } from '@tabler/icons-react';

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

export const segmentLabel = (segment) => segment.name || `Segment ${segment.id}`;

/**
 * One cell per layout measure with the segments as bands. Editable strips put a
 * control in every barline gap: a split button inside a segment, a boundary handle
 * between two touching segments (drag it, or focus it and use the arrow keys).
 * Selecting a band opens its actions below the strip: rename, merge with the next
 * segment, remove. Every change goes out as a segmentEditor action via `dispatch`.
 */
export default function MeasureStrip({
  measures = [],
  segments = [],
  editable = false,
  dispatch,
  variant = 'draft',
  title,
  uncovered = [],
  errorIds = [],
  selectedId = null,
  onSelect,
}) {
  const gridRef = useRef(null);
  const [dragLeftId, setDragLeftId] = useState(null);
  // A moved boundary renders its handle in another cell (a new element), so focus
  // follows it by id after a keyboard move.
  const refocusRef = useRef(null);
  const uncoveredSet = new Set(uncovered);
  const errorSet = new Set(errorIds);
  const n = measures.length;
  const send = (action) => { if (editable && dispatch) dispatch(action); };

  /** The touching pair whose boundary sits after measure `i`, or null. */
  const boundaryAt = (i) => {
    const left = segments.find((s) => s.end === i);
    const right = left && segments.find((s) => s.start === i + 1);
    return right ? left : null;
  };
  const spanning = (i) => segments.find((s) => s.start <= i && i < s.end);

  /** Nearest barline (the gap after measure k) to a pointer x, read from the cells. */
  const nearestBarline = useCallback((clientX) => {
    const cells = gridRef.current?.querySelectorAll('[data-measure-cell]') || [];
    let best = null;
    let bestDist = Infinity;
    cells.forEach((cell) => {
      const k = Number(cell.getAttribute('data-measure-cell'));
      const dist = Math.abs(cell.getBoundingClientRect().right - clientX);
      if (dist < bestDist) { bestDist = dist; best = k; }
    });
    return best;
  }, []);

  const onPointerMove = (event) => {
    if (!dragLeftId) return;
    const k = nearestBarline(event.clientX);
    const left = segments.find((s) => s.id === dragLeftId);
    if (k == null || !left || k === left.end) return;
    send({ type: 'moveBoundary', leftId: dragLeftId, newEnd: k });
  };
  const endDrag = () => setDragLeftId(null);

  // The handle under the pointer is replaced as the boundary moves, so the drag
  // ends on the window's pointerup rather than on the element that started it.
  useEffect(() => {
    if (!dragLeftId) return undefined;
    const stop = () => setDragLeftId(null);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [dragLeftId]);

  useEffect(() => {
    const id = refocusRef.current;
    if (!id) return;
    refocusRef.current = null;
    gridRef.current?.querySelector(`[data-boundary-left="${CSS.escape(id)}"]`)?.focus();
  });

  const handleKey = (left) => (event) => {
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    refocusRef.current = left.id;
    send({ type: 'moveBoundary', leftId: left.id, newEnd: left.end + step });
  };

  const gapControl = (i) => {
    if (!editable || i >= n - 1) return null;
    const left = boundaryAt(i);
    if (left) {
      return (
        <Tooltip label="Drag, or use the arrow keys" withArrow openDelay={400}>
          <button
            type="button"
            className="sm-strip__handle"
            data-boundary-left={left.id}
            aria-label={`Move boundary after bar ${printedNumber(measures, i)}`}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              setDragLeftId(left.id);
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={handleKey(left)}
          >
            <IconArrowsHorizontal size={12} />
          </button>
        </Tooltip>
      );
    }
    if (spanning(i)) {
      return (
        <button
          type="button"
          className="sm-strip__split"
          aria-label={`Split after bar ${printedNumber(measures, i)}`}
          onClick={() => send({ type: 'split', atBarline: i })}
        >
          <IconScissors size={11} />
        </button>
      );
    }
    return null;
  };

  const selected = segments.find((s) => s.id === selectedId) || null;
  const selectedIndex = selected ? segments.indexOf(selected) : -1;
  const next = selected ? segments[selectedIndex + 1] : null;
  const canMerge = Boolean(next && next.start === selected.end + 1);

  return (
    <div className={`sm-strip sm-strip--${variant}`} data-testid={`measure-strip-${variant}`}>
      {title ? <Text size="xs" fw={600} c="dimmed" mb={4}>{title}</Text> : null}
      <div className="sm-strip__scroll">
        <div
          ref={gridRef}
          className="sm-strip__grid"
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
            const label = `${segmentLabel(s)}, ${barsLabel(measures, s.start, s.end)}`;
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
                <span className="sm-strip__band-text">{segmentLabel(s)}</span>
              </button>
            ) : (
              <div key={s.id} className={classes} style={style} aria-label={label} role="img">
                <span className="sm-strip__band-text">{segmentLabel(s)}</span>
              </div>
            );
          })}
        </div>
      </div>
      {editable && selected ? (
        <SegmentActions
          key={selected.id}
          segment={selected}
          measures={measures}
          canMerge={canMerge}
          next={next}
          onRename={(name) => send({ type: 'rename', id: selected.id, name })}
          onMerge={() => send({ type: 'merge', id: selected.id })}
          onRemove={() => { send({ type: 'remove', id: selected.id }); onSelect?.(null); }}
        />
      ) : null}
    </div>
  );
}

function SegmentActions({ segment, measures, canMerge, next, onRename, onMerge, onRemove }) {
  const [name, setName] = useState(segment.name || '');
  const commit = () => { if ((segment.name || '') !== name.trim()) onRename(name); };
  return (
    <Group className="sm-strip__actions" gap="xs" align="flex-end" mt="xs" wrap="wrap">
      <Text size="sm" fw={600}>{`Segment ${segment.id}`}</Text>
      <Text size="sm" c="dimmed">{barsLabel(measures, segment.start, segment.end)}</Text>
      <TextInput
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
        {canMerge ? `Merge with ${segmentLabel(next)}` : 'Merge with next'}
      </Button>
      <ActionIcon variant="default" size="md" aria-label={`Remove segment ${segment.id}`} onClick={onRemove}>
        <IconTrash size={14} />
      </ActionIcon>
    </Group>
  );
}
