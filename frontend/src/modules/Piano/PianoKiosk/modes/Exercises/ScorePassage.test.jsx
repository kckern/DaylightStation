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
  engravedXml: null,
  systems: 1,
  scales: [],
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
    MusicXmlRenderer: ({ musicXml, scale = 1, onLayout, onReady, onFailed, children }) => {
      useEffect(() => {
        h.engravedXml = musicXml;
        h.scales.push(scale);
        if (!musicXml) return;
        // The real renderer's terminal failure: it raises its placeholder and
        // NEVER calls onLayout. That is the exact state real OSMD reaches under
        // happy-dom, and the state a gate used to hang in.
        if (h.engraveFails) { onFailed?.({ error: 'Could not read this score.' }); return; }
        h.publishes += 1;
        const shown = [...new DOMParser().parseFromString(musicXml, 'application/xml').querySelectorAll('part:first-of-type > measure')]
          .map((measure) => Number(measure.getAttribute('number')) - 1);
        const first = shown[0] ?? 0;
        const systemCount = h.systems === 3 && scale < 1 ? 2 : h.systems;
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
          steps: h.steps.filter((step) => shown.includes(step.measure)).map((step) => ({ ...step, measure: step.measure - first })),
          staves: Array.from({ length: systemCount }, (_, system) => ({ system, staff: 0 })),
        });
        onReady?.();
        // `onFailed` is deliberately NOT a dep — the real renderer holds it in a
        // ref precisely so an unstable error callback can never re-trigger an
        // engrave. The double mirrors that contract.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [musicXml, onLayout, onReady, scale]);
      return <div data-testid="engraver" className="musicxml-renderer"><div className="musicxml-renderer__svg" />{children}</div>;
    },
  };
});

const { default: ScorePassage, fitPassageLayout, balancedSystemBreak, passageCursorBounds, systemBreakMatches } = await import('./ScorePassage.jsx');

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
  h.engravedXml = null;
  h.systems = 1;
  h.scales = [];
  h.steps = fourBarSteps();
});

describe('ScorePassage layout fitting', () => {
  it('only accepts a forced breakpoint when the second engraving actually used it', () => {
    const split = (at) => Array.from({ length: 5 }, (_, index) => ({
      left: index < at ? index * 100 : (index - at) * 100,
      right: index < at ? (index + 1) * 100 : (index - at + 1) * 100,
      top: index < at ? index * 3 : 200 + index * 4,
    }));
    expect(systemBreakMatches(split(3), 3)).toBe(true);
    expect(systemBreakMatches(split(4), 3)).toBe(false);
  });
  it('rebalances a five-bar 4+1 orphan to the width-balanced 3+2 breakpoint', () => {
    const bounds = [
      { left: 0, right: 100, top: 0 }, { left: 100, right: 200, top: 0 },
      { left: 200, right: 300, top: 0 }, { left: 300, right: 400, top: 0 },
      { left: 0, right: 100, top: 200 },
    ];
    expect(balancedSystemBreak(bounds)).toBe(3);
  });

  it('balances by bar count even when notation widths and vertical ink bounds vary', () => {
    const bounds = [
      { left: 0, right: 220, top: 4 }, { left: 220, right: 280, top: -7 },
      { left: 280, right: 340, top: 8 }, { left: 340, right: 400, top: 2 },
      { left: 0, right: 80, top: 205 },
    ];
    expect(balancedSystemBreak(bounds)).toBe(3);
  });

  it('does not re-engrave an already balanced two-system passage or a one-system passage', () => {
    const balanced = [
      { left: 0, right: 100, top: 0 }, { left: 100, right: 200, top: 0 }, { left: 200, right: 300, top: 0 },
      { left: 0, right: 100, top: 200 }, { left: 100, right: 200, top: 200 },
    ];
    expect(balancedSystemBreak(balanced)).toBeNull();
    expect(balancedSystemBreak(balanced.map((bound) => ({ ...bound, top: 0 })))).toBeNull();
  });

  it('accepts one or two systems without changing scale', () => {
    expect(fitPassageLayout({ layout: { staves: [{ system: 0 }, { system: 1 }] }, scale: 1, minScale: 0.65, maxSystems: 2 }))
      .toEqual({ accepted: true, nextScale: null });
  });

  it('reduces a three-system passage before accepting its layout', () => {
    expect(fitPassageLayout({ layout: { staves: [{ system: 0 }, { system: 1 }, { system: 2 }] }, scale: 1, minScale: 0.65, maxSystems: 2 }))
      .toEqual({ accepted: false, nextScale: 0.67 });
  });

  it('rejects a passage that still exceeds two systems at minimum readable scale', () => {
    expect(fitPassageLayout({ layout: { staves: [{ system: 0 }, { system: 1 }, { system: 2 }] }, scale: 0.65, minScale: 0.65, maxSystems: 2 }))
      .toEqual({ accepted: false, nextScale: null });
  });

  it('re-engraves a three-system passage smaller before publishing its expectation', async () => {
    h.systems = 3;
    const onExpectation = vi.fn();
    renderPassage({ onExpectation });

    await waitFor(() => expect(onExpectation).toHaveBeenCalled());
    expect(h.scales).toEqual(expect.arrayContaining([1, 0.67]));
  });

  it('reports a passage that cannot fit two systems at the minimum readable scale', async () => {
    h.systems = 4;
    const onUnrunnable = vi.fn();
    renderPassage({ onExpectation: vi.fn(), onUnrunnable });

    await waitFor(() => expect(onUnrunnable).toHaveBeenCalledWith('passage-too-dense'));
    expect(h.scales).toEqual(expect.arrayContaining([1, 0.65]));
  });
});

