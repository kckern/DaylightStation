// WorkPlacard.test.jsx — mirror the mount style of ComposerCard.test.jsx.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass-embedded';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import WorkPlacard, { plateText } from './WorkPlacard.jsx';

// COMPILE EACH SHEET ONCE PER FILE. A stylesheet cannot change mid-run, but
// `withStyles()` recompiled it on every call — up to 20 times in this file
// alone, across nine specs that each do the same. `sass.compile` is
// synchronous and CPU-heavy, and under a full parallel sweep (~1,000 files on
// every core) that redundant work is what starves a worker past its timeout,
// failing whichever timing-shaped test it was inside. Memoised by path.
const __sassCache = new Map();
const compileSheetOnce = (file) => {
  if (!__sassCache.has(file)) __sassCache.set(file, sass.compile(file));
  return __sassCache.get(file);
};


const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA = {
  piece: { title: 'Violin Concerto in E major, "Spring"', opus: 'Op. 8 No. 1, RV 269', composed: 'by 1725', premiered: 'Published Amsterdam, 1725' },
  composer: { name: 'Antonio Vivaldi' },
};

it('engraves the piece title and its provenance line', () => {
  const { container } = render(<WorkPlacard data={DATA} position={0} duration={628} playing region={{ slot: 'top' }} />);
  expect(container.querySelector('.surround-work-placard__title').textContent).toContain('Spring');
  const meta = container.querySelector('.surround-work-placard__meta').textContent;
  expect(meta).toContain('Op. 8 No. 1');
  expect(meta).toContain('1725');
});

/**
 * Design wave 4 — THE TITLE LEADS. "When I walk in, I want it to be clear we're
 * playing the Violin Concerto in E major." The plate is the headline of the
 * whole screen, so the title carries display type and the meta line stays a
 * provenance whisper beneath it.
 *
 * The floor is tied to the size this wave replaces (1.5rem) rather than to the
 * exact number picked, so a later tune stays free while a regression back to a
 * caption-sized title fails. The RATIO is the other half: a big title next to
 * an equally big meta line is not a hierarchy.
 *
 * Compiled from the real SCSS — the vitest config runs `css: false`, so a plain
 * render would read UA defaults and pass whatever the stylesheet said.
 */
