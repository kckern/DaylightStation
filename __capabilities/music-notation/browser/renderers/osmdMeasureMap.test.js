import { describe, expect, it } from 'vitest';
import { extractMeasureMap } from './osmdRender.js';

const measure = (start, length, extra = {}) => ({
  AbsoluteTimestamp: { RealValue: start / 4 }, Duration: { RealValue: length / 4 }, ImplicitMeasureFromXml: false, MeasureNumberXML: 1, ...extra,
});

describe('extractMeasureMap', () => {
  it('marks a pickup bar implicit, from the MusicXML flag or a bar numbered 0', () => {
    const map = extractMeasureMap({ Sheet: { SourceMeasures: [
      measure(0, 1, { ImplicitMeasureFromXml: true, MeasureNumberXML: 0 }), measure(1, 4, { MeasureNumberXML: 1 }),
    ] } });
    expect(map.map((m) => m.implicit)).toEqual([true, false]);
    expect(extractMeasureMap({ Sheet: { SourceMeasures: [measure(0, 1, { MeasureNumberXML: 0 })] } })[0].implicit).toBe(true);
  });
  it('leaves a written short opening bar not implicit', () => {
    const map = extractMeasureMap({ Sheet: { SourceMeasures: [measure(0, 2), measure(2, 4, { MeasureNumberXML: 2 })] } });
    expect(map[0]).toEqual({ index: 0, onsetQuarter: 0, durationQuarters: 2, implicit: false });
  });
});
