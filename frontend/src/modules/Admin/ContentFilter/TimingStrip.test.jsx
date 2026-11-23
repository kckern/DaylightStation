import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// The timing strip (owner, 2026-11-22: "a mini timeline with handlebars i can drag").
const calls = [];
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: async (path, body, method) => { calls.push({ path, body, method }); return {}; } }));
const { previewStore } = await import('../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs');
const { TimingStrip, fineTimecode, spanText, windowFor } = await import('./TimingStrip.jsx');
const { RowEditor } = await import('./RowEditor.jsx');
const { useReviewKeys } = await import('./useReviewKeys.js');

// jsdom has no layout: the track is 400 px wide from x = 100.
const BOX = { left: 100, top: 0, width: 400, height: 34, right: 500, bottom: 34, x: 100, y: 0, toJSON: () => ({}) };
if (!window.PointerEvent) window.PointerEvent = class PointerEvent extends MouseEvent { constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; } };
const start = () => screen.getByRole('slider', { name: 'Start' });
const end = () => screen.getByRole('slider', { name: 'End' });

function Harness({ initial = [100, 104], disabled = false, onNotice = () => {} }) {
  const [span, setSpan] = useState(initial);
  return <><TimingStrip span={span} saved={initial} onChange={setSpan} onNotice={onNotice} disabled={disabled} /><output>{spanText(span)}</output></>;
}
const show = (props) => render(<Harness {...props} />);
const shown = () => document.querySelector('output').textContent;

beforeEach(() => {
  calls.length = 0;
  vi.restoreAllMocks();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
  vi.spyOn(previewStore, 'currentTime').mockReturnValue(null);
});
afterEach(() => { vi.useRealTimers(); });

describe('the strip shows every part in its window (2026-11-22: two bleeps close together)', () => {
  function Two() {
    const [span, setSpan] = useState([100, 101]);
    const [other, setOther] = useState([102, 103]);
    return <><TimingStrip span={span} saved={[100, 101]} onChange={setSpan}
      neighbours={[{ id: 'cue:n', span: other, saved: [102, 103], editable: true, family: 'audio', label: 'heck' }, { id: 'cue:far', span: [200, 201], saved: [200, 201], editable: true, label: 'far' }]}
      onNeighbourChange={(id, next) => { if (id === 'cue:n') setOther(next); }} /><output>{spanText(other)}</output></>;
  }
  it('draws a neighbour in the window with its own handles, and drags it as a draft', () => {
    render(<Two />);
    expect(document.querySelectorAll('.cf-strip__band.is-neighbour')).toHaveLength(1);
    const nStart = screen.getByRole('slider', { name: 'heck: Start' });
    // Window 94–107 over 400 px: 30.77 px per second; 102 s is x = 346.2.
    fireEvent.pointerDown(nStart, { clientX: 346, pointerId: 1 });
    fireEvent.pointerMove(nStart, { clientX: 331, pointerId: 1 });
    expect(document.querySelector('output').textContent).toMatch(/^1:41\.\d\d–1:43\.00/);
    fireEvent.pointerUp(nStart, { clientX: 331, pointerId: 1 });
    expect(screen.queryByRole('slider', { name: 'far: Start' })).toBeNull();
  });
});

describe('close parts never steal each other\'s handles, nor cross (review 2026-11-22)', () => {
  function Close() {
    const [span, setSpan] = useState([100, 101]);
    const [other, setOther] = useState([101.2, 102]);
    return <><TimingStrip span={span} saved={[100, 101]} onChange={setSpan}
      neighbours={[{ id: 'cue:n', span: other, saved: [101.2, 102], editable: true, family: 'audio', label: 'heck' }]}
      onNeighbourChange={(id, next) => setOther(next)} /><output data-x="own">{spanText(span)}</output><output data-x="n">{spanText(other)}</output></>;
  }
  const out = (k) => document.querySelector(`output[data-x="${k}"]`).textContent;
  it('a press takes the nearest edge, and a drag stops at the next part', () => {
    render(<Close />);
    // Window 94–107 over 400 px: 30.77 px per second. Own end 101 at x = 315.4; neighbour start 101.2 at x = 321.5.
    const track = document.querySelector('.cf-strip__track');
    fireEvent.pointerDown(track, { clientX: 321, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 336, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 336, pointerId: 1 });
    expect(out('own')).toBe('1:40.00–1:41.00, 1 s');
    expect(out('n')).toMatch(/^1:41\.[3-9]\d/);
    // Own end dragged right stops at the neighbour's start.
    fireEvent.pointerDown(track, { clientX: 315, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 390, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 390, pointerId: 1 });
    const nStart = Number(screen.getByRole('slider', { name: 'heck: Start' }).getAttribute('aria-valuenow'));
    expect(Number(end().getAttribute('aria-valuenow'))).toBeLessThanOrEqual(nStart);
  });
  it('Tab walks the handles in time order', () => {
    render(<Close />);
    expect([...document.querySelectorAll('[role="slider"]')].map((n) => n.getAttribute('aria-label'))).toEqual(['Start', 'End', 'heck: Start', 'heck: End']);
  });
});

