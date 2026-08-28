import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import fourBars from './__fixtures__/fourBars.musicxml?raw';

/**
 * The engraver is DOUBLED here, and that is not a shortcut taken to move
 * faster.
 *
 * OpenSheetMusicDisplay cannot engrave under happy-dom at all: it needs real
 * SVG text metrics (`getBBox`, `getComputedTextLength`), which the DOM double
 * answers with zeroes, and `MusicXmlRenderer` therefore lands on its own
 * "Could not read this score." placeholder without ever publishing a layout.
 * That was verified against the KNOWN-GOOD `maryHadALittleLamb` fixture as
 * well as this one, so it is the environment and not the XML. Every suite in
 * `modes/SheetMusic/` that drives a score (ScorePlayer.test.jsx,
 * ScorePlayer.telemetry.test.jsx) doubles this exact module for the same
 * reason; this follows that pattern rather than inventing a second one.
 *
 * What is doubled is ONLY the geometry: the fixture's real MusicXML is still
 * parsed for its tempo, and the expectation below is compiled by the real
 * `compileScoreExpectation`. The real-engraving assertion — that OSMD actually
 * produces these onsets from this file — belongs to the Chromium scenario.
 */
const h = vi.hoisted(() => ({
  /** Published layout. One onset per note; two half notes to a bar, four bars. */
  steps: null,
  /** How many times the doubled engraver has republished (a re-engrave). */
  publishes: 0,
}));

/** A notehead the engraver would have produced, attached so classes are findable. */
const notehead = (midi) => {
  const el = document.createElement('span');
  el.className = 'mock-notehead';
  el.dataset.midi = String(midi);
  document.body.appendChild(el);
  return el;
};

/** bar 1: C4 D4 · bar 2: E4 F4 · bar 3: G4 A4 · bar 4: B4 C5 — two beats apart. */
const fourBarSteps = () => [60, 62, 64, 65, 67, 69, 71, 72].map((midi, index) => ({
  onsetQuarter: index * 2,
  measure: Math.floor(index / 2),
  number: Math.floor(index / 2) + 1,
  notes: [{ midi, staff: 0, durationQuarters: 2, el: notehead(midi) }],
}));

vi.mock('../../../../MusicNotation/renderers/MusicXmlRenderer.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    MusicXmlRenderer: ({ musicXml, onLayout, onReady, children }) => {
      useEffect(() => {
        h.publishes += 1;
        onLayout?.({
          width: 800,
          height: 300,
          flow: 'wrapped',
          scale: 1,
          transpose: 0,
          tempoEntries: [],
          measures: [0, 1, 2, 3],
          events: [],
          notes: [],
          steps: h.steps,
        });
        onReady?.();
      }, [musicXml, onLayout, onReady]);
      return <div data-testid="engraver" className="musicxml-renderer"><div className="musicxml-renderer__svg" />{children}</div>;
    },
  };
});

const { default: ScorePassage } = await import('./ScorePassage.jsx');

const midisOf = (expectation) => expectation.events.flatMap((event) => event.notes.map((note) => note.midi));
const measuresOf = (expectation) => expectation.events.flatMap((event) => event.notes.map((note) => note.measureIndex));
const lit = () => [...document.querySelectorAll('.mock-notehead.piano-note-lit')].map((el) => Number(el.dataset.midi));
const wrong = () => [...document.querySelectorAll('.mock-notehead.piano-note-wrong')].map((el) => Number(el.dataset.midi));
const dimmed = () => [...document.querySelectorAll('.mock-notehead.piano-score-passage__dim')].map((el) => Number(el.dataset.midi));

const renderPassage = (props = {}) => render(
  <ScorePassage
    musicXml={fourBars}
    sourceId="files:docs/sheet-music/four-bars.musicxml"
    measures={[2, 3]}
    cursorIndex={0}
    wrongMidi={null}
    {...props}
  />,
);

beforeEach(() => {
  document.body.innerHTML = '';
  h.publishes = 0;
  h.steps = fourBarSteps();
});

describe('ScorePassage expectation', () => {
  it('compiles the measure range the level asked for, and nothing outside it', async () => {
    const onExpectation = vi.fn();
    renderPassage({ onExpectation });

    await waitFor(() => expect(onExpectation).toHaveBeenCalled());
    const expectation = onExpectation.mock.calls.at(-1)[0];
    // Bars 2 and 3 as a child reads them off the page — the second and third
    // printed bars, which are layout indices 1 and 2.
    expect(midisOf(expectation)).toEqual([64, 65, 67, 69]);
    expect(measuresOf(expectation).every((index) => index >= 1 && index <= 2)).toBe(true);
    expect(expectation.source).toMatchObject({ kind: 'score', id: 'files:docs/sheet-music/four-bars.musicxml' });
  });

  it('takes its tempo from the score itself when the engraver reports none', async () => {
    const onExpectation = vi.fn();
    renderPassage({ onExpectation });

    await waitFor(() => expect(onExpectation).toHaveBeenCalled());
    // The fixture carries `<sound tempo="80"/>`. A cued attempt is graded
    // against this, and `createAssessmentAttempt` rejects a timed attempt whose
    // tempo map does not start at onset zero — so this is load-bearing, not
    // decorative.
    expect(onExpectation.mock.calls.at(-1)[0].tempoMap).toEqual([{ onsetQuarter: 0, bpm: 80 }]);
  });

  it('compiles the whole score when the level named no measures', async () => {
    const onExpectation = vi.fn();
    renderPassage({ measures: null, onExpectation });

    await waitFor(() => expect(onExpectation).toHaveBeenCalled());
    expect(midisOf(onExpectation.mock.calls.at(-1)[0])).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });

  it('publishes nothing at all when the engraving reported no notes', async () => {
    h.steps = [];
    const onExpectation = vi.fn();
    renderPassage({ onExpectation });

    await waitFor(() => expect(h.publishes).toBeGreaterThan(0));
    // An empty expectation would build an attempt that is complete before the
    // first note — a gate that opens itself. Say nothing instead and let the
    // run stay unstarted, which its host resolves as unavailable (fails open).
    expect(onExpectation).not.toHaveBeenCalled();
  });
});

describe('ScorePassage cursor feedback', () => {
  it('lights the note the cursor is sitting on, and moves with it', async () => {
    const view = renderPassage({ onExpectation: vi.fn(), cursorIndex: 0 });
    await waitFor(() => expect(lit()).toEqual([64]));

    view.rerender(
      <ScorePassage
        musicXml={fourBars}
        sourceId="files:docs/sheet-music/four-bars.musicxml"
        measures={[2, 3]}
        cursorIndex={2}
        wrongMidi={null}
        onExpectation={vi.fn()}
      />,
    );
    await waitFor(() => expect(lit()).toEqual([67]));
  });

  it('flashes the note that was owed when a wrong one is played', async () => {
    const view = renderPassage({ onExpectation: vi.fn(), cursorIndex: 1 });
    await waitFor(() => expect(lit()).toEqual([65]));
    expect(wrong()).toEqual([]);

    view.rerender(
      <ScorePassage
        musicXml={fourBars}
        sourceId="files:docs/sheet-music/four-bars.musicxml"
        measures={[2, 3]}
        cursorIndex={1}
        wrongMidi={61}
        onExpectation={vi.fn()}
      />,
    );
    await waitFor(() => expect(wrong()).toEqual([65]));
  });

  it('dims the bars either side of the passage so the ask is the focused thing', async () => {
    renderPassage({ onExpectation: vi.fn() });
    await waitFor(() => expect(lit()).toEqual([64]));
    expect(dimmed()).toEqual([60, 62, 71, 72]);
  });
});