it('sets the work title as the loudest type on the plate', () => {
  const css = compileSheetOnce(path.join(__dirname, 'WorkPlacard.scss')).css.replace(/\s+/g, ' ');
  const size = (sel) => {
    const rule = css.match(new RegExp(`\\.surround-work-placard__${sel} \\{([^}]*)\\}`))?.[1] ?? '';
    // The title's size is `var(--plate-size, 2.05rem)` since the plate learned
    // to fit a container's segment names: the FALLBACK is the size an unfitted
    // plate renders at, which is the size this spec is about.
    const m = rule.match(/font-size: (?:var\(--plate-size, )?([\d.]+)rem/);
    expect(m, `no rem font-size on __${sel}`).not.toBeNull();
    return parseFloat(m[1]);
  };
  const title = size('title');
  const meta = size('meta');
  expect(title, `title is ${title}rem — no bigger than the size it replaced`).toBeGreaterThan(1.5);
  expect(title / meta, 'the meta line competes with the title').toBeGreaterThan(2);
  // The guard, not the layout: the meta line still ellipsizes rather than
  // wrapping the plate into a paragraph if a future authoring runs long.
  expect(css).toMatch(/\.surround-work-placard__meta \{[^}]*text-overflow: ellipsis/);
});

it('renders nothing without a piece — an empty plate is worse than no plate', () => {
  const { container } = render(<WorkPlacard data={{ composer: { name: 'X' } }} position={0} duration={0} region={{ slot: 'top' }} />);
  expect(container.firstChild).toBeNull();
});

/**
 * SMART QUOTES AT THE RENDER SEAM (design wave 7).
 *
 * The plate is the frame's largest type and both live works carry a nickname in
 * straight double quotes, so it is the surface where an unset mark is most
 * obviously wrong. The curl happens here rather than in the corpus: the corpus
 * is data a human edits by hand, and a migration would have to be re-run after
 * every edit.
 */
describe('WorkPlacard — smart quotes', () => {
  it('curls the nickname in the title — the real Eroica string, verbatim', () => {
    const { getByTestId } = render(
      <WorkPlacard data={{ piece: { title: 'Symphony No. 3 in E-flat major, "Eroica"' } }} />,
    );
    expect(getByTestId('surround-work-placard').textContent)
      .toContain('Symphony No. 3 in E-flat major, “Eroica”');
  });

  it('curls the nickname in Vivaldi’s title too', () => {
    const { getByTestId } = render(
      <WorkPlacard data={{ piece: { title: 'Violin Concerto in E major, "Spring"' } }} />,
    );
    expect(getByTestId('surround-work-placard').textContent).toContain('“Spring”');
  });

  it('curls the provenance line', () => {
    const { getByTestId } = render(
      <WorkPlacard data={{ piece: { title: 'X', premiered: "Vienna, at the Prince's palace" } }} />,
    );
    expect(getByTestId('surround-work-placard').textContent).toContain('Prince’s');
    expect(getByTestId('surround-work-placard').textContent).not.toContain("'");
  });
});

/**
 * THE INTERPUNCT'S AIR (wave 8, critique finding §1.3).
 *
 * The provenance line was joined with `'   ·   '` — three spaces either side of
 * the mark — and HTML collapses a whitespace run to a single space unless a
 * `white-space: pre*` rule applies, which none did. The engraved plate's
 * breathing room existed only in the source code. It is an element with an `em`
 * margin now, which is the mechanism that actually renders and also the one
 * that scales with the type.
 *
 * TO GO RED: put the `join('   ·   ')` back — no `__sep` element is produced.
 */
describe('WorkPlacard — the provenance line’s separators', () => {
  it('sets the interpunct as an element, not as collapsible whitespace', async () => {
    const { container } = render(
      <WorkPlacard data={DATA} position={0} duration={628} playing region={{ slot: 'top' }} />,
    );
    const seps = container.querySelectorAll('.surround-work-placard__sep');
    // Three facts, two separators.
    expect(seps).toHaveLength(2);
    seps.forEach((s) => expect(s.textContent).toBe('·'));
    // ...and its air is a fraction of the type, so it holds at every screen.
    const css = (await sass.compileAsync(path.join(__dirname, 'WorkPlacard.scss'))).css;
    expect(css).toMatch(/\.surround-work-placard__sep\s*\{[^}]*margin:\s*0\s+[\d.]+em/);
  });

  it('sets no separator at all when the corpus authored one fact', () => {
    const { container } = render(
      <WorkPlacard
        data={{ piece: { title: 'Spring', opus: 'Op. 8 No. 1' } }}
        position={0} duration={0} region={{ slot: 'top' }}
      />,
    );
    expect(container.querySelectorAll('.surround-work-placard__sep')).toHaveLength(0);
    expect(container.querySelector('.surround-work-placard__meta').textContent).toBe('Op. 8 No. 1');
  });
});

/* ========================================================================== */
/* THE CONTAINER PLATE — the plate names what is PLAYING                       */
/* ========================================================================== */

/**
 * The polonaise season (`plex:696237`), reduced to two of its seven parts.
 * Field for field the shape `YamlSurroundStore#composeOne` publishes: seven
 * media items, one work each, every segment stamped with its own `group`.
 */
const SET = {
  contentId: 'plex:696243',
  piece: { title: 'Polonaises', short_title: "Chopin's Polonaises", composed: '1835-1846' },
  timeline: { totalSounding: 3556, parts: [{ index: 0 }, { index: 1 }] },
  segments: [
    {
      n: 1, name: 'Polonaise in C-sharp minor, Op. 26 No. 1', contentId: 'plex:696238',
      part: 0, offset: 0, duration: 447, start: 0, end: 447,
      group: { index: 0, work: 'chopin/polonaise-op-26-no-1', title: 'Polonaise No. 1…' },
    },
    {
      n: 6, name: 'Polonaise in A-flat major, Op. 53', contentId: 'plex:696243',
      part: 1, offset: 447, duration: 449, start: 0, end: 449,
      group: { index: 1, work: 'chopin/polonaise-op-53', title: 'Polonaise No. 6…' },
    },
  ],
  facts: ['The polonaise is a Polish processional dance.'],
};

const at = (position, data = SET) => render(
  <WorkPlacard data={data} position={position} duration={449} playing region={{ slot: 'top' }} />,
);

describe('WorkPlacard — a container names the sounding segment', () => {
  /**
   * TO GO RED: headline `piece.title` on a container as well — the plate reads
   * "Polonaises" for fifty-nine minutes and this fails with
   *   expected 'Polonaises' to be 'Polonaise in A-flat major, Op. 53'
   */
  it('headlines the current segment with the set beneath it', () => {
    // 200s into plex:696243, which is the SECOND of the two parts drawn here.
    const { getByTestId } = at(200);
    expect(getByTestId('surround-placard-title').textContent)
      .toBe('Polonaise in A-flat major, Op. 53');
    expect(getByTestId('surround-placard-set').textContent)
      .toBe("Chopin’s Polonaises·2 of 2");
  });

  /**
   * The ordinal is the segment's place on the rail, not the part's index and
   * not a constant.
   * TO GO RED: number from the AUTHORED index (`mapped.index + 1`) rather than
   * the drawn one, or hard-code 1.
   */
  it('counts the segment’s place along the whole set', () => {
    const { getByTestId } = at(100, { ...SET, contentId: 'plex:696238' });
    expect(getByTestId('surround-placard-title').textContent)
      .toBe('Polonaise in C-sharp minor, Op. 26 No. 1');
    expect(getByTestId('surround-placard-set').textContent)
      .toBe("Chopin’s Polonaises·1 of 2");
  });

  /**
   * Nothing sounding — the position is past this item's own segment (the
   * applause after the sixth polonaise, before the seventh loads).
   * THE LINE IS RESERVED, NOT REMOVED: an element that disappeared would give
   * its height back and the plate would shrink by a line between two works.
   * TO GO RED: render the set line conditionally on `set` — `getByTestId`
   * throws "Unable to find an element by: [data-testid=surround-placard-set]".
   */
  it('keeps the set line’s height with nothing sounding, and names the work', () => {
    const { getByTestId } = at(600);
    expect(getByTestId('surround-placard-set')).toBeTruthy();
    // A NO-BREAK SPACE, not a plain one, and the difference is the reserve
    // actually existing: a block whose only content is collapsible whitespace
    // generates no line box, so the "reserved" line is as absent as no element
    // would have been. It was a plain space until Chromium reported the plate
    // 17.28px shorter here than with a polonaise sounding
    // (`band.measure.test.jsx`), which is exactly the set line's own line box.
    expect(getByTestId('surround-placard-set').textContent).toBe('\u00a0');
    expect(getByTestId('surround-placard-title').textContent).toBe('Polonaises');
  });

  it('sets the interpunct as an element on the set line too, never as whitespace', () => {
    const { getByTestId } = at(200);
    const seps = getByTestId('surround-placard-set').querySelectorAll('.surround-work-placard__sep');
    expect(seps).toHaveLength(1);
    expect(seps[0].textContent).toBe('·');
  });

  it('carries the ruler the fit measures on, and only on a container', () => {
    expect(at(200).container.querySelector('.surround-work-placard__probe')).not.toBeNull();
    expect(at(200, EROICA).container.querySelector('.surround-work-placard__probe')).toBeNull();
  });
});

/* ========================================================================== */
/* THE REGRESSION THIS WAVE PROMISED: the Eroica's plate is untouched          */
/* ========================================================================== */

/**
 * The live Eroica payload (`plex:663134`), verbatim in shape: FOUR segments —
 * more than the polonaise set has parts — in ONE media item, and two of them
 * carrying an authored `note`. It is the payload every "is this a container"
 * shortcut gets wrong.
 */
const EROICA = {
  contentId: 'plex:663134',
  piece: {
    title: 'Symphony No. 3 in E-flat major, "Eroica"',
    short_title: "Beethoven's Third Symphony",
    opus: 'Op. 55', composed: '1803-04', premiered: 'Vienna, 1805', musicEndsAt: 2955,
  },
  timeline: { totalSounding: 2933.65, parts: [{ contentId: 'plex:663134', index: 0, sounding: 2933.65 }] },
  segments: [
    { n: 1, name: 'Allegro con brio', contentId: 'plex:663134', part: 0, offset: 0, duration: 954.65, start: 21.35, end: 976 },
    { n: 2, name: 'Marcia funebre. Adagio assai', note: 'The funeral march.', contentId: 'plex:663134', part: 0, offset: 954.65, duration: 949, start: 976, end: 1925 },
    { n: 3, name: 'Scherzo. Allegro vivace', contentId: 'plex:663134', part: 0, offset: 1903.65, duration: 353, start: 1925, end: 2278 },
    { n: 4, name: 'Finale. Allegro molto', contentId: 'plex:663134', part: 0, offset: 2256.65, duration: 677, start: 2278, end: 2955 },
  ],
  facts: ['One.', 'Two.'],
};

/**
 * THE GOLDEN. Captured by rendering the plate at commit b1f9f6725 — before this
 * task — with the payload above, and frozen here character for character. The
 * ONE addition is `data-testid="surround-placard-title"`, which is a handle for
 * a spec and not a mark on the screen.
 *
 * It is a golden rather than a list of assertions because the requirement is
 * literally "exactly as it does today": no extra element, no extra attribute,
 * no changed text, no reordering. Any of those is a rug-pull on the one payload
 * this wave promised not to touch.
 *
 * TO GO RED: drop the container gate (`isComposedContainer`) — the plate then
 * headlines "Marcia funebre. Adagio assai", grows a set line and a ruler, and
 * this fails on the first character of the headline.
 */
const EROICA_PLATE = '<div class="surround-work-placard" data-testid="surround-work-placard">'
  + '<h2 class="surround-work-placard__title" data-testid="surround-placard-title">'
  + 'Symphony No. 3 in E-flat major, “Eroica”</h2>'
  + '<p class="surround-work-placard__meta">Op. 55'
  + '<span class="surround-work-placard__sep" aria-hidden="true">·</span>1803-04'
  + '<span class="surround-work-placard__sep" aria-hidden="true">·</span>Vienna, 1805</p></div>';

describe('WorkPlacard — one media item is not a container', () => {
  it('renders the Eroica’s plate exactly as it did before this wave', () => {
    // 1200s: inside the funeral march, the movement that HAS a note — the state
    // in which a container-shaped plate would look most obviously different.
    const { container } = at(1200, EROICA);
    expect(container.innerHTML).toBe(EROICA_PLATE);
  });

  it('names the symphony at every position, not the movement', () => {
    [0, 1200, 2400, 2950].forEach((p) => {
      const { getByTestId, unmount } = at(p, EROICA);
      expect(getByTestId('surround-placard-title').textContent)
        .toBe('Symphony No. 3 in E-flat major, “Eroica”');
      unmount();
    });
  });
});

/* ========================================================================== */
/* THE PERFORMER LINE — the recording, not the work                            */
/* ========================================================================== */

describe('WorkPlacard — performer credit', () => {
  const WITH_PERF = {
    piece: {
      title: 'Symphony No. 3 in E-flat major, "Eroica"',
      opus: 'Op. 55', composed: '1803-04', premiered: 'Vienna, 1805',
      performance: 'hr-Sinfonieorchester . Andres Orozco-Estrada . Alte Oper Frankfurt, 11 February 2016',
    },
  };

  it('renders the performer line when piece.performance is present', () => {
    const { getByTestId } = render(<WorkPlacard data={WITH_PERF} position={0} />);
    const perf = getByTestId('surround-placard-performer');
    expect(perf.textContent).toContain('hr-Sinfonieorchester');
    expect(perf.textContent).toContain('Andres Orozco-Estrada');
    expect(perf.textContent).toContain('Alte Oper Frankfurt');
  });

  it('splits on interpuncts and renders separator elements', () => {
    const { getByTestId } = render(<WorkPlacard data={WITH_PERF} position={0} />);
    const seps = getByTestId('surround-placard-performer')
      .querySelectorAll('.surround-work-placard__sep');
    expect(seps).toHaveLength(2);
  });

  it('applies the compressed modifier when performance is present', () => {
    const { getByTestId } = render(<WorkPlacard data={WITH_PERF} position={0} />);
    expect(getByTestId('surround-work-placard').classList.contains('surround-work-placard--has-performer'))
      .toBe(true);
  });

  it('renders no performer line and no modifier when performance is absent', () => {
    const { container, getByTestId } = render(<WorkPlacard data={EROICA} position={0} />);
    expect(container.querySelector('.surround-work-placard__performer')).toBeNull();
    expect(getByTestId('surround-work-placard').classList.contains('surround-work-placard--has-performer'))
      .toBe(false);
  });

  it('handles a single-part performance string with no separators', () => {
    const data = { piece: { title: 'Étude', performance: 'Martha Argerich, piano' } };
    const { getByTestId } = render(<WorkPlacard data={data} position={0} />);
    expect(getByTestId('surround-placard-performer').textContent).toBe('Martha Argerich, piano');
    expect(getByTestId('surround-placard-performer')
      .querySelectorAll('.surround-work-placard__sep')).toHaveLength(0);
  });
});

describe('WorkPlacard — per-segment performance override on a container', () => {
  const SET_WITH_PERF = {
    ...SET,
    piece: { ...SET.piece, performance: 'Default Ensemble' },
    segments: [
      { ...SET.segments[0], performance: 'Krystian Zimerman' },
      { ...SET.segments[1] },
    ],
  };

  it('uses segment performance when present, piece performance when not', () => {
    const { getByTestId, unmount } = render(
      <WorkPlacard data={{ ...SET_WITH_PERF, contentId: 'plex:696238' }} position={100} duration={449} playing region={{ slot: 'top' }} />,
    );
    expect(getByTestId('surround-placard-performer').textContent).toBe('Krystian Zimerman');
    unmount();

    const { getByTestId: get2 } = render(
      <WorkPlacard data={SET_WITH_PERF} position={200} duration={449} playing region={{ slot: 'top' }} />,
    );
    expect(get2('surround-placard-performer').textContent).toBe('Default Ensemble');
  });
});

describe('WorkPlacard — per-segment performer on a single work', () => {
  const RECITAL = {
    contentId: 'plex:696230',
    piece: {
      title: 'Nocturnes', short_title: "Chopin's Nocturnes",
      performance: 'Klasse Michail Lifits . Festsaal Fürstenhaus, Weimar . 15 December 2023',
    },
    timeline: { totalSounding: 7100, parts: [{ contentId: 'plex:696230', index: 0, sounding: 7100 }] },
    segments: [
      { n: 1, label: 'In B-flat minor', contentId: 'plex:696230', part: 0, offset: 0, duration: 317, start: 30, end: 347, performance: 'Artemy Sokolovsky' },
      { n: 2, label: 'In E-flat major', contentId: 'plex:696230', part: 0, offset: 317, duration: 231, start: 347, end: 578, performance: 'Artemy Sokolovsky' },
      { n: 4, label: 'In F major', contentId: 'plex:696230', part: 0, offset: 548, duration: 259, start: 1007, end: 1266, performance: 'Tiankai Yu' },
    ],
  };

  it('shows the segment performer, not the piece default, at the right position', () => {
    const { getByTestId } = render(
      <WorkPlacard data={RECITAL} position={100} duration={7139} playing region={{ slot: 'top' }} />,
    );
    expect(getByTestId('surround-placard-performer').textContent).toBe('Artemy Sokolovsky');
  });

  it('falls back to piece.performance between segments (dead time)', () => {
    const { getByTestId } = render(
      <WorkPlacard data={RECITAL} position={800} duration={7139} playing region={{ slot: 'top' }} />,
    );
    const text = getByTestId('surround-placard-performer').textContent;
    expect(text).toContain('Klasse Michail Lifits');
  });
});

/* ========================================================================== */
/* plateText — the decision, on its own                                        */
/* ========================================================================== */

describe('plateText', () => {
  const PIECE = { title: 'Polonaises', short_title: "Chopin's Polonaises" };
  const SEG = { name: 'Polonaise in A-flat major, Op. 53' };

  it('headlines the segment and labels the set with its short title', () => {
    expect(plateText({ piece: PIECE, segment: SEG, ordinal: 6, count: 7 })).toEqual({
      title: 'Polonaise in A-flat major, Op. 53',
      set: { name: "Chopin's Polonaises", ordinal: 6, count: 7 },
    });
  });

  /** TO GO RED: read `title` first — the label becomes the catalogue "Polonaises". */
  it('falls back to the title where the corpus authored no short title', () => {
    expect(plateText({ piece: { title: 'Études' }, segment: { name: 'No. 3 in E major' }, ordinal: 3, count: 27 }))
      .toEqual({ title: 'No. 3 in E major', set: { name: 'Études', ordinal: 3, count: 27 } });
  });

  /**
   * A REFUSED NAME NEVER REACHES THE SCREEN. The fit has certified it cannot be
   * set whole at the plate's floor; showing it at any size is the ellipsis this
   * wave removes. The plate names the work instead — a smaller claim, and true.
   * TO GO RED: ignore `refused` — the title comes back as the segment name.
   */
  it('names the work instead of a name the fit refused', () => {
    expect(plateText({ piece: PIECE, segment: SEG, ordinal: 6, count: 7, refused: true }))
      .toEqual({ title: 'Polonaises', set: { name: "Chopin's Polonaises", ordinal: 6, count: 7 } });
  });

  it('writes no set line with nothing sounding, or on a rail that draws nothing', () => {
    expect(plateText({ piece: PIECE, segment: null, ordinal: 0, count: 7 }).set).toBeNull();
    expect(plateText({ piece: PIECE, segment: SEG, ordinal: 1, count: 0 }).set).toBeNull();
  });
});
