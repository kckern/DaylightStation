import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

// Control the OSMD engine layer so we can observe when the (expensive) geometry
// extraction actually runs vs. when it is deferred by `holdExtraction`.
const m = vi.hoisted(() => ({
  engrave: vi.fn(),
  repaint: vi.fn(),
  extract: vi.fn(),
}));

vi.mock('./osmdRender.js', () => ({
  osmdEngrave: (...a) => m.engrave(...a),
  osmdRepaint: (...a) => m.repaint(...a),
  extractLayoutSliced: (...a) => m.extract(...a),
  scheduleYield: (cb) => cb(),
}));

import { MusicXmlRenderer } from './MusicXmlRenderer.jsx';

const RES = { events: [{ midi: 60, x: 1, top: 0, bottom: 10 }], notes: [], steps: [], measures: [], tempoEntries: [] };

beforeEach(() => {
  m.engrave.mockReset();
  m.repaint.mockReset();
  m.extract.mockReset();
  // Fresh engrave returns a fake instance + dims; repaint returns dims; extract
  // returns a layout result.
  m.engrave.mockResolvedValue({ osmd: { id: 'osmd' }, width: 800, height: 400, flow: 'wrapped' });
  m.repaint.mockReturnValue({ width: 800, height: 400, flow: 'wrapped' });
  m.extract.mockResolvedValue(RES);
});

const XML = '<score-partwise/>';

describe('MusicXmlRenderer — holdExtraction defers the geometry walk', () => {
  it('paints but does NOT extract while held, then extracts + publishes on release', async () => {
    const onLayout = vi.fn();
    const onReady = vi.fn();

    const { rerender } = render(
      <MusicXmlRenderer musicXml={XML} width={800} scale={1} holdExtraction onLayout={onLayout} onReady={onReady} />,
    );
    await act(async () => {}); // flush the async render effect

    // PAINT happened (engrave ran) but extraction was deferred.
    expect(m.engrave).toHaveBeenCalledTimes(1);
    expect(m.extract).not.toHaveBeenCalled();
    expect(onLayout).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();

    // Release: the owed extraction now runs (cheap repaint + slice) and publishes.
    rerender(
      <MusicXmlRenderer musicXml={XML} width={800} scale={1} holdExtraction={false} onLayout={onLayout} onReady={onReady} />,
    );
    await act(async () => {});

    expect(m.extract).toHaveBeenCalledTimes(1);
    expect(onLayout).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    // `scale` is published so the consumer can detect a stale (pre-zoom) layout.
    expect(onLayout.mock.calls[0][0]).toMatchObject({ flow: 'wrapped', scale: 1 });
  });

  it('extracts immediately (and publishes scale) when not holding', async () => {
    const onLayout = vi.fn();
    render(
      <MusicXmlRenderer musicXml={XML} width={800} scale={1.3} onLayout={onLayout} />,
    );
    await act(async () => {});
    expect(m.extract).toHaveBeenCalledTimes(1);
    expect(onLayout).toHaveBeenCalledTimes(1);
    expect(onLayout.mock.calls[0][0]).toMatchObject({ scale: 1.3 });
  });
});

afterEach(cleanup);
