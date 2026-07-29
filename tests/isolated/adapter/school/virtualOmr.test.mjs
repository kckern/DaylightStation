import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualOmrReader } from '#adapters/hardware/omr/VirtualOmrReader.mjs';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const makeBus = () => {
  const broadcasts = [];
  return { broadcasts, broadcast: (topic, payload) => broadcasts.push({ topic, payload }) };
};

/** Shape produced by DocumentPdfRenderer: four 4-choice questions down one page. */
const CHOICES = ['A', 'B', 'C', 'D'];
const formMap = {
  formVersion: 'wk-fractions-v1',
  marks: ['q1', 'q2', 'q3', 'q4'].flatMap((itemId, row) =>
    CHOICES.map((choice, col) => ({
      itemId, choice, xPt: 72 + col * 24, yPt: 200 + row * 30, rPt: 6, page: 1,
    }))),
};

let bus, reader;

beforeEach(() => {
  bus = makeBus();
  reader = new VirtualOmrReader({ eventBus: bus, readerId: 'omr-1100-virtual', logger: silent });
});

describe('construction', () => {
  it('works without an event bus — the sheet event is also returned directly', () => {
    const solo = new VirtualOmrReader({ logger: silent });
    expect(solo.scanSheet({ formMap, chosen: { q1: 'A' } }).source).toBe('omr-relay');
  });
});

describe('formLayout — form map to reader geometry', () => {
  it('maps one response row to one reader column, ordered by page then y', () => {
    const layout = reader.formLayout(formMap);
    expect(layout).toHaveLength(4);
    expect(layout.map((r) => r.columnIndex)).toEqual([0, 1, 2, 3]);
    expect(layout.map((r) => r.yPt)).toEqual([200, 230, 260, 290]);
  });

  it('maps choices left-to-right onto channels, bit 0 first', () => {
    const [row] = reader.formLayout(formMap);
    expect(row.choices.map((c) => [c.choice, c.bit])).toEqual([['A', 0], ['B', 1], ['C', 2], ['D', 3]]);
  });

  it('rejects a row with more than the reader\'s 12 channels', () => {
    const wide = {
      formVersion: 'v', marks: Array.from({ length: 13 }, (_, i) => ({
        itemId: 'q1', choice: `c${i}`, xPt: 72 + i * 12, yPt: 200, rPt: 6, page: 1,
      })),
    };
    expect(() => reader.formLayout(wide)).toThrow(/12/);
  });

  it('orders multi-page forms by page before y', () => {
    const twoPage = {
      formVersion: 'v',
      marks: [
        { itemId: 'q2', choice: 'A', xPt: 72, yPt: 100, rPt: 6, page: 2 },
        { itemId: 'q1', choice: 'A', xPt: 72, yPt: 400, rPt: 6, page: 1 },
      ],
    };
    expect(reader.formLayout(twoPage).map((r) => r.choices[0].itemId)).toEqual(['q1', 'q2']);
  });
});

describe('scanSheet — the normalized sheet event', () => {
  it('emits the documented field set', () => {
    const sheet = reader.scanSheet({ formMap, chosen: { q1: 'A' } });
    expect(Object.keys(sheet).sort()).toEqual(['columns', 'id', 'markedColumns', 'marks', 'source', 'type']);
    expect(sheet.source).toBe('omr-relay');
    expect(sheet.type).toBe('sheet');
    expect(sheet.id).toBe('omr-1100-virtual');
  });

  it('carries one 12-bit mask per column, including blank columns', () => {
    const sheet = reader.scanSheet({ formMap, chosen: { q1: 'A', q2: 'C' } });
    expect(sheet.columns).toBe(4);
    expect(sheet.marks).toHaveLength(4);
    expect(sheet.marks).toEqual([1, 4, 0, 0]);
    expect(sheet.markedColumns).toBe(2);
  });

  it('sets the bit matching the chosen channel', () => {
    expect(reader.scanSheet({ formMap, chosen: { q1: 'A' } }).marks[0]).toBe(0b0001);
    expect(reader.scanSheet({ formMap, chosen: { q1: 'B' } }).marks[0]).toBe(0b0010);
    expect(reader.scanSheet({ formMap, chosen: { q1: 'C' } }).marks[0]).toBe(0b0100);
    expect(reader.scanSheet({ formMap, chosen: { q1: 'D' } }).marks[0]).toBe(0b1000);
  });

  it('every mask stays inside the reader\'s 12 channels', () => {
    const sheet = reader.scanSheet({ formMap, chosen: { q1: 'D', q2: 'D', q3: 'D', q4: 'D' } });
    expect(sheet.marks.every((m) => m >= 0 && m < (1 << 12))).toBe(true);
  });

  it('an all-blank sheet is still a sheet', () => {
    const sheet = reader.scanSheet({ formMap, chosen: {} });
    expect(sheet.marks).toEqual([0, 0, 0, 0]);
    expect(sheet.markedColumns).toBe(0);
  });

  it('broadcasts on the omr topic when a bus is injected', () => {
    const sheet = reader.scanSheet({ formMap, chosen: { q1: 'A' } });
    expect(bus.broadcasts).toHaveLength(1);
    expect(bus.broadcasts[0].topic).toBe('omr');
    expect(bus.broadcasts[0].payload).toEqual(sheet);
  });
});

