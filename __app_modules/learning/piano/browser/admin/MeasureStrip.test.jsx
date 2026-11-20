import React, { useReducer, useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import MeasureStrip from "./MeasureStrip.jsx";
import { initSegmentEditor, segmentEditorReducer } from "./segmentEditor.js";

// Printed numbers start at 0 (a pickup) so labels and positions differ.
const MEASURES = Array.from({ length: 8 }, (_, i) => ({ index: i, number: i, firstStep: i, lastStep: i }));

function Harness({ segments, onAction }) {
  const [state, dispatch] = useReducer(segmentEditorReducer, { segments, measureCount: MEASURES.length }, initSegmentEditor);
  const [selectedId, setSelectedId] = useState(null);
  const spy = (action) => { onAction(action); dispatch(action); };
  return (
    <>
      <MeasureStrip
        measures={MEASURES}
        segments={state.segments}
        editable
        dispatch={spy}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <output data-testid="state">{JSON.stringify(state.segments.map(({ id, start, end, name }) => [id, start, end, name ?? null]))}</output>
    </>
  );
}

const renderStrip = (segments, extra = {}) => {
  const onAction = vi.fn();
  render(<MantineProvider><Harness segments={segments} onAction={onAction} {...extra} /></MantineProvider>);
  return onAction;
};
const state = () => JSON.parse(screen.getByTestId('state').textContent);

afterEach(cleanup);

// jsdom has no PointerEvent; without one fireEvent drops clientX.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  };
}

