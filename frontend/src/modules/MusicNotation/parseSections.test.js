import { describe, it, expect } from 'vitest';
import { extractSections } from './parseMusicXml.js';

const XML = `<score-partwise><part id="P1">
  <measure number="1"><direction><direction-type><rehearsal>A</rehearsal></direction-type></direction></measure>
  <measure number="2"></measure>
  <measure number="3"><direction><direction-type><rehearsal>B</rehearsal></direction-type></direction></measure>
  <measure number="4"></measure>
</part></score-partwise>`;

describe('extractSections', () => {
  it('maps rehearsal marks to measure ranges (mark → next mark or end)', () => {
    const s = extractSections(XML);
    expect(s).toEqual([
      { label: 'A', startMeasure: 1, endMeasure: 2 },
      { label: 'B', startMeasure: 3, endMeasure: 4 },
    ]);
  });
  it('returns [] when there are no rehearsal marks', () => {
    expect(extractSections('<score-partwise><part id="P1"><measure number="1"/></part></score-partwise>')).toEqual([]);
  });
});
