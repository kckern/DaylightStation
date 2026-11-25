import { describe, it, expect } from 'vitest';
import { visibleNotes, musicClaim } from './OfficeMidiProvider.jsx';

const held = (...notes) => new Map(notes.map((note) => [note, { velocity: 80, timestamp: 1 }]));
const EDGES = [28, 103]; // the office board's lowest and highest keys (E1, G7)

describe('musicClaim (which keys are not music right now)', () => {
  it("the hold's own notes are not observed by the run", () => {
    const claim = musicClaim({ menuOpen: false, edges: EDGES });
    expect([...visibleNotes(held(28, 60, 103), claim, new Set()).keys()]).toEqual([60]);
  });

  it('with the menu shut, C2 to G2 are music: a take started on F2 starts the take', () => {
    const claim = musicClaim({ menuOpen: false, edges: EDGES });
    for (const note of [36, 38, 40, 41, 43]) expect(claim.has(note)).toBe(false);
    expect([...visibleNotes(held(41), claim, new Set()).keys()]).toEqual([41]);
  });

  it('with the menu open every key is navigation, and a key still down when it closes stays out of the music', () => {
    const sticky = new Set();
    expect(visibleNotes(held(41, 60), musicClaim({ menuOpen: true, edges: EDGES }), sticky).size).toBe(0);
    expect([...visibleNotes(held(41, 60, 64), musicClaim({ menuOpen: false, edges: EDGES }), sticky).keys()]).toEqual([64]);
  });
});

describe('visibleNotes (what Learn hears while the strip holds its keys)', () => {
  it('passes every note through when nothing is claimed', () => {
    const live = held(36, 60);
    expect(visibleNotes(live, null, new Set())).toBe(live);
  });

  it('hides claimed keys from the music', () => {
    expect([...visibleNotes(held(36, 60), new Set([36]), new Set()).keys()]).toEqual([60]);
  });

  it('keeps a key struck while claimed hidden until it comes up, even after the claim ends', () => {
    const sticky = new Set();
    visibleNotes(held(36), new Set([36]), sticky);
    // The take starts (claim released) with the finger still down: not a fresh note.
    expect([...visibleNotes(held(36, 60), null, sticky).keys()]).toEqual([60]);
    // Released and struck again: now it is music.
    visibleNotes(held(60), null, sticky);
    expect([...visibleNotes(held(36, 60), null, sticky).keys()]).toEqual([36, 60]);
  });
});