describe('ScorePassage expectation', () => {
  it('engraves only the requested passage instead of greying the rest of the score', async () => {
    renderPassage({ onExpectation: vi.fn() });
    await waitFor(() => expect(h.engravedXml).toBeTruthy());

    const document = new DOMParser().parseFromString(h.engravedXml, 'application/xml');
    expect([...document.querySelectorAll('part')].map((part) => (
      [...part.querySelectorAll(':scope > measure')].map((measure) => measure.getAttribute('number'))
    ))).toEqual([['2', '3']]);
  });

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

  it('accepts canonical measure indices without interpreting printed numbering', async () => {
    const onExpectation = vi.fn();
    renderPassage({ measures: [0, 0], rangeIndices: { start: 1, end: 2 }, onExpectation });
    await waitFor(() => expect(onExpectation).toHaveBeenCalled());
    expect(midisOf(onExpectation.mock.calls.at(-1)[0])).toEqual([64, 65, 67, 69]);
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

  it('filters the expectation and engraving to the selected score part', async () => {
    const grandStaff = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves><clef number="1"><sign>G</sign></clef><clef number="2"><sign>F</sign></clef></attributes><note><rest/><duration>1</duration><staff>1</staff></note><backup><duration>1</duration></backup><note><rest/><duration>1</duration><staff>2</staff></note></measure><measure number="2"><note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><staff>1</staff></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><staff>1</staff></note><backup><duration>2</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><staff>2</staff></note><note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><staff>2</staff></note></measure></part></score-partwise>`;
    h.steps = [
      { onsetQuarter: 0, measure: 1, notes: [{ midi: 48, staff: 0, durationQuarters: 1, el: notehead(48) }] },
      { onsetQuarter: 1, measure: 1, notes: [{ midi: 50, staff: 0, durationQuarters: 1, el: notehead(50) }] },
    ];
    const onExpectation = vi.fn();
    renderPassage({ musicXml: grandStaff, measures: [2, 2], activeParts: ['lh'], onExpectation });

    await waitFor(() => expect(onExpectation).toHaveBeenCalled());
    expect(midisOf(onExpectation.mock.calls.at(-1)[0])).toEqual([48, 50]);
    const engraved = new DOMParser().parseFromString(h.engravedXml, 'application/xml');
    expect([...engraved.querySelectorAll('note pitch octave')].map((node) => node.textContent)).toEqual(['3', '3']);
    expect([...engraved.querySelectorAll('note staff')].every((node) => node.textContent === '1')).toBe(true);
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

  it('reports an excerpt whose engraver returned no playable notes', async () => {
    // Once the selected document is a standalone excerpt, an empty geometry
    // answer has the same terminal meaning as any other engraving with no notes.
    h.steps = fourBarSteps().filter((step) => step.measure < 2);
    const onExpectation = vi.fn();
    const onUnrunnable = vi.fn();
    renderPassage({ measures: [3, 4], onExpectation, onUnrunnable });

    await waitFor(() => expect(onUnrunnable).toHaveBeenCalledWith('no-engraved-notes'));
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
  it('builds one onset cursor spanning the active staff, including chord width and ledger notes', () => {
    expect(passageCursorBounds({
      noteBounds: [{ left: 120, right: 132, top: 42, bottom: 54 }, { left: 129, right: 143, top: 18, bottom: 31 }],
      staffBoxes: [
        { system: 0, staff: 0, left: 20, right: 760, top: 50, lineSpacing: 10 },
        { system: 0, staff: 1, left: 20, right: 760, top: 150, lineSpacing: 10 },
      ],
      activeStaffs: [0],
    })).toEqual({ x: 114, y: 8, width: 35, height: 92 });
  });

  it('spans both staves for a hands-together onset but not another system', () => {
    expect(passageCursorBounds({
      noteBounds: [{ left: 200, right: 212, top: 70, bottom: 82 }],
      staffBoxes: [
        { system: 0, staff: 0, top: 50, lineSpacing: 10 },
        { system: 0, staff: 1, top: 150, lineSpacing: 10 },
        { system: 1, staff: 0, top: 350, lineSpacing: 10 },
      ],
      activeStaffs: [0, 1],
      onsetStaffs: [0],
    })).toEqual({ x: 194, y: 40, width: 24, height: 160 });
  });

  it('uses the onset staff to identify the system when ledger notes sit between staves', () => {
    expect(passageCursorBounds({
      noteBounds: [{ left: 200, right: 212, top: 118, bottom: 130 }],
      staffBoxes: [
        { system: 0, staff: 0, top: 50, lineSpacing: 10 },
        { system: 1, staff: 1, top: 150, lineSpacing: 10 },
      ],
      activeStaffs: [0, 1],
      onsetStaffs: [1],
    })?.y).toBe(108);
  });
  it('exposes whether the score-position cursor is enabled', async () => {
    const view = renderPassage({ onExpectation: vi.fn(), showCursor: false });
    await waitFor(() => expect(lit()).toEqual([64]));
    expect(view.container.querySelector('.piano-score-passage')).toHaveAttribute('data-cursor-enabled', 'false');
    view.rerender(<ScorePassage musicXml={fourBars} sourceId="score" measures={[2, 3]}
      cursorIndex={0} showCursor onExpectation={vi.fn()} />);
    expect(view.container.querySelector('.piano-score-passage')).toHaveAttribute('data-cursor-enabled', 'true');
  });

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

  it('does not keep out-of-passage bars around as grey context', async () => {
    renderPassage({ onExpectation: vi.fn() });
    await waitFor(() => expect(lit()).toEqual([64]));
    expect(dimmed()).toEqual([]);
  });
});

describe('ScorePassage recorded verdicts (timed runs)', () => {
  const verdictMap = (entries) => new Map(entries.map(([index, byMidi]) => [index, new Map(byMidi)]));
  const verdictOf = (midi) => document.querySelector(`.mock-notehead[data-midi="${midi}"]`).getAttribute('data-verdict');
  const classed = (name) => [...document.querySelectorAll(`.mock-notehead.${name}`)].map((el) => Number(el.dataset.midi));

  it('paints each engraved note from its verdict, keyed by expectation event index', async () => {
    const verdicts = verdictMap([
      [0, [[64, { state: 'hit', driftMs: 5 }]]],
      [1, [[65, { state: 'late', driftMs: 450 }]]],
      [2, [[67, { state: 'lapsed' }]]],
    ]);
    const onExpectation = vi.fn();
    renderPassage({ onExpectation, verdicts, cursorIndex: 2 });
    await waitFor(() => expect(onExpectation).toHaveBeenCalled());
    await waitFor(() => expect(classed('piano-note-verdict-hit')).toEqual([64]));
    expect(classed('piano-note-verdict-late')).toEqual([65]);
    expect(classed('piano-note-verdict-unplayed')).toEqual([67]);
    expect(verdictOf(65)).toBe('late');
    // No green anywhere the record does not say so.
    expect(classed('piano-note-verdict-hit')).not.toContain(65);
  });

  it('marks the note still owed at a recorded wrong, and ignores the live wrongMidi flash', async () => {
    const verdicts = verdictMap([[1, [[70, { state: 'wrong', midi: 70 }]]]]);
    const onExpectation = vi.fn();
    renderPassage({ onExpectation, verdicts, cursorIndex: 0, wrongMidi: 61 });
    await waitFor(() => expect(onExpectation).toHaveBeenCalled());
    await waitFor(() => expect(wrong()).toEqual([65]));
  });
});
