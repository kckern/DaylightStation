import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import RangeHandleLayer from './RangeHandleLayer.jsx';

// jsdom implements neither pointer capture API; the component calls them
// optionally, but stubbing them keeps the drag path identical to a real browser's
// (capture-on-handle) rather than silently exercising a no-capture variant.
beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

/**
 * This jsdom has no `PointerEvent` constructor, so `fireEvent.pointerDown(el,
 * { clientX })` builds a plain Event and silently DROPS clientX/clientY/pointerId
 * — a drag test written that way passes vacuously (every move looks like a
 * zero-distance wobble). Build the Event and assign the pointer props ourselves;
 * React reads them off the native event. Same helper shape as GainStrip's tests.
 */
const pointerEvent = (type, { pointerId = 1, clientX = 0, clientY = 0 } = {}) => {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { pointerId, clientX, clientY });
  return ev;
};
const pDown = (el, init) => fireEvent(el, pointerEvent('pointerdown', init));
const pMove = (el, init) => fireEvent(el, pointerEvent('pointermove', init));
const pUp = (el, init) => fireEvent(el, pointerEvent('pointerup', init));
const pCancel = (el, init) => fireEvent(el, pointerEvent('pointercancel', init));

// One system, four steps at x = 100/200/300/400; two measures of two steps each.
const stepBoxes = [
  { x: 100, top: 100, bottom: 160 }, { x: 200, top: 100, bottom: 160 },
  { x: 300, top: 100, bottom: 160 }, { x: 400, top: 100, bottom: 160 },
];
const measures = [
  { index: 0, firstStep: 0, lastStep: 1 }, { index: 1, firstStep: 2, lastStep: 3 },
];

const mount = (props = {}) => render(
  <RangeHandleLayer
    measures={measures}
    stepBoxes={stepBoxes}
    range={{ inMeasure: 0, outMeasure: 1 }}
    onArm={vi.fn()}
    onCommit={vi.fn()}
    {...props}
  />,
);
const handleIn = (c) => c.querySelector('.piano-score-range-handle--in');
const handleOut = (c) => c.querySelector('.piano-score-range-handle--out');

