import { describe, it, expect } from 'vitest';
import {
  midiOfHalfTone,
  pickMelodyNote,
  collectOnsetNotes,
  extractStaffGeometry,
  extractEvents,
  extractLayoutSliced,
} from './osmdRender.js';

const note = ({ halfTone, rest = false, grace = false, tieCont = false, staff = 0 }) => {
  const n = {
    halfTone,
    isRest: () => rest,
    IsGraceNote: grace,
    ParentStaffEntry: { ParentStaff: { idInMusicSheet: staff } },
  };
  n.NoteTie = tieCont ? { StartNote: {} } : null; // StartNote !== n → continuation
  return n;
};

describe('midiOfHalfTone', () => {
  it('maps OSMD halfTone to MIDI (C4: halfTone 48 → midi 60)', () => {
    expect(midiOfHalfTone(48)).toBe(60);
    expect(midiOfHalfTone(57)).toBe(69); // A4
  });
});

describe('pickMelodyNote', () => {
  it('picks the highest non-rest note on the top staff', () => {
    const lo = note({ halfTone: 40 });
    const hi = note({ halfTone: 52 });
    expect(pickMelodyNote([lo, hi])).toBe(hi);
  });

  it('ignores rests, grace notes, tie continuations, and lower staves', () => {
    expect(pickMelodyNote([note({ halfTone: 60, rest: true })])).toBe(null);
    expect(pickMelodyNote([note({ halfTone: 60, grace: true })])).toBe(null);
    expect(pickMelodyNote([note({ halfTone: 60, tieCont: true })])).toBe(null);
    expect(pickMelodyNote([note({ halfTone: 60, staff: 1 })])).toBe(null);
  });

  it('keeps a tie START note (it is a real onset)', () => {
    const n = note({ halfTone: 50 });
    n.NoteTie = { StartNote: n };
    expect(pickMelodyNote([n])).toBe(n);
  });

  it('survives malformed entries and empty input', () => {
    expect(pickMelodyNote(null)).toBe(null);
    expect(pickMelodyNote([null, {}, note({ halfTone: 45 })])?.halfTone).toBe(45);
  });
});

describe('collectOnsetNotes', () => {
  it('keeps every real onset on BOTH staves (chord set for follow/play modes)', () => {
    const rh = note({ halfTone: 52, staff: 0 });
    const lh = note({ halfTone: 28, staff: 1 });
    expect(collectOnsetNotes([rh, lh])).toEqual([rh, lh]);
  });
  it('drops rests, grace notes, and tie continuations', () => {
    expect(collectOnsetNotes([
      note({ halfTone: 60, rest: true }),
      note({ halfTone: 60, grace: true }),
      note({ halfTone: 60, tieCont: true }),
    ])).toEqual([]);
  });
  it('survives malformed entries', () => {
    expect(collectOnsetNotes([null, {}, note({ halfTone: 45 })]).length).toBe(1);
  });
});

// Mirrors OSMD's graphical model chain:
//   OpenSheetMusicDisplay.GraphicSheet → GraphicalMusicSheet.MusicPages[]
//   → GraphicalMusicPage.MusicSystems[] → MusicSystem.StaffLines[]
//   → GraphicalObject.PositionAndShape (BoundingBox: .AbsolutePosition PointF2D, .Size SizeF2D)
// Coordinates are OSMD units (one staff space), NOT pixels.
const staffLine = ({ x, y, width }) => ({
  PositionAndShape: { AbsolutePosition: { x, y }, Size: { width } },
});
const sheet = (systems, zoom) => ({
  Zoom: zoom,
  GraphicSheet: { MusicPages: [{ MusicSystems: systems }] },
});

