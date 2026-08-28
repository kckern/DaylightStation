import { describe, it, expect } from 'vitest';
import { projectFormMap, decodeOmrSheet } from '#domains/school/documents/omrForm.mjs';
import { VirtualOmrReader } from '#adapters/hardware/omr/VirtualOmrReader.mjs';

/** Three questions, four bubbles each, one response row per question. */
const formMap = {
  formVersion: 'v1',
  documentId: 'math-fractions-03-omr',
  marks: ['q1', 'q2', 'q3'].flatMap((itemId, row) => ['A', 'B', 'C', 'D'].map((choice, col) => ({
    itemId, choice, xPt: 100 + col * 20, yPt: 200 + row * 40, rPt: 5, page: 1,
  }))),
};

describe('projectFormMap', () => {
  it('groups marks into one column per response row, ordered top to bottom', () => {
    const { rows, errors } = projectFormMap(formMap);
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.columnIndex)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.choices[0].itemId)).toEqual(['q1', 'q2', 'q3']);
  });

  it('assigns bits left to right regardless of authored order', () => {
    const scrambled = { ...formMap, marks: [...formMap.marks].reverse() };
    const { rows } = projectFormMap(scrambled);
    expect(rows[0].choices.map((c) => c.choice)).toEqual(['A', 'B', 'C', 'D']);
    expect(rows[0].choices.map((c) => c.bit)).toEqual([0, 1, 2, 3]);
  });

  it('sorts by page before y', () => {
    const twoPage = {
      formVersion: 'v1',
      marks: [
        { itemId: 'q2', choice: 'A', xPt: 100, yPt: 100, page: 2 },
        { itemId: 'q1', choice: 'A', xPt: 100, yPt: 700, page: 1 },
      ],
    };
    expect(projectFormMap(twoPage).rows.map((r) => r.choices[0].itemId)).toEqual(['q1', 'q2']);
  });

  it('reports a row wider than the reader instead of truncating it', () => {
    const wide = {
      formVersion: 'v1',
      marks: Array.from({ length: 13 }, (_, i) => ({ itemId: 'q1', choice: `c${i}`, xPt: 100 + i, yPt: 200 })),
    };
    expect(projectFormMap(wide).errors[0]).toContain('13 bubbles');
  });

  it('reports a malformed mark rather than throwing', () => {
    const { errors } = projectFormMap({ marks: [{ itemId: 'q1' }] });
    expect(errors).toEqual(['marks[0]: needs itemId, choice, xPt, yPt']);
  });

  it('reports an empty form map', () => {
    expect(projectFormMap({}).errors).toEqual(['formMap.marks must be a non-empty array']);
  });
});

describe('decodeOmrSheet round-trips the virtual reader', () => {
  const reader = new VirtualOmrReader({ logger: { info() {} } });

  it('recovers exactly the answers that were bubbled in', () => {
    const sheet = reader.scanSheet({ formMap, chosen: { q1: 'B', q2: 'D', q3: 'A' } });
    expect(decodeOmrSheet({ formMap, sheet })).toEqual({
      entries: { q1: 'B', q2: 'D', q3: 'A' }, ambiguous: [], blank: [], errors: [],
    });
  });

  it('reports a two-mark row as ambiguous instead of guessing', () => {
    const sheet = reader.scanSheet({ formMap, chosen: { q1: 'A', q3: 'C' }, ambiguous: ['q2'] });
    const decoded = decodeOmrSheet({ formMap, sheet });
    expect(decoded.ambiguous).toEqual(['q2']);
    expect(decoded.entries).toEqual({ q1: 'A', q3: 'C' });
  });

  it('reports an unmarked row as blank', () => {
    const sheet = reader.scanSheet({ formMap, chosen: { q1: 'A', q2: 'B' }, blank: ['q3'] });
    const decoded = decodeOmrSheet({ formMap, sheet });
    expect(decoded.blank).toEqual(['q3']);
    expect(decoded.entries).toEqual({ q1: 'A', q2: 'B' });
  });

  it('treats a whole unmarked sheet as three blanks, not three wrong answers', () => {
    const sheet = reader.scanSheet({ formMap });
    expect(decodeOmrSheet({ formMap, sheet })).toMatchObject({ entries: {}, blank: ['q1', 'q2', 'q3'] });
  });
});

describe('decodeOmrSheet refusals', () => {
  it('refuses a sheet whose column count disagrees with the form', () => {
    const decoded = decodeOmrSheet({ formMap, sheet: { marks: [1, 2] } });
    expect(decoded.entries).toEqual({});
    expect(decoded.errors[0]).toContain('2 columns but this form printed 3');
  });

  it('refuses a sheet with no marks array', () => {
    expect(decodeOmrSheet({ formMap, sheet: {} }).errors).toContain('sheet.marks must be an array');
  });

  it('is total over junk', () => {
    expect(decodeOmrSheet()).toMatchObject({ entries: {}, ambiguous: [], blank: [] });
  });
});

describe('a set-valued row', () => {
  const gateFormMap = {
    formVersion: 'v1',
    marks: ['A', 'B', 'C', 'D', 'E'].map((choice, col) => ({
      itemId: 'gate', choice, label: choice, selection: 'set',
      xPt: 100 + col * 20, yPt: 100, rPt: 5, page: 1,
    })),
  };

  it('encodes every letter of a code into one column', () => {
    const reader = new VirtualOmrReader({ readerId: 'test' });
    const sheet = reader.scanSheet({ formMap: gateFormMap, chosen: { gate: ['A', 'C', 'E'] } });
    // bits 0, 2, 4 -> 0b10101 = 21
    expect(sheet.marks[0]).toBe(21);
  });

  it('still accepts a single string choice', () => {
    const reader = new VirtualOmrReader({ readerId: 'test' });
    const sheet = reader.scanSheet({ formMap: gateFormMap, chosen: { gate: 'B' } });
    expect(sheet.marks[0]).toBe(2);
  });

  it('still refuses a letter the row does not print', () => {
    const reader = new VirtualOmrReader({ readerId: 'test' });
    expect(() => reader.scanSheet({ formMap: gateFormMap, chosen: { gate: ['A', 'Z'] } })).toThrow();
  });
});