describe('scanSheet — ambiguous marks', () => {
  it('an ambiguous item sets TWO bits in its one row', () => {
    const sheet = reader.scanSheet({ formMap, chosen: { q1: 'A', q3: 'B' }, ambiguous: ['q3'] });
    expect(sheet.marks[2]).toBe(0b0110); // B + C
    expect(popcount(sheet.marks[2])).toBe(2);
  });

  it('an ambiguous item with no chosen answer uses its first two channels', () => {
    const sheet = reader.scanSheet({ formMap, chosen: {}, ambiguous: ['q3'] });
    expect(sheet.marks[2]).toBe(0b0011);
  });

  it('an ambiguous LAST choice pairs with the one before it', () => {
    const sheet = reader.scanSheet({ formMap, chosen: { q1: 'D' }, ambiguous: ['q1'] });
    expect(sheet.marks[0]).toBe(0b1100); // C + D
  });

  it('counts an ambiguous column as marked', () => {
    expect(reader.scanSheet({ formMap, chosen: {}, ambiguous: ['q2'] }).markedColumns).toBe(1);
  });
});

describe('scanSheet — blanks', () => {
  it('a blank item produces no marks in its row', () => {
    const sheet = reader.scanSheet({ formMap, chosen: { q1: 'A' }, blank: ['q2'] });
    expect(sheet.marks).toEqual([1, 0, 0, 0]);
    expect(sheet.markedColumns).toBe(1);
  });

  it('rejects an item listed as both chosen and blank', () => {
    expect(() => reader.scanSheet({ formMap, chosen: { q2: 'B' }, blank: ['q2'] })).toThrow(/q2/);
  });

  it('rejects an item listed as both ambiguous and blank', () => {
    expect(() => reader.scanSheet({ formMap, chosen: {}, ambiguous: ['q2'], blank: ['q2'] }))
      .toThrow(/q2/);
  });
});

describe('scanSheet — validation', () => {
  it('requires a formMap with a formVersion and marks', () => {
    expect(() => reader.scanSheet({ chosen: {} })).toThrow(/formMap/);
    expect(() => reader.scanSheet({ formMap: { marks: [] }, chosen: {} })).toThrow(/formVersion/);
    expect(() => reader.scanSheet({ formMap: { formVersion: 'v' }, chosen: {} })).toThrow(/marks/);
  });

  it('rejects an unknown item id', () => {
    expect(() => reader.scanSheet({ formMap, chosen: { q9: 'A' } })).toThrow(/q9/);
    expect(() => reader.scanSheet({ formMap, chosen: {}, blank: ['q9'] })).toThrow(/q9/);
    expect(() => reader.scanSheet({ formMap, chosen: {}, ambiguous: ['q9'] })).toThrow(/q9/);
  });

  it('rejects an unknown choice for a known item', () => {
    expect(() => reader.scanSheet({ formMap, chosen: { q1: 'Z' } })).toThrow(/Z/);
  });

  it('rejects an ambiguous item that has only one channel', () => {
    const single = { formVersion: 'v', marks: [{ itemId: 'q1', choice: 'A', xPt: 72, yPt: 200, rPt: 6, page: 1 }] };
    expect(() => reader.scanSheet({ formMap: single, chosen: {}, ambiguous: ['q1'] })).toThrow(/q1/);
  });
});

describe('history', () => {
  it('records every scanned sheet in order', () => {
    reader.scanSheet({ formMap, chosen: { q1: 'A' } });
    reader.scanSheet({ formMap, chosen: { q1: 'B' } });
    expect(reader.listSheets().map((s) => s.marks[0])).toEqual([1, 2]);
    expect(reader.lastSheet().marks[0]).toBe(2);
  });

  it('lastSheet is null before anything is scanned', () => {
    expect(reader.lastSheet()).toBe(null);
  });
});

function popcount(n) {
  let c = 0;
  while (n) { c += n & 1; n >>= 1; }
  return c;
}