describe('dragging feels exact (2026-11-22: "check the handlebars")', () => {
  it('a grab off-centre keeps its offset: the edge does not jump to the pointer', () => {
    show();
    // Start is 100 s at x = 250; grab 6 px right of it and do not move: nothing changes.
    fireEvent.pointerDown(start(), { clientX: 256, pointerId: 1 });
    fireEvent.pointerMove(start(), { clientX: 256, pointerId: 1 });
    expect(shown()).toBe('1:40.00–1:44.00, 4 s');
    fireEvent.pointerMove(start(), { clientX: 231, pointerId: 1 });
    expect(shown()).toBe('1:39.00–1:44.00, 5 s');
  });
  it('shows the time in a bubble while dragging, and the film follows the handle', () => {
    const seek = vi.spyOn(previewStore, 'seekTo');
    show();
    fireEvent.pointerDown(start(), { clientX: 250, pointerId: 1 });
    fireEvent.pointerMove(start(), { clientX: 225, pointerId: 1 });
    expect(document.querySelector('.cf-strip__bubble').textContent).toBe('1:39.00');
    expect(seek).toHaveBeenCalledWith(99);
    fireEvent.pointerUp(start(), { clientX: 225, pointerId: 1 });
    expect(document.querySelector('.cf-strip__bubble')).toBeNull();
  });
});

describe('timing strip helpers', () => {
  it('shows hundredths, and the span with its length', () => {
    expect(fineTimecode(2664.3)).toBe('44:24.30');
    expect(spanText([2664.3, 2665.1])).toBe('44:24.30–44:25.10, 0.8 s');
  });
  it('the window is the part ± 6 s, ± half of a long part, at least 12 s, never before 0', () => {
    expect(windowFor([100, 104])).toEqual([94, 110]);
    expect(windowFor([100, 160])).toEqual([70, 190]);
    expect(windowFor([2, 2.5])).toEqual([0, 13]);
  });
});

