import { describe, it, expect } from 'vitest';
import {
  midiOfHalfTone,
  pickMelodyNote,
  collectOnsetNotes,
  extractStaffGeometry,
  extractPerStaffGeometry,
  extractEvents,
  extractLayoutSliced,
  staffGroups,
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
const staffLineWithId = ({ x, y, width, staffId }) => ({
  PositionAndShape: { AbsolutePosition: { x, y }, Size: { width } },
  ParentStaff: staffId == null ? undefined : { idInMusicSheet: staffId },
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

describe('extractPerStaffGeometry', () => {
  it('emits one entry per staff per system with the OSMD staff id', () => {
    const sys = { StaffLines: [
      staffLineWithId({ x: 12, y: 6, width: 100, staffId: 0 }),
      staffLineWithId({ x: 12, y: 14, width: 100, staffId: 1 }),
    ] };
    const out = extractPerStaffGeometry(sheet([sys], 1));
    expect(out).toEqual([
      { system: 0, staff: 0, top: 60, left: 120, right: 1120, lineSpacing: 10 },
      { system: 0, staff: 1, top: 140, left: 120, right: 1120, lineSpacing: 10 },
    ]);
  });

  it('falls back to the StaffLines index when ParentStaff is absent', () => {
    const sys = { StaffLines: [staffLineWithId({ x: 0, y: 0, width: 10 }), staffLineWithId({ x: 0, y: 8, width: 10 })] };
    expect(extractPerStaffGeometry(sheet([sys], 1)).map((s) => s.staff)).toEqual([0, 1]);
  });

  it('scales by Zoom and skips malformed staves', () => {
    const sys = { StaffLines: [staffLineWithId({ x: 12, y: 6, width: 100, staffId: 0 }), {}] };
    const out = extractPerStaffGeometry(sheet([sys], 0.75));
    expect(out).toEqual([{ system: 0, staff: 0, top: 45, left: 90, right: 840, lineSpacing: 7.5 }]);
  });

  it('returns [] for garbage', () => {
    expect(extractPerStaffGeometry(undefined)).toEqual([]);
    expect(extractPerStaffGeometry({})).toEqual([]);
  });
});

describe('layout extract publishes staff geometry', () => {
  // A cursor-less score is the blank-draft case: no notes to walk, but the
  // caret still needs to know where the staff is.
  const blankDraft = sheet([{ StaffLines: [staffLine({ x: 12, y: 6.35, width: 100 })] }], 1);

  it('includes `staves` on the no-cursor early return of extractEvents', () => {
    const out = extractEvents(blankDraft);
    expect(out.staves).toEqual([{ system: 0, top: 63.5, left: 120, right: 1120, lineSpacing: 10 }]);
    expect(Array.isArray(out.staffBoxes)).toBe(true);
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
    expect(Array.isArray(out.staffBoxes)).toBe(true);
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

describe('staffGroups', () => {
  // Mirrors the real OSMD output: one <g class="staffline"> per staff per
  // system, id `{Instrument}{n}-{staffNumber}` with a 1-BASED trailing number.
  const svgWith = (ids) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const id of ids) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'staffline');
      g.setAttribute('id', id);
      svg.appendChild(g);
    }
    return svg;
  };

  it('converts the 1-based id suffix to a 0-based staff id', () => {
    const svg = svgWith(['Piano0-1', 'Piano0-2']);
    expect(staffGroups(svg).map((g) => g.staff)).toEqual([0, 1]);
  });

  it('returns one entry per system, not per staff', () => {
    // Two systems of a grand staff = four groups, staff ids repeating.
    const svg = svgWith(['Piano0-1', 'Piano0-2', 'Piano0-1', 'Piano0-2']);
    expect(staffGroups(svg).map((g) => g.staff)).toEqual([0, 1, 0, 1]);
  });

  it('hands back the element itself so a caller can class it', () => {
    const svg = svgWith(['Piano0-2']);
    expect(staffGroups(svg)[0].el).toBe(svg.querySelector('g.staffline'));
  });

  it('skips a group whose id carries no staff number rather than guessing', () => {
    expect(staffGroups(svgWith(['Piano0-1', 'junk', 'Piano0-2']))).toHaveLength(2);
  });

  it('survives null and an empty sheet', () => {
    expect(staffGroups(null)).toEqual([]);
    expect(staffGroups(svgWith([]))).toEqual([]);
  });
});
