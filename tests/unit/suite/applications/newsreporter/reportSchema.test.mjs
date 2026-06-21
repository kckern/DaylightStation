import { describe, it, expect } from '@jest/globals';
import { reportSchema, parseReport } from '#apps/newsreporter/reportSchema.mjs';

describe('reportSchema', () => {
  it('accepts heading/lines/table/note sections', () => {
    const r = parseReport({ sections: [
      { type: 'heading', text: 'A' },
      { type: 'lines', lines: ['x', 'y'] },
      { type: 'table', headers: ['H'], rows: [['1']] },
      { type: 'note', text: 'n' },
    ]});
    expect(r.sections).toHaveLength(4);
  });
  it('allows empty sections (empty report)', () => {
    expect(parseReport({ sections: [] }).sections).toEqual([]);
  });
  it('rejects unknown section type', () => {
    expect(() => parseReport({ sections: [{ type: 'bogus' }] })).toThrow();
  });
});