describe('MeasureStrip', () => {
  it('labels cells with printed numbers and splits at a barline gap', () => {
    const onAction = renderStrip([{ id: 'a', start: 0, end: 7 }]);
    expect(screen.getByText('0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Split after bar 3' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'split', atBarline: 3 });
    expect(state()).toEqual([['a', 0, 3, null], ['b', 4, 7, null]]);
    // The gap after the last bar has no control.
    expect(screen.queryByRole('button', { name: 'Split after bar 7' })).toBeNull();
  });

  it('shows a boundary handle between touching segments, moved with the arrow keys', () => {
    const onAction = renderStrip([{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 }]);
    const handle = screen.getByRole('button', { name: 'Move boundary after bar 3' });
    expect(handle.getAttribute('aria-keyshortcuts')).toBe('ArrowLeft ArrowRight');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'moveBoundary', leftId: 'a', newEnd: 4 });
    expect(state()).toEqual([['a', 0, 4, null], ['b', 5, 7, null]]);
    const moved = screen.getByRole('button', { name: 'Move boundary after bar 4' });
    expect(document.activeElement).toBe(moved); // focus follows the boundary
    fireEvent.keyDown(moved, { key: 'ArrowLeft' });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'moveBoundary', leftId: 'a', newEnd: 3 });
  });

  it('drags a boundary to the barline nearest the pointer', () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rectOf() {
      const k = this.getAttribute?.('data-measure-cell');
      const right = k == null ? 0 : (Number(k) + 1) * 40;
      return { left: right - 40, right, top: 0, bottom: 20, width: 40, height: 20, x: right - 40, y: 0 };
    });
    try {
      const onAction = renderStrip([{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 }]);
      const handle = screen.getByRole('button', { name: 'Move boundary after bar 3' });
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 160 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 83 }); // nearest barline: after cell 1 (x = 80)
      expect(onAction).toHaveBeenLastCalledWith({ type: 'moveBoundary', leftId: 'a', newEnd: 1 });
      fireEvent.pointerUp(window, { pointerId: 1 });
      expect(state()).toEqual([['a', 0, 1, null], ['b', 2, 7, null]]);
      const calls = onAction.mock.calls.length;
      fireEvent.pointerMove(screen.getByTestId('measure-strip-draft').querySelector('.sm-strip__grid'), { clientX: 240 });
      expect(onAction.mock.calls.length).toBe(calls); // no drag after pointer up
    } finally {
      rect.mockRestore();
    }
  });

  it('band actions merge, rename and remove', () => {
    const onAction = renderStrip([{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Segment 1, Bars 0-3' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Name')); // keyboard lands on the actions
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Opening' } });
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'rename', id: 'a', name: 'Opening' });
    fireEvent.click(screen.getByRole('button', { name: 'Merge with Segment 2' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'merge', id: 'a' });
    expect(state()).toEqual([['a', 0, 7, 'Opening']]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove segment 1' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'remove', id: 'a' });
    expect(state()).toEqual([]);
  });

  it('hatches uncovered bars and offers no controls when read-only', () => {
    render(
      <MantineProvider>
        <MeasureStrip measures={MEASURES} segments={[{ id: 'a', start: 1, end: 7 }]} variant="approved" />
      </MantineProvider>,
    );
    const cell = document.querySelector('[data-measure-cell="0"]');
    expect(cell.className).toContain('sm-strip__cell--uncovered');
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByRole('img', { name: 'Segment 1, Bars 1-7' })).toBeTruthy();
  });

  it('labels bands by position, with the name when there is one', () => {
    renderStrip([{ id: 'q', start: 0, end: 3, name: 'Theme' }, { id: 'c', start: 4, end: 7 }]);
    expect(screen.getByRole('button', { name: 'Theme, Bars 0-3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Segment 2, Bars 4-7' })).toBeTruthy();
  });

  it('removes a segment and covers the gap again with Add segment', () => {
    const onAction = renderStrip([{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Segment 2, Bars 4-7' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove segment 2' }));
    expect(document.querySelector('[data-measure-cell="5"]').className).toContain('sm-strip__cell--uncovered');
    fireEvent.click(screen.getByRole('button', { name: 'Add segment over bars 4-7' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'addSegment', start: 4, end: 7 });
    expect(state()).toEqual([['a', 0, 3, null], ['b', 4, 7, null]]);
  });

  it('offers one Add segment over a fully empty strip', () => {
    const onAction = renderStrip([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add segment over bars 0-7' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'addSegment', start: 0, end: 7 });
    expect(state()).toEqual([['a', 0, 7, null]]);
  });

  it('moves a segment edge into and out of a neighbouring gap', () => {
    const onAction = renderStrip([{ id: 'a', start: 0, end: 2 }, { id: 'b', start: 6, end: 7 }]);
    expect(screen.getAllByRole('button', { name: 'Add segment over bars 3-5' })).toHaveLength(1);
    const end = screen.getByRole('button', { name: 'Move end of segment 1 after bar 2' });
    fireEvent.keyDown(end, { key: 'ArrowRight' });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'moveEdge', id: 'a', edge: 'end', to: 3 });
    expect(state()).toEqual([['a', 0, 3, null], ['b', 6, 7, null]]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move end of segment 1 after bar 3' }));
    const start = screen.getByRole('button', { name: 'Move start of segment 2 before bar 6' });
    fireEvent.keyDown(start, { key: 'ArrowLeft' });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'moveEdge', id: 'b', edge: 'start', to: 5 });
    expect(state()).toEqual([['a', 0, 3, null], ['b', 5, 7, null]]);
  });

  it('pulls a final segment\'s end in from after the last bar, and pushes a first start out', () => {
    const onAction = renderStrip([{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 }]);
    const end = screen.getByRole('button', { name: 'Move end of segment 2 after bar 7' });
    expect(end.getAttribute('aria-keyshortcuts')).toBe('ArrowLeft ArrowRight');
    fireEvent.keyDown(end, { key: 'ArrowRight' }); // already at the last bar: nothing to extend into
    expect(state()).toEqual([['a', 0, 3, null], ['b', 4, 7, null]]);
    fireEvent.keyDown(end, { key: 'ArrowLeft' });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'moveEdge', id: 'b', edge: 'end', to: 6 });
    expect(state()).toEqual([['a', 0, 3, null], ['b', 4, 6, null]]);
    expect(document.querySelector('[data-measure-cell="7"]').className).toContain('sm-strip__cell--uncovered');

    const start = screen.getByRole('button', { name: 'Move start of segment 1 before bar 0' });
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'moveEdge', id: 'a', edge: 'start', to: 1 });
    expect(state()).toEqual([['a', 1, 3, null], ['b', 4, 6, null]]);
    // Bar 0 is now a gap; the start handle sits on the barline after it and focus followed.
    const moved = screen.getByRole('button', { name: 'Move start of segment 1 before bar 1' });
    expect(document.activeElement).toBe(moved);
    fireEvent.keyDown(moved, { key: 'ArrowLeft' });
    expect(state()).toEqual([['a', 0, 3, null], ['b', 4, 6, null]]);
  });

  it('drags a first segment\'s start to the barline before bar 0', () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rectOf() {
      const k = this.getAttribute?.('data-measure-cell');
      const right = k == null ? 0 : (Number(k) + 1) * 40;
      return { left: right - 40, right, top: 0, bottom: 20, width: 40, height: 20, x: right - 40, y: 0 };
    });
    try {
      const onAction = renderStrip([{ id: 'a', start: 2, end: 7 }]);
      const handle = screen.getByRole('button', { name: 'Move start of segment 1 before bar 2' });
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 80 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 3 }); // nearest barline: the left edge of bar 0
      expect(onAction).toHaveBeenLastCalledWith({ type: 'moveEdge', id: 'a', edge: 'start', to: 0 });
      fireEvent.pointerUp(window, { pointerId: 1 });
      expect(state()).toEqual([['a', 0, 7, null]]);
    } finally {
      rect.mockRestore();
    }
  });
});
