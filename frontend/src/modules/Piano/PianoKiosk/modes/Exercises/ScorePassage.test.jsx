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
  /** Reproduce the placeholder state: OSMD threw, no layout is ever published. */
  engraveFails: false,
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
    MusicXmlRenderer: ({ musicXml, onLayout, onReady, onFailed, children }) => {
      useEffect(() => {
        // The real renderer's terminal failure: it raises its placeholder and
        // NEVER calls onLayout. That is the exact state real OSMD reaches under
        // happy-dom, and the state a gate used to hang in.
        if (h.engraveFails) { onFailed?.({ error: 'Could not read this score.' }); return; }
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
        // `onFailed` is deliberately NOT a dep — the real renderer holds it in a
        // ref precisely so an unstable error callback can never re-trigger an
        // engrave. The double mirrors that contract.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
  h.engraveFails = false;
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

  it('does not publish while the engraver is still working — that is not an answer', async () => {
    // The pre-layout state must stay SILENT on both channels. A component that
    // reported "unrunnable" here would fail every score open before it started.
    const onExpectation = vi.fn();
    const onUnrunnable = vi.fn();
    h.steps = fourBarSteps();
    renderPassage({ onExpectation, onUnrunnable, musicXml: fourBars });

    await waitFor(() => expect(onExpectation).toHaveBeenCalled());
    expect(onUnrunnable).not.toHaveBeenCalled();
  });
});

/**
 * The three ways a score can produce no ask at all. Each one used to end in a
 * component that published nothing and said nothing — which, upstream, was a
 * child sitting on "Getting the music ready…" forever, because "wait" and "this
 * will never work" were the same silence.
 */
describe('ScorePassage terminal failures', () => {
  it('reports the engraver reaching its placeholder — no layout is ever coming', async () => {
    h.engraveFails = true;
    const onExpectation = vi.fn();
    const onUnrunnable = vi.fn();
    renderPassage({ onExpectation, onUnrunnable });

    await waitFor(() => expect(onUnrunnable).toHaveBeenCalledWith('engrave-failed'));
    expect(onExpectation).not.toHaveBeenCalled();
  });

  it('reports an engraving that carried no notes', async () => {
    h.steps = [];
    const onExpectation = vi.fn();
    const onUnrunnable = vi.fn();
    renderPassage({ onExpectation, onUnrunnable });

    await waitFor(() => expect(onUnrunnable).toHaveBeenCalledWith('no-engraved-notes'));
    expect(onExpectation).not.toHaveBeenCalled();
  });

  it('reports a range naming bars the document does not have', async () => {
    const onExpectation = vi.fn();
    const onUnrunnable = vi.fn();
    // Bars 9-12 of a four-bar file. An expectation of no notes builds an attempt
    // that is COMPLETE before the first note — a gate that opens itself.
    renderPassage({ measures: [9, 12], onExpectation, onUnrunnable });

    await waitFor(() => expect(onUnrunnable).toHaveBeenCalledWith('passage-empty'));
    expect(onExpectation).not.toHaveBeenCalled();
  });

  it('reports a passage of nothing but rests', async () => {
    // The geometry walk does not emit rests, so a rest-only bar contributes no
    // notes and the range selects nothing playable. Bars 3-4 here are silent.
    h.steps = fourBarSteps().filter((step) => step.measure < 2);
    const onExpectation = vi.fn();
    const onUnrunnable = vi.fn();
    renderPassage({ measures: [3, 4], onExpectation, onUnrunnable });

    await waitFor(() => expect(onUnrunnable).toHaveBeenCalledWith('passage-empty'));
    expect(onExpectation).not.toHaveBeenCalled();
  });

  it('says so once, not once per render', async () => {
    h.engraveFails = true;
    const onUnrunnable = vi.fn();
    const view = renderPassage({ onExpectation: vi.fn(), onUnrunnable });
    await waitFor(() => expect(onUnrunnable).toHaveBeenCalledTimes(1));

    view.rerender(
      <ScorePassage
        musicXml={fourBars}
        sourceId="files:docs/sheet-music/four-bars.musicxml"
        measures={[2, 3]}
        cursorIndex={0}
        wrongMidi={null}
        onExpectation={vi.fn()}
        onUnrunnable={onUnrunnable}
      />,
    );
    expect(onUnrunnable).toHaveBeenCalledTimes(1);
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