describe('extractStaffGeometry', () => {
  it('converts one system from OSMD units to pixels (10 px/unit at zoom 1)', () => {
    const osmd = sheet([{ StaffLines: [staffLine({ x: 12, y: 6.35, width: 100 })] }], 1);
    expect(extractStaffGeometry(osmd)).toEqual([
      { system: 0, top: 63.5, left: 120, right: 1120, lineSpacing: 10 },
    ]);
  });

  it('scales by Zoom', () => {
    const osmd = sheet([{ StaffLines: [staffLine({ x: 10, y: 5, width: 20 })] }], 0.75);
    expect(extractStaffGeometry(osmd)).toEqual([
      { system: 0, top: 37.5, left: 75, right: 225, lineSpacing: 7.5 },
    ]);
  });

  it('reports every system, indexed in order', () => {
    const osmd = sheet([
      { StaffLines: [staffLine({ x: 12, y: 6, width: 50 })] },
      { StaffLines: [staffLine({ x: 12, y: 26, width: 50 })] },
    ], 1);
    const out = extractStaffGeometry(osmd);
    expect(out.map((s) => s.system)).toEqual([0, 1]);
    expect(out.map((s) => s.top)).toEqual([60, 260]);
  });

  it('defaults Zoom to 1 when absent', () => {
    const osmd = { GraphicSheet: { MusicPages: [{ MusicSystems: [{ StaffLines: [staffLine({ x: 1, y: 2, width: 3 })] }] }] } };
    expect(extractStaffGeometry(osmd)[0]).toEqual({ system: 0, top: 20, left: 10, right: 40, lineSpacing: 10 });
  });

  it('treats a missing Size as zero width rather than NaN', () => {
    const osmd = sheet([{ StaffLines: [{ PositionAndShape: { AbsolutePosition: { x: 4, y: 2 } } }] }], 1);
    expect(extractStaffGeometry(osmd)[0].right).toBe(40);
  });

  it('returns [] for missing OSMD internals instead of throwing', () => {
    expect(extractStaffGeometry(undefined)).toEqual([]);
    expect(extractStaffGeometry({})).toEqual([]); // no GraphicSheet
    expect(extractStaffGeometry(sheet([{}], 1))).toEqual([]); // no StaffLines
    expect(extractStaffGeometry(sheet([{ StaffLines: [] }], 1))).toEqual([]);
    expect(extractStaffGeometry(sheet([{ StaffLines: [{}] }], 1))).toEqual([]); // no PositionAndShape
  });

  it('skips only the malformed systems, keeping the well-formed ones', () => {
    const osmd = sheet([
      { StaffLines: [{}] },
      { StaffLines: [staffLine({ x: 12, y: 26, width: 50 })] },
    ], 1);
    expect(extractStaffGeometry(osmd)).toEqual([
      { system: 1, top: 260, left: 120, right: 620, lineSpacing: 10 },
    ]);
  });
});

describe('layout extract publishes staff geometry', () => {
  // A cursor-less score is the blank-draft case: no notes to walk, but the
  // caret still needs to know where the staff is.
  const blankDraft = sheet([{ StaffLines: [staffLine({ x: 12, y: 6.35, width: 100 })] }], 1);

  it('includes `staves` on the no-cursor early return of extractEvents', () => {
    const out = extractEvents(blankDraft);
    expect(out.staves).toEqual([{ system: 0, top: 63.5, left: 120, right: 1120, lineSpacing: 10 }]);
    // additive only — the pre-existing keys keep their shape
    expect(out.events).toEqual([]);
    expect(out.notes).toEqual([]);
    expect(out.tempoEntries).toEqual([]);
    expect(out.steps).toEqual([]);
    expect(out.measures).toEqual([]);
  });

  it('includes `staves` on the no-cursor early return of extractLayoutSliced', async () => {
    const out = await extractLayoutSliced(blankDraft);
    expect(out.staves).toEqual([{ system: 0, top: 63.5, left: 120, right: 1120, lineSpacing: 10 }]);
    expect(out.steps).toEqual([]);
    expect(out.measures).toEqual([]);
  });

  it('includes `staves` on the finalized walk return', () => {
    const osmd = {
      ...blankDraft,
      // Minimal cursor that ends immediately — exercises finalize() without a walk.
      cursor: {
        Iterator: { EndReached: true },
        cursorElement: null,
        show() {}, hide() {}, reset() {}, next() {},
        NotesUnderCursor: () => [],
      },
    };
    const out = extractEvents(osmd);
    expect(out.staves).toEqual([{ system: 0, top: 63.5, left: 120, right: 1120, lineSpacing: 10 }]);
    expect(out.events).toEqual([]);
  });
});
