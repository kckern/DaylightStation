import React, { useReducer, useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import MeasureStrip from "./MeasureStrip.jsx";
import { initSegmentEditor, segmentEditorReducer } from "./segmentEditor.js";

// Printed numbers start at 0 (a pickup) so labels and positions differ.
const MEASURES = Array.from({ length: 8 }, (_, i) => ({ index: i, number: i, firstStep: i, lastStep: i }));

function Harness({ segments, onAction, uncovered }) {
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
        uncovered={uncovered}
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
    fireEvent.click(screen.getByRole('button', { name: 'Segment a, Bars 0-3' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Opening' } });
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'rename', id: 'a', name: 'Opening' });
    fireEvent.click(screen.getByRole('button', { name: 'Merge with Segment b' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'merge', id: 'a' });
    expect(state()).toEqual([['a', 0, 7, 'Opening']]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove segment a' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'remove', id: 'a' });
    expect(state()).toEqual([]);
  });

  it('hatches uncovered bars and offers no controls when read-only', () => {
    render(
      <MantineProvider>
        <MeasureStrip measures={MEASURES} segments={[{ id: 'a', start: 1, end: 7 }]} uncovered={[0]} variant="approved" />
      </MantineProvider>,
    );
    const cell = document.querySelector('[data-measure-cell="0"]');
    expect(cell.className).toContain('sm-strip__cell--uncovered');
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByRole('img', { name: 'Segment a, Bars 1-7' })).toBeTruthy();
  });
});
