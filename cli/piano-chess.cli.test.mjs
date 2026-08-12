import { describe, expect, it } from 'vitest';
import {
  DEFAULT_URL,
  INTERVALS_BY_LABEL,
  PITCH_CLASSES,
  buildRimMap,
  chordMidiNotes,
  chordSymbolForSquare,
  parseArgs,
  parseChordSymbol,
  pickSource,
  readRimFromDocument,
} from './piano-chess.cli.mjs';
// The source of truth this CLI mirrors. The CLI cannot import it at runtime
// (chordAddress.js uses the vite-only @shared-gaming alias), so these tests
// exist to make any drift between the two tables a red build, not a silent
// misread of the board.
import {
  CHORD_QUALITIES,
  DEFAULT_CHORD_SCHEME,
  chordPitchClasses,
  squareToChord,
} from '../frontend/src/modules/Piano/PianoChessGame/chordAddress.js';

describe('parseArgs', () => {
  it('defaults to the deployed chess route with the fake bridge on 8770', () => {
    const options = parseArgs([]);
    expect(options.url).toBe(DEFAULT_URL);
    expect(options.bridgePort).toBe(8770);
    expect(options.user).toBe('guest');
    expect(options.headed).toBe(false);
    expect(options.json).toBe(false);
  });

  it('reads url, user, bridge port, timeout, and the flags', () => {
    const options = parseArgs([
      '--url', 'http://x:1/piano/games/chess', '--user', 'kckern',
      '--bridge-port', '9000', '--timeout', '5', '--headed', '--json',
    ]);
    expect(options).toMatchObject({
      url: 'http://x:1/piano/games/chess', user: 'kckern', bridgePort: 9000,
      timeoutMs: 5000, headed: true, json: true,
    });
  });

  it('rejects a flag with no value rather than silently taking the next flag', () => {
    expect(() => parseArgs(['--user', '--json'])).toThrow(/requires a value/);
  });

  it('rejects unknown arguments and non-http urls', () => {
    expect(() => parseArgs(['--frobnicate'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--url', 'ftp://x'])).toThrow(/http or https/);
  });
});

describe('the chord table mirrors chordAddress.js', () => {
  it('covers every quality the game can put on the rim, with the same intervals', () => {
    for (const [quality, definition] of Object.entries(CHORD_QUALITIES)) {
      const rimLabel = definition.label || 'maj'; // how the board renders major
      expect(INTERVALS_BY_LABEL[rimLabel], `rim label "${rimLabel}" (${quality})`).toEqual(definition.intervals);
    }
  });

  it('voices every chord in the default scheme with the right pitch classes, root in the bass', () => {
    for (const root of DEFAULT_CHORD_SCHEME.roots) {
      for (const quality of DEFAULT_CHORD_SCHEME.qualities) {
        const symbol = `${root}${CHORD_QUALITIES[quality].label}`;
        const notes = chordMidiNotes(symbol);
        const classes = [...new Set(notes.map((note) => note % 12))].sort((a, b) => a - b);
        expect(classes, symbol).toEqual(chordPitchClasses(root, quality));
        expect(Math.min(...notes) % 12, `${symbol} bass`).toBe(PITCH_CLASSES[root]);
      }
    }
  });
});

describe('parseChordSymbol', () => {
  it('reads a bare root as major and a suffix as its quality', () => {
    expect(parseChordSymbol('C')).toMatchObject({ root: 'C', label: '' });
    expect(parseChordSymbol('Am')).toMatchObject({ root: 'A', label: 'm' });
    expect(parseChordSymbol('Gsus4')).toMatchObject({ root: 'G', label: 'sus4' });
    expect(parseChordSymbol('Emaj7')).toMatchObject({ root: 'E', label: 'maj7' });
    expect(parseChordSymbol('F#dim')).toMatchObject({ root: 'F#', label: 'dim' });
  });

  it('gives the flat to the root, not the quality: Bb is B-flat major, Bbm6 is B-flat minor 6th', () => {
    expect(parseChordSymbol('Bb')).toMatchObject({ root: 'Bb', label: '' });
    expect(parseChordSymbol('Bbm6')).toMatchObject({ root: 'Bb', label: 'm6' });
  });

  it('throws on gibberish rather than guessing', () => {
    expect(() => parseChordSymbol('H')).toThrow(/root/);
    expect(() => parseChordSymbol('Cxyz')).toThrow(/quality/);
    expect(() => parseChordSymbol('')).toThrow();
  });
});

/** A fixture stand-in for the page: just enough DOM for the rim reader. */
function fixtureDocument({ rankLabels, fileLabels }) {
  const spans = (labels) => labels.map((textContent) => ({ textContent: ` ${textContent} ` }));
  return {
    querySelectorAll(selector) {
      if (selector.includes('rank-axis')) return spans(rankLabels);
      if (selector.includes('file-axis')) return spans(fileLabels);
      return [];
    },
  };
}

describe('reading the rim', () => {
  // The board renders exactly what PianoChessGame hands it: roots on the file
  // axis, quality labels (major shown as 'maj') on the rank axis, with the
  // rank axis drawn top-to-bottom from rank 8 for a White-facing board.
  const rimAsRendered = (scheme) => ({
    fileLabels: [...scheme.roots],
    rankLabels: scheme.qualities.map((quality) => CHORD_QUALITIES[quality].label || 'maj').reverse(),
  });

  it('recovers, for every square, the same chord symbol the game assigned it', () => {
    const scheme = DEFAULT_CHORD_SCHEME;
    const doc = fixtureDocument(rimAsRendered(scheme));
    const rimMap = buildRimMap({ ...readRimFromDocument(doc), orientation: 'white' });
    for (const file of 'abcdefgh') {
      for (const rank of '12345678') {
        const square = `${file}${rank}`;
        expect(chordSymbolForSquare(square, rimMap), square).toBe(squareToChord(square, scheme).symbol);
      }
    }
  });

  it('reads a re-dealt map, not an assumed one', () => {
    const shuffled = {
      roots: ['Bb', 'G', 'C', 'A', 'F', 'D', 'B', 'E'],
      qualities: ['seventh', 'major', 'diminished', 'minor', 'major7', 'sus4', 'add6', 'minor6'],
    };
    const doc = fixtureDocument(rimAsRendered(shuffled));
    const rimMap = buildRimMap({ ...readRimFromDocument(doc), orientation: 'white' });
    expect(chordSymbolForSquare('a1', rimMap)).toBe('Bb7');
    expect(chordSymbolForSquare('b2', rimMap)).toBe('G');
    expect(chordSymbolForSquare('h8', rimMap)).toBe('Em6');
  });

  it('reads a Black-facing board with both axes reversed', () => {
    const scheme = DEFAULT_CHORD_SCHEME;
    const rendered = rimAsRendered(scheme);
    const doc = fixtureDocument({
      fileLabels: [...rendered.fileLabels].reverse(),
      rankLabels: [...rendered.rankLabels].reverse(),
    });
    const rimMap = buildRimMap({ ...readRimFromDocument(doc), orientation: 'black' });
    expect(chordSymbolForSquare('a1', rimMap)).toBe(squareToChord('a1', scheme).symbol);
    expect(chordSymbolForSquare('h8', rimMap)).toBe(squareToChord('h8', scheme).symbol);
  });

  it('refuses a rim with missing or unreadable labels, naming the problem', () => {
    expect(() => buildRimMap({ fileLabelsLeftToRight: ['A'], rankLabelsTopToBottom: [] }))
      .toThrow(/8 file and 8 rank labels/);
    const eight = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Bb'];
    expect(() => buildRimMap({
      fileLabelsLeftToRight: ['X', ...eight.slice(1)],
      rankLabelsTopToBottom: ['maj', 'm', 'sus4', 'm6', '7', '6', 'maj7', 'dim'],
    })).toThrow(/"X" is not a note name/);
    expect(() => buildRimMap({
      fileLabelsLeftToRight: eight,
      rankLabelsTopToBottom: ['nope', 'm', 'sus4', 'm6', '7', '6', 'maj7', 'dim'],
    })).toThrow(/"nope" is not a chord quality/);
  });
});

describe('pickSource', () => {
  it('picks a White piece with legal moves from the opening position, deterministically', () => {
    const first = pickSource();
    const second = pickSource();
    expect(first).toEqual(second);
    expect(first.from).toMatch(/^[a-h][12]$/); // White's own ranks at the start
    expect(first.destinations.length).toBeGreaterThan(0);
  });

  it('throws when White has no moves at all', () => {
    // Fool's mate: White is checkmated, so no White source exists.
    expect(() => pickSource('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'))
      .toThrow(/no legal moves/);
  });
});
