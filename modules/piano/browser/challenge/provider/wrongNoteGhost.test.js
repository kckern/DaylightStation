import { describe, it, expect } from 'vitest';
import {
  clefSignFor, scaleClefType, fifthsForKeyName, staffMetrics, ghostPlacement, GHOST_GAP_SPACES,
} from './wrongNoteGhost.js';
import { staffPositionOf } from '../../PianoKiosk/modes/Composer/wetGlyphGeometry.js';

// 5 staff lines, 21px apart, 2px thick — the real geometry measured off the
// deployed card game at 1280×800.
const LINES = [394, 415, 436, 457, 478].map((top) => ({ top, height: 2 }));
const ORIGIN = { left: 57, top: 220 };
const ANCHOR = { right: 281 };

describe('clefSignFor', () => {
  it('maps the two clefs the glyph can place a pitch on', () => {
    expect(clefSignFor('treble')).toBe('G');
    expect(clefSignFor('bass')).toBe('F');
  });

  it('treats an octave-transposing clef as its base clef — same lines, same positions', () => {
    expect(clefSignFor('treble-8')).toBe('G');
    expect(clefSignFor('bass+8')).toBe('F');
  });

  it('refuses a clef it cannot place honestly rather than defaulting to treble', () => {
    // An alto staff's bottom line is F3, four steps off treble's E4. Guessing
    // would draw the ghost on the wrong line and teach the wrong note.
    expect(clefSignFor('alto')).toBeNull();
    expect(clefSignFor('perc')).toBeNull();
    expect(clefSignFor(undefined)).toBeNull();
  });
});

describe('scaleClefType', () => {
  it('reads the clef of the first engraved staff', () => {
    expect(scaleClefType({ lines: [{ staff: [{ clef: { type: 'bass' } }] }] })).toBe('bass');
  });

  it('skips non-staff lines (titles, text) instead of reporting no clef', () => {
    const tune = { lines: [{ text: 'title' }, { staff: [{ clef: { type: 'treble' } }] }] };
    expect(scaleClefType(tune)).toBe('treble');
  });

  it('returns null for a tune with nothing engraved', () => {
    expect(scaleClefType({ lines: [] })).toBeNull();
    expect(scaleClefType(null)).toBeNull();
  });
});

describe('fifthsForKeyName', () => {
  it('counts sharps and flats as signed fifths', () => {
    expect(fifthsForKeyName('C')).toBe(0);
    expect(fifthsForKeyName('D')).toBe(2);
    expect(fifthsForKeyName('Eb')).toBe(-3);
  });

  it('falls back to no accidentals for an unknown key rather than throwing', () => {
    expect(fifthsForKeyName('H')).toBe(0);
    expect(fifthsForKeyName(undefined)).toBe(0);
  });
});

describe('staffMetrics', () => {
  it('reports the TOP line centre and the exact space between lines', () => {
    expect(staffMetrics(LINES)).toEqual({ top: 395, lineSpacing: 21 });
  });

  it('measures line centres, so stroke thickness never inflates the spacing', () => {
    // A group box would span 394 → 480 (86px) and read 21.5px per space; four
    // spaces later that is a 2px drift — half a staff step, a visible wrong line.
    const fat = [394, 415, 436, 457, 478].map((top) => ({ top, height: 6 }));
    expect(staffMetrics(fat).lineSpacing).toBe(21);
  });

  it('reports in the overlay coordinate space when given an origin', () => {
    expect(staffMetrics(LINES, 220).top).toBe(175);
  });

  it('returns null when the staff is not measurable', () => {
    expect(staffMetrics([])).toBeNull();
    expect(staffMetrics([{ top: 10, height: 2 }])).toBeNull();
    expect(staffMetrics([{ top: 10, height: 2 }, { top: 10, height: 2 }])).toBeNull(); // zero span
  });
});

describe('ghostPlacement', () => {
  const place = (over = {}) => ghostPlacement({
    midi: 67, clefType: 'treble', keyName: 'C',
    anchorRect: ANCHOR, originRect: ORIGIN, lineRects: LINES, ...over,
  });

  it('places the ghost clear of the note it is compared against', () => {
    // Right of the expected note's box by a fixed fraction of a space, so a
    // same-line mistake (F vs F♯) does not land on top of the red mark.
    expect(place().x).toBeCloseTo(281 - 57 + 21 * GHOST_GAP_SPACES, 5);
  });

  it('spells the played note in the exercise key, so it lands on the right line', () => {
    // MIDI 70 is B♭ in E♭ major (a note OF the key) but A♯ in D major, where it
    // is chromatic and spelled sharp. Same key pressed, two different staff
    // positions — spelling the ghost against the wrong key writes it a line off.
    const inEb = place({ midi: 70, keyName: 'Eb' });
    expect(inEb.pitch).toEqual({ step: 'B', alter: -1, octave: 4 });
    const inD = place({ midi: 70, keyName: 'D' });
    expect(inD.pitch).toEqual({ step: 'A', alter: 1, octave: 4 });
    expect(staffPositionOf(inEb.pitch, inEb.clef)).not.toBe(staffPositionOf(inD.pitch, inD.clef));
  });

  it('carries the clef through, so a bass staff ghost is measured off G2', () => {
    const bass = place({ midi: 43, clefType: 'bass' }); // G2 = the bottom line
    expect(bass.clef).toEqual({ sign: 'F' });
    expect(staffPositionOf(bass.pitch, bass.clef)).toBe(0);
  });

  it('hands the layer the same staff box the engraving uses', () => {
    expect(place().staff).toEqual({ top: 175, lineSpacing: 21 });
  });

  it('draws nothing rather than guessing when the placement cannot be trusted', () => {
    expect(place({ clefType: 'alto' })).toBeNull();     // unplaceable clef
    expect(place({ midi: null })).toBeNull();           // no note played
    expect(place({ lineRects: [] })).toBeNull();        // mid re-engrave
    expect(place({ anchorRect: null })).toBeNull();     // expected note not rendered
  });
});