describe('TimingStrip', () => {
  it('a handle dragged with the pointer does not keep the keyboard', () => {
    show();
    start().focus();
    fireEvent.pointerDown(start(), { clientX: 250, pointerId: 1 });
    fireEvent.pointerMove(start(), { clientX: 225, pointerId: 1 });
    fireEvent.pointerUp(start(), { clientX: 225, pointerId: 1 });
    expect(document.activeElement).not.toBe(start());
    // The mouse press itself takes no focus either.
    expect(fireEvent.mouseDown(end())).toBe(false);
  });
  it('a tick at the right edge carries no label (it ran over the readout)', () => {
    show();
    // Window 94–110: the 1:50 tick sits on the right edge.
    expect([...document.querySelectorAll('.cf-strip__label')].map((n) => n.textContent)).toEqual(['1:35', '1:40', '1:45']);
    expect(document.querySelectorAll('.cf-strip__tick.is-major').length).toBe(4);
  });
  it('times from an hour on read h:mm:ss', () => {
    expect(fineTimecode(3797.04)).toBe('1:03:17.04');
  });
  it('two handles are sliders with their time; ticks every second, a label every 5 s', () => {
    show();
    expect(start().getAttribute('aria-valuenow')).toBe('100');
    expect(end().getAttribute('aria-valuenow')).toBe('104');
    expect(end().getAttribute('aria-valuetext')).toBe('1:44.00');
    expect(document.querySelectorAll('.cf-strip__tick').length).toBe(17);
    expect([...document.querySelectorAll('.cf-strip__label')].map((n) => n.textContent)).toEqual(['1:35', '1:40', '1:45']);
  });
  it('dragging a handle moves that edge to the pointer', () => {
    show();
    // Window 94–110 over 400 px: 25 px per second. x = 225 is 99 s.
    fireEvent.pointerDown(start(), { clientX: 250, pointerId: 1 });
    fireEvent.pointerMove(start(), { clientX: 225, pointerId: 1 });
    expect(shown()).toBe('1:39.00–1:44.00, 5 s');
    fireEvent.pointerUp(start(), { clientX: 225, pointerId: 1 });
    // After release the pointer no longer moves it.
    fireEvent.pointerMove(start(), { clientX: 150, pointerId: 1 });
    expect(shown()).toBe('1:39.00–1:44.00, 5 s');
    fireEvent.pointerDown(end(), { clientX: 350, pointerId: 1 });
    fireEvent.pointerMove(end(), { clientX: 375, pointerId: 1 });
    expect(shown()).toBe('1:39.00–1:45.00, 6 s');
  });
  it('the start cannot pass the end: it stops 0.05 s short', () => {
    show();
    fireEvent.pointerDown(start(), { clientX: 250, pointerId: 1 });
    fireEvent.pointerMove(start(), { clientX: 480, pointerId: 1 });
    expect(start().getAttribute('aria-valuenow')).toBe('103.95');
  });
  it('a handle dragged to the edge widens the window when it is let go', () => {
    show();
    fireEvent.pointerDown(end(), { clientX: 350, pointerId: 1 });
    fireEvent.pointerMove(end(), { clientX: 900, pointerId: 1 });
    expect(end().getAttribute('aria-valuenow')).toBe('110');
    fireEvent.pointerUp(end(), { clientX: 900, pointerId: 1 });
    expect(end().getAttribute('aria-valuemax')).toBe('113');
  });
  it('← → move a focused handle by 0.1 s, with Shift by 0.5 s', () => {
    show();
    fireEvent.keyDown(start(), { key: 'ArrowLeft' });
    fireEvent.keyDown(start(), { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(end(), { key: 'ArrowRight' });
    expect(shown()).toBe('1:39.40–1:44.10, 4.7 s');
  });
  it('Home / End put a handle at the playhead; with no film playing it says so', () => {
    const onNotice = vi.fn();
    show({ onNotice });
    fireEvent.keyDown(start(), { key: 'Home' });
    expect(onNotice).toHaveBeenCalledWith('Play the film first.');
    previewStore.currentTime.mockReturnValue(101.25);
    fireEvent.keyDown(start(), { key: 'Home' });
    expect(shown()).toBe('1:41.25–1:44.00, 2.75 s');
  });
  it('draws the playhead while it is inside the window, and a click on the strip seeks there', () => {
    vi.useFakeTimers();
    const seek = vi.spyOn(previewStore, 'seekTo').mockImplementation(() => {});
    show();
    expect(screen.queryByTestId('playhead')).toBeNull();
    previewStore.currentTime.mockReturnValue(102);
    act(() => { vi.advanceTimersByTime(120); });
    expect(screen.getByTestId('playhead').style.left).toBe('50%');
    fireEvent.click(document.querySelector('.cf-strip__track'), { clientX: 200 });
    expect(seek).toHaveBeenCalledWith(98);
  });
  it('disabled (a run holds the film): the handles do not move', () => {
    show({ disabled: true });
    fireEvent.pointerDown(start(), { clientX: 250, pointerId: 1 });
    fireEvent.pointerMove(start(), { clientX: 225, pointerId: 1 });
    fireEvent.keyDown(end(), { key: 'ArrowRight' });
    expect(shown()).toBe('1:40.00–1:44.00, 4 s');
    expect(start().getAttribute('aria-disabled')).toBe('true');
    expect(start().tabIndex).toBe(-1);
  });
});

describe('the strip in the part card', () => {
  const word = { id: 'cue:w1', peekId: 'w1', members: ['w1'], kind: 'words', group: 'profanity', label: 'damn', modality: 'said', in: 100, out: 104, effect: 'mute', card: null, handFixed: true, unsure: [], reviewed: null, timing: 'refined' };
  const card = (props = {}) => render(<MantineProvider><RowEditor ratingKey="77" row={word} {...props} /></MantineProvider>);
  it('replaces the nudge buttons; Save timing is enabled only once the span changed, and posts the nudge', async () => {
    card();
    expect(screen.queryByRole('button', { name: 'Start here' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Start [+-]/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Save timing/ }).disabled).toBe(true);
    fireEvent.pointerDown(end(), { clientX: 350, pointerId: 1 });
    fireEvent.pointerMove(end(), { clientX: 370, pointerId: 1 });
    fireEvent.pointerUp(end(), { clientX: 370, pointerId: 1 });
    expect(end().getAttribute('aria-valuetext')).toBe('1:44.80');
    fireEvent.click(screen.getByRole('button', { name: /^Save timing/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/cues/w1', body: { nudge: { in: 100, out: 104.8 } }, method: 'PUT' });
  });
  it('Reset (the hand fix dropped) still posts a null nudge', async () => {
    card();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ nudge: null });
  });
  it('while a run holds the film the strip and Save are locked', () => {
    card({ busyText: 'A refine is running.' });
    fireEvent.keyDown(end(), { key: 'ArrowRight' });
    expect(end().getAttribute('aria-valuetext')).toBe('1:44.00');
    expect(screen.getByRole('button', { name: /^Save timing/ }).disabled).toBe(true);
  });
  it('a focused handle keeps ← → from the station keys (they step parts everywhere else)', () => {
    const next = vi.fn();
    function Station() { useReviewKeys({ next, prev: next }); return <RowEditor ratingKey="77" row={word} />; }
    render(<MantineProvider><Station /></MantineProvider>);
    end().focus();
    fireEvent.keyDown(end(), { key: 'ArrowRight' });
    expect(next).not.toHaveBeenCalled();
    expect(end().getAttribute('aria-valuetext')).toBe('1:44.10');
    end().blur();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