describe('RangeHandleLayer', () => {
  it('renders both handles at the range extents', () => {
    const { container } = mount();
    expect(handleIn(container)).not.toBeNull();
    expect(handleOut(container)).not.toBeNull();
    // in-handle straddles the in-measure's LEFT extent (100); out-handle the
    // out-measure's RIGHT extent (400) — both inset by half their width.
    expect(handleIn(container).style.left).toBe('76px');
    expect(handleOut(container).style.left).toBe('376px');
  });

  it('exposes each handle as a slider naming its edge and 1-based measure', () => {
    const { container } = mount({ range: { inMeasure: 0, outMeasure: 1 } });
    const i = handleIn(container);
    const o = handleOut(container);
    expect(i.getAttribute('role')).toBe('slider');
    expect(i.getAttribute('aria-label')).toBe('Loop start handle');
    expect(i.getAttribute('aria-valuenow')).toBe('1');
    expect(o.getAttribute('aria-label')).toBe('Loop end handle');
    expect(o.getAttribute('aria-valuenow')).toBe('2');
  });

  it('a still tap arms the edge', () => {
    const onArm = vi.fn();
    const onCommit = vi.fn();
    const { container } = mount({ onArm, onCommit });
    const h = handleIn(container);
    pDown(h, { pointerId: 1, clientX: 100, clientY: 130 });
    pUp(h, { pointerId: 1, clientX: 102, clientY: 131 });
    expect(onArm).toHaveBeenCalledWith('in');
    expect(onCommit).not.toHaveBeenCalled(); // a tap is an ARM, never a commit
  });

  it('a drag previews and commits the nearest measure', () => {
    const onCommit = vi.fn(); const onPreview = vi.fn(); const onArm = vi.fn();
    const { container } = mount({ onCommit, onPreview, onArm });
    const h = handleOut(container);
    pDown(h, { pointerId: 1, clientX: 400, clientY: 130 });
    pMove(h, { pointerId: 1, clientX: 110, clientY: 130 });
    pUp(h, { pointerId: 1, clientX: 110, clientY: 130 });
    expect(onPreview).toHaveBeenCalledWith('out', 0);
    expect(onCommit).toHaveBeenCalledWith('out', 0, 'drag');
    expect(onArm).not.toHaveBeenCalled(); // a drag is not a tap
  });

  it('captures the pointer on the handle for the duration of the drag', () => {
    // Without capture, a finger that outruns the 48px grip mid-drag stops delivering
    // moves to it and the handle silently comes off the finger — the one thing a
    // drag gesture on glass must never do. Nothing in the OUTPUT of a drag reveals
    // whether capture was taken, so assert the call itself.
    Element.prototype.setPointerCapture.mockClear();
    Element.prototype.releasePointerCapture.mockClear();
    const { container } = mount();
    const h = handleOut(container);
    pDown(h, { pointerId: 7, clientX: 400, clientY: 130 });
    expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(7);
    pMove(h, { pointerId: 7, clientX: 110, clientY: 130 });
    pUp(h, { pointerId: 7, clientX: 110, clientY: 130 });
    // No explicit release, by design: the browser drops implicit capture on
    // pointerup/pointercancel itself, so calling releasePointerCapture would be
    // dead code — and calling it on an already-released pointer throws.
    expect(Element.prototype.releasePointerCapture).not.toHaveBeenCalled();
  });

  it('previews once per measure crossed, not once per move', () => {
    const onPreview = vi.fn();
    const { container } = mount({ onPreview });
    const h = handleOut(container);
    pDown(h, { pointerId: 1, clientX: 400, clientY: 130 });
    pMove(h, { pointerId: 1, clientX: 320, clientY: 130 }); // still m2
    pMove(h, { pointerId: 1, clientX: 300, clientY: 130 }); // still m2
    pMove(h, { pointerId: 1, clientX: 190, clientY: 130 }); // → m1
    pMove(h, { pointerId: 1, clientX: 110, clientY: 130 }); // still m1
    expect(onPreview.mock.calls.filter(([, mi]) => mi != null)).toEqual([['out', 1], ['out', 0]]);
  });

  it('the handle tracks the pointer sub-measure while dragging, then re-snaps on release', () => {
    const { container } = mount();
    const h = handleOut(container);
    pDown(h, { pointerId: 1, clientX: 400, clientY: 130 });
    pMove(h, { pointerId: 1, clientX: 263, clientY: 130 });
    expect(handleOut(container).style.left).toBe('239px'); // follows the finger, not the grid
    pUp(h, { pointerId: 1, clientX: 263, clientY: 130 });
    // Released: geometry comes from `range` again (the parent owns the commit).
    expect(handleOut(container).style.left).toBe('376px');
  });

  it('never dead-zones between systems — a pointer in the gutter falls to the nearest system', () => {
    // Two systems: steps 0-1 on top (top 100), steps 2-3 wrapped below (top 400).
    const boxes = [
      { x: 100, top: 100, bottom: 160 }, { x: 200, top: 100, bottom: 160 },
      { x: 100, top: 400, bottom: 460 }, { x: 200, top: 400, bottom: 460 },
    ];
    const onPreview = vi.fn();
    const { container } = render(
      <RangeHandleLayer
        measures={measures}
        stepBoxes={boxes}
        range={{ inMeasure: 0, outMeasure: 1 }}
        onArm={vi.fn()}
        onCommit={vi.fn()}
        onPreview={onPreview}
      />,
    );
    const h = handleOut(container);
    pDown(h, { pointerId: 1, clientX: 200, clientY: 430 });
    // y = 280: below system 1's band (160+40) and above system 2's (400−40) —
    // the armed-TAP rule would refuse this; a drag must not.
    pMove(h, { pointerId: 1, clientX: 100, clientY: 280 });
    expect(onPreview).toHaveBeenCalledWith('out', 0);
  });

  it('auto-scrolls the container when the drag nears its top or bottom edge', () => {
    const scrollRef = { current: { scrollTop: 100, getBoundingClientRect: () => ({ top: 0, bottom: 600, left: 0, right: 800 }) } };
    const { container } = mount({ scrollRef });
    const h = handleOut(container);
    pDown(h, { pointerId: 1, clientX: 400, clientY: 130 });
    pMove(h, { pointerId: 1, clientX: 400, clientY: 20 }); // inside the top zone
    expect(scrollRef.current.scrollTop).toBe(88);
    pMove(h, { pointerId: 1, clientX: 400, clientY: 580 }); // …and the bottom zone
    expect(scrollRef.current.scrollTop).toBe(100);
    pMove(h, { pointerId: 1, clientX: 400, clientY: 300 }); // mid-container: no scroll
    expect(scrollRef.current.scrollTop).toBe(100);
  });

  it('a cancelled drag commits nothing, arms nothing, and reports the drag ended', () => {
    const onArm = vi.fn(); const onCommit = vi.fn(); const onPreview = vi.fn();
    const { container } = mount({ onArm, onCommit, onPreview });
    const h = handleOut(container);
    pDown(h, { pointerId: 1, clientX: 400, clientY: 130 });
    pMove(h, { pointerId: 1, clientX: 110, clientY: 130 });
    pCancel(h, { pointerId: 1, clientX: 110, clientY: 130 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onArm).not.toHaveBeenCalled();
    // The parent shows section markers while a drag is live, so the END of a drag
    // must be announced even when nothing was committed (a stuck flag would leave
    // the markers on the score forever).
    expect(onPreview).toHaveBeenLastCalledWith('out', null);
    expect(handleOut(container).style.left).toBe('376px'); // …and the handle snaps back
    // A later pointerup with no live drag must be inert (no phantom arm).
    pUp(h, { pointerId: 1, clientX: 110, clientY: 130 });
    expect(onArm).not.toHaveBeenCalled();
  });

  it('announces the drag end after a committed drag too', () => {
    const onPreview = vi.fn();
    const { container } = mount({ onPreview });
    const h = handleIn(container);
    pDown(h, { pointerId: 1, clientX: 100, clientY: 130 });
    pMove(h, { pointerId: 1, clientX: 390, clientY: 130 });
    pUp(h, { pointerId: 1, clientX: 390, clientY: 130 });
    expect(onPreview).toHaveBeenLastCalledWith('in', null);
  });

  it('swallows the gesture so a handle press never reaches the score behind it', () => {
    const onPointerDown = vi.fn(); const onClick = vi.fn();
    const { container } = render(
      <div onPointerDown={onPointerDown} onClick={onClick}>
        <RangeHandleLayer measures={measures} stepBoxes={stepBoxes} range={{ inMeasure: 0, outMeasure: 1 }} onArm={vi.fn()} onCommit={vi.fn()} />
      </div>,
    );
    const h = handleIn(container);
    pDown(h, { pointerId: 1, clientX: 100, clientY: 130 });
    fireEvent.click(h, { clientX: 100, clientY: 130 });
    expect(onPointerDown).not.toHaveBeenCalled(); // …so tap-to-seek never fires under a handle
    expect(onClick).not.toHaveBeenCalled();
  });

  it('spreads the grips of a one-onset range so neither can occlude the other', () => {
    // §F's very first commit plants a ONE-measure range, and a measure with a single
    // onset has left === right: both grips would land on the same x, where the
    // later-painted `out` covers `in` completely and the in-point becomes
    // untouchable. They must share the boundary, not stack on it.
    const boxes = [{ x: 200, top: 100, bottom: 160 }];
    const oneMeasure = [{ index: 0, firstStep: 0, lastStep: 0 }];
    const onArm = vi.fn();
    const { container } = render(
      <RangeHandleLayer
        measures={oneMeasure}
        stepBoxes={boxes}
        range={{ inMeasure: 0, outMeasure: 0 }}
        onArm={onArm}
        onCommit={vi.fn()}
      />,
    );
    const i = handleIn(container);
    const o = handleOut(container);
    const gap = parseFloat(o.style.left) - parseFloat(i.style.left);
    expect(gap).toBeGreaterThanOrEqual(24); // …at least half a grip of each is exposed
    // And both are really reachable, not merely offset in the style attribute.
    pDown(i, { pointerId: 1, clientX: 176, clientY: 130 });
    pUp(i, { pointerId: 1, clientX: 176, clientY: 130 });
    pDown(o, { pointerId: 2, clientX: 224, clientY: 130 });
    pUp(o, { pointerId: 2, clientX: 224, clientY: 130 });
    expect(onArm.mock.calls).toEqual([['in'], ['out']]);
  });

  it('leaves a roomy range’s grips on their own boundaries', () => {
    // The spread is a collision fix, not a layout rule: whenever the ends are far
    // enough apart each grip must still straddle the exact boundary it marks.
    const { container } = mount();
    expect(handleIn(container).style.left).toBe('76px');   // in-measure's left, 100
    expect(handleOut(container).style.left).toBe('376px'); // out-measure's right, 400
  });

  it('no range renders nothing', () => {
    const { container } = mount({ range: null });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the range names measures the engraving does not have', () => {
    const { container } = mount({ range: { inMeasure: 0, outMeasure: 7 } });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing without geometry', () => {
    const { container } = mount({ stepBoxes: [] });
    expect(container.firstChild).toBeNull();
  });
});
