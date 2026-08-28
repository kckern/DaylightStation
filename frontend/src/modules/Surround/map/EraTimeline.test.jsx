import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import * as sass from 'sass-embedded';
import EraTimeline from './EraTimeline.jsx';
import {
  ERAS, TIMELINE_SPAN, NOMINAL_WIDTH_PX,
  ERA_LABEL_EM, ERA_LABEL_PX, ERA_LABEL_OVERHANG, ERA_LABEL_GAP_EM, ERA_LABEL_CLASH_EM,
  YEAR_ANCHOR_EDGE,
  datelineFor, eraLabelWidthPx, fractionFor, layoutEraLabels, subjectErasFor,
  yearAnchorFor,
} from './eraTimelineModel.js';

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

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
});

const NOTE = 'Written at the hinge — Classical forms stretched to Romantic scale and feeling. '
  + 'Many date the Romantic era from this symphony.';

const renderTimeline = (props = {}) => render(
  <EraTimeline
    period={props.period === undefined ? 'Classical to Romantic' : props.period}
    year={props.year === undefined ? 1804 : props.year}
    note={props.note === undefined ? NOTE : props.note}
    logger={props.logger ?? makeLogger()}
  />,
);


/**
 * THE MEASURED WIDTHS OF THE REAL SLOT.
 *
 * The plate the timeline is drawn on is the place carousel's mat, and the
 * carousel is in a rail that is 33% of the frame. Measured in the harness at the
 * three sizes the fleet ships: 284.8px on the 960x540 screen-root, 390.4px at
 * 1280x720, 601.6px at 1920x1080, less the mat's own 3px padding each side.
 */
const PLATE = { small: 278.8, kiosk: 384.4, hd: 595.6 };

describe('EraTimeline — the era table', () => {
  it('tiles the span with no gaps and no overlaps', () => {
    expect(ERAS[0].from).toBe(TIMELINE_SPAN.from);
    ERAS.forEach((era, i) => {
      if (i === 0) return;
      expect(era.from, `${era.name} does not begin where ${ERAS[i - 1].name} ends`)
        .toBe(ERAS[i - 1].to);
    });
    expect(ERAS[ERAS.length - 1].to).toBe(TIMELINE_SPAN.to);
  });

  it('names the four eras the design draws', () => {
    expect(ERAS.map((e) => e.name)).toEqual(['Renaissance', 'Baroque', 'Classical', 'Romantic']);
  });

  // The dates are contestable and the exported constant is where the argument
  // is settled. Freezing it is what stops a caller "fixing" 1750 in place.
  it('is frozen, so the argument stays in one file', () => {
    expect(Object.isFrozen(ERAS)).toBe(true);
    expect(Object.isFrozen(ERAS[0])).toBe(true);
    expect(Object.isFrozen(TIMELINE_SPAN)).toBe(true);
  });
});

describe('EraTimeline — which eras a period lights', () => {
  it('matches one era, case-insensitively', () => {
    expect(subjectErasFor('Baroque')).toEqual(['Baroque']);
    expect(subjectErasFor('baroque')).toEqual(['Baroque']);
    expect(subjectErasFor('BAROQUE')).toEqual(['Baroque']);
  });

  /**
   * A period naming two eras genuinely means both — the work sits across the
   * join, which is the one thing a timeline can show and a single label cannot.
   */
  it('lights BOTH eras a hinge period names', () => {
    expect(subjectErasFor('Classical to Romantic')).toEqual(['Classical', 'Romantic']);
  });

  it('reads a qualified period as the era it qualifies', () => {
    expect(subjectErasFor('Late Romantic')).toEqual(['Romantic']);
    expect(subjectErasFor('early Baroque')).toEqual(['Baroque']);
  });

  it('returns the eras in table order, whatever order the phrase names them', () => {
    expect(subjectErasFor('Romantic, after the Classical')).toEqual(['Classical', 'Romantic']);
  });

  it('lights nothing for a period the table has never heard of', () => {
    expect(subjectErasFor('Modernist')).toEqual([]);
    expect(subjectErasFor('')).toEqual([]);
    expect(subjectErasFor(null)).toEqual([]);
  });

  /**
   * Fix round 1 (review finding M4). A plain substring test lit CLASSICAL for
   * "Neoclassical" — a real, distinct 20th-century term this table does not
   * carry, not a hinge phrase naming the Classical era the way "Classical to
   * Romantic" does. Word-boundary matching is what tells the two apart, and it
   * must still light the genuine hinge and qualified phrases exactly as
   * before.
   */
  it('does not light an era for a period that merely contains its name as a substring', () => {
    expect(subjectErasFor('Neoclassical')).toEqual([]);
    expect(subjectErasFor('Neoclassicism')).toEqual([]);
  });
});

describe('EraTimeline — where a year falls', () => {
  it('puts the span’s ends at 0 and 1', () => {
    expect(fractionFor(TIMELINE_SPAN.from)).toBe(0);
    expect(fractionFor(TIMELINE_SPAN.to)).toBe(1);
  });

  it('places a year proportionally', () => {
    // 1804 of 1550..1910 is (1804-1550)/360.
    expect(fractionFor(1804)).toBeCloseTo(254 / 360, 6);
    expect(fractionFor(1725)).toBeCloseTo(175 / 360, 6);
  });

  // Rather than clamping a year onto the end of the rule and asserting
  // something false about it. A marker at the very edge would read as
  // "1910 or later", which is not what the drawing means.
  it('refuses a year outside the span, and anything that is not one', () => {
    expect(fractionFor(1490)).toBeNull();
    expect(fractionFor(1974)).toBeNull();
    expect(fractionFor(null)).toBeNull();
    expect(fractionFor('soon')).toBeNull();
  });
});

/**
 * THE LABEL FITTING. Pure, because it has to be judged at three widths and jsdom
 * measures every box as 0x0 — the component's only job is to hand this function
 * a real number off a ResizeObserver.
 */
describe('EraTimeline — which era names fit', () => {
  const namesAt = (widthPx, subjects) =>
    layoutEraLabels({ widthPx, subjects }).map((l) => l.name);

  it('drops the shortest band’s name on the rail, and writes it on a 1080p one', () => {
    // RENAISSANCE is eleven tracked characters over the fifty years that are
    // 14% of the line. It cannot point at its own band on the small plate.
    expect(namesAt(PLATE.small, ['Classical', 'Romantic'])).not.toContain('Renaissance');
    expect(namesAt(PLATE.kiosk, ['Classical', 'Romantic'])).not.toContain('Renaissance');
    expect(namesAt(PLATE.hd, ['Classical', 'Romantic'])).toContain('Renaissance');
  });

  it('never drops a subject, at any width the rail can produce', () => {
    Object.values(PLATE).forEach((w) => {
      const names = namesAt(w, ['Classical', 'Romantic']);
      expect(names, `a subject was dropped at ${w}px`).toContain('Classical');
      expect(names).toContain('Romantic');
    });
    // ...including at a width where nothing else survives at all.
    expect(namesAt(180, ['Renaissance'])).toContain('Renaissance');
  });

  /**
   * TWO ADJACENT SUBJECTS ARE SPREAD, NOT SHOVED.
   *
   * Measured before the fix: on the 278.8px plate "CLASSICAL" and "ROMANTIC"
   * both want the right-hand third, and a single forward nudge pushed
   * "ROMANTIC" past the plate's own edge, where the mat's `overflow: hidden`
   * cut it in half. The relaxation runs both ways, so the earlier label moves
   * left instead.
   */
  it('keeps two crowded subjects apart AND on the plate', () => {
    const placed = layoutEraLabels({ widthPx: PLATE.small, subjects: ['Classical', 'Romantic'] });
    const boxes = placed.map((l) => {
      const w = eraLabelWidthPx(l.name);
      const centre = (l.leftPct / 100) * PLATE.small;
      return { name: l.name, x0: centre - w / 2, x1: centre + w / 2 };
    });
    boxes.forEach((b) => {
      expect(b.x0, `${b.name} starts off the left of the plate`).toBeGreaterThanOrEqual(-0.01);
      expect(b.x1, `${b.name} runs off the right of the plate`)
        .toBeLessThanOrEqual(PLATE.small + 0.01);
    });
    const [a, b] = boxes.sort((x, y) => x.x0 - y.x0);
    expect(b.x0, `${a.name} and ${b.name} are printed into each other`)
      .toBeGreaterThanOrEqual(a.x1);
  });

  it('writes the labels in reading order, whatever order it placed them in', () => {
    const placed = layoutEraLabels({ widthPx: PLATE.hd, subjects: ['Classical', 'Romantic'] });
    const lefts = placed.map((l) => l.leftPct);
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    expect(placed.map((l) => l.name)).toEqual(['Renaissance', 'Baroque', 'Classical', 'Romantic']);
  });

  it('marks the subjects apart from the rest, so the stylesheet can', () => {
    const placed = layoutEraLabels({ widthPx: PLATE.hd, subjects: ['Baroque'] });
    const roles = Object.fromEntries(placed.map((l) => [l.name, l.role]));
    expect(roles.Baroque).toBe('subject');
    expect(roles.Classical).toBe('era');
  });

  /**
   * SHRINKING IS NOT AN OPTION — the 0.72rem floor is the ten-foot legibility
   * law, and a label nobody can read is worse than no label. So the fitting
   * decides in PIXELS at that fixed size, and a non-subject label that would
   * need to overhang its own band by more than half is dropped.
   */
  it('measures every label at the ten-foot floor, and drops rather than shrinks', () => {
    expect(ERA_LABEL_PX).toBeCloseTo(0.72 * 16, 6);
    expect(eraLabelWidthPx('Renaissance')).toBeGreaterThan(eraLabelWidthPx('Baroque'));
    // The overhang allowance is what makes the drop ADAPTIVE rather than
    // permanent: at 1 the shortest band's name would never appear at any width
    // the rail produces, and past ~2 it stops pointing at its own band.
    expect(ERA_LABEL_OVERHANG).toBeGreaterThan(1);
    expect(ERA_LABEL_OVERHANG).toBeLessThanOrEqual(2);
  });

  it('falls back to the nominal plate width rather than dividing by zero', () => {
    const nominal = layoutEraLabels({ widthPx: NOMINAL_WIDTH_PX, subjects: ['Baroque'] });
    expect(layoutEraLabels({ widthPx: 0, subjects: ['Baroque'] })).toEqual(nominal);
    expect(layoutEraLabels({ subjects: ['Baroque'] })).toEqual(nominal);
  });
});

describe('EraTimeline — the drawing', () => {
  it('draws one band per era, lighting the ones the period names', () => {
    const { container } = renderTimeline();
    const bands = [...container.querySelectorAll('[data-testid="surround-era-band"]')];
    expect(bands).toHaveLength(ERAS.length);
    const lit = bands.filter((b) => b.getAttribute('data-subject') === 'true')
      .map((b) => b.getAttribute('data-era'));
    expect(lit).toEqual(['Classical', 'Romantic']);
  });

  it('lays each band out at its own share of the line', () => {
    const { container } = renderTimeline();
    const baroque = container.querySelector('[data-era="Baroque"][data-testid="surround-era-band"]');
    // 1600-1750 of 1550-1910: starts at 50/360, spans 150/360.
    expect(parseFloat(baroque.style.left)).toBeCloseTo((50 / 360) * 100, 3);
    expect(parseFloat(baroque.style.width)).toBeCloseTo((150 / 360) * 100, 3);
  });

  it('marks the piece’s year, and writes it', () => {
    const { container } = renderTimeline();
    const marker = container.querySelector('[data-testid="surround-era-marker"]');
    expect(marker).not.toBeNull();
    expect(parseFloat(marker.style.left)).toBeCloseTo((254 / 360) * 100, 3);
    expect(container.querySelector('[data-testid="surround-era-year"]')).toHaveTextContent('1804');
  });

  it('draws no marker at all when the piece names no year', () => {
    const { container } = renderTimeline({ year: null });
    expect(container.querySelector('[data-testid="surround-era-marker"]')).toBeNull();
    expect(container.querySelector('[data-testid="surround-era-year"]')).toBeNull();
    // ...and the rest of the drawing is unharmed.
    expect(container.querySelectorAll('[data-testid="surround-era-band"]')).toHaveLength(4);
  });

  it('writes the period note beneath, inside the plate', () => {
    const { container } = renderTimeline();
    const note = container.querySelector('[data-testid="surround-era-note"]');
    expect(note).toHaveTextContent('Written at the hinge');
    // The wave-5 law: the box centres, an inner span clamps.
    expect(note.querySelector('.surround-era-timeline__note-line')).not.toBeNull();
  });

  it('renders no note element when none is authored', () => {
    const { container } = renderTimeline({ note: null });
    expect(container.querySelector('[data-testid="surround-era-note"]')).toBeNull();
    expect(container.querySelector('[data-testid="surround-era-timeline"]')).not.toBeNull();
  });

  it('renders NOTHING without a period — the slide has no subject', () => {
    const { container } = renderTimeline({ period: null });
    expect(container.innerHTML).toBe('');
  });

  it('still draws the line for a period the table does not know, and says so once', () => {
    const logger = makeLogger();
    const { container } = renderTimeline({ period: 'Modernist', year: null, logger });
    expect(container.querySelectorAll('[data-testid="surround-era-band"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-testid="surround-era-band"][data-subject="true"]'))
      .toHaveLength(0);
    const warns = logger.warn.mock.calls.filter((c) => c[0] === 'surround.era.period-unmatched');
    expect(warns).toHaveLength(1);
    expect(warns[0][1]).toEqual({ period: 'Modernist' });
  });

  it('does not warn when the period matched', () => {
    const logger = makeLogger();
    renderTimeline({ logger });
    expect(logger.warn.mock.calls.filter((c) => c[0] === 'surround.era.period-unmatched'))
      .toHaveLength(0);
  });

  it('does not throw where the environment has no ResizeObserver', () => {
    const original = global.ResizeObserver;
    delete global.ResizeObserver;
    try {
      expect(() => renderTimeline()).not.toThrow();
    } finally {
      if (original) global.ResizeObserver = original;
    }
  });
});

/**
 * The drawing is mostly CSS, and the vitest config runs `css: false` — so the
 * component's own SCSS import injects nothing and a computed-style assertion off
 * a plain render would read UA defaults and pass regardless. These specs compile
 * the REAL sheet, the pattern the rest of the feature established.
 */
describe('EraTimeline — the shipped design', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = compileSheetOnce(path.join(__dirname, 'EraTimeline.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };
  afterEach(() => { injected?.remove(); injected = null; });

  it('draws in the map’s ink family, with brass reserved for the piece’s own mark', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const band = css.match(/\.surround-era-timeline__band \{[^}]*\}/)[0];
    expect(band).toMatch(/background: var\(--ink-soft,/);
    const subject = css.match(/\.surround-era-timeline__band--subject \{[^}]*\}/)[0];
    expect(subject).toMatch(/background: var\(--ink,/);
    // The ladder is weight and value — never a colour of its own, which would
    // read as a sticker rather than as an engraving.
    expect(subject).not.toMatch(/background: var\(--brass/);
    expect(parseFloat(subject.match(/height: ([\d.]+)px/)[1]))
      .toBeGreaterThan(parseFloat(band.match(/height: ([\d.]+)px/)[1]));

    // ONE BRASS VALUE, ON ONE OBJECT (wave 10). The year, the thread it hangs
    // from and the bob it lands in are the same `--brass-lit`; the ladder
    // inside the object is opacity, which is the house's weight-and-value
    // grammar. `--brass` and `--brass-lit` on two marks an inch apart, with
    // nothing joining them, was two accents and therefore none.
    const marker = css.match(/\.surround-era-timeline__marker \{[^}]*\}/)[0];
    expect(marker).toMatch(/background: var\(--brass-lit,/);
    const year = css.match(/\.surround-era-timeline__year \{[^}]*\}/)[0];
    expect(year).toMatch(/color: var\(--brass-lit,/);
    const plumb = css.match(/\.surround-era-timeline__plumb \{[^}]*\}/)[0];
    expect(plumb).toMatch(/background: var\(--brass-lit,/);
    // Nothing else on the plate is brass at all.
    expect(css).not.toMatch(/var\(--brass,/);
  });

  /**
   * THE TYPE SCALE IS NOT FLAT — the finding that opened wave 10. Every mark on
   * the first version sat between 0.72rem and 0.95rem, so the one fact the
   * programme asserts was the smallest thing on the plate and the whole slide
   * read as an even grey from across the room.
   */
  it('gives the year the top of the type scale, alone', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const row = css.match(/\.surround-era-timeline__year-row \{[^}]*\}/)[0];
    const [, min, , max] = row
      .match(/font-size: clamp\(([\d.]+)rem, ([\d.]+)cqw, ([\d.]+)rem\)/).map(Number);
    // Even at its floor the year is more than twice the label floor's 0.72rem,
    // and nothing else on the plate is set anywhere near it.
    expect(min).toBeGreaterThan(0.72 * 2);
    expect(max).toBeGreaterThan(min);
    // The row carries the size so its own height tracks the clamp; the numeral
    // inherits it rather than restating a literal that could drift.
    const year = css.match(/\.surround-era-timeline__year \{[^}]*\}/)[0];
    expect(year).toContain('font-size: inherit');
  });

  /**
   * THE MARKER IS NOT A BARLINE. 1742 stands eight years from the 1750 join —
   * a few pixels at any width the rail produces — so the two marks cannot be
   * told apart by hue alone at ten feet. They are told apart by SILHOUETTE: the
   * join straddles the rule symmetrically, the marker starts at its top edge
   * and descends past its bottom.
   */
  it('draws the marker as a bob rather than as another barline', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-era-timeline__rule \{[^}]*\}/)[0];
    const ruleH = Number(rule.match(/height: ([\d.]+)px/)[1]);
    const join = css.match(/\.surround-era-timeline__join \{[^}]*\}/)[0];
    const marker = css.match(/\.surround-era-timeline__marker \{[^}]*\}/)[0];

    // The join straddles: it starts ABOVE the rule and overhangs both edges.
    expect(Number(join.match(/top: (-?[\d.]+)px/)[1])).toBeLessThan(0);
    // The marker hangs: it starts AT the top edge, where the thread ends...
    expect(Number(marker.match(/top: (-?[\d.]+)(?:px)?;/)[1])).toBe(0);
    // ...and descends past the bottom, which is the asymmetry.
    expect(Number(marker.match(/height: ([\d.]+)px/)[1])).toBeGreaterThan(ruleH);
    // ...and it is the heavier of the two, so it wins the overlap.
    expect(Number(marker.match(/width: ([\d.]+)px/)[1]))
      .toBeGreaterThan(Number(join.match(/width: ([\d.]+)px/)[1]));
  });

  it('sets every era name as letterspaced small caps at the ten-foot floor', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const label = css.match(/\.surround-era-timeline__label \{[^}]*\}/)[0];
    expect(label).toContain('text-transform: uppercase');
    expect(Number(label.match(/letter-spacing: ([\d.]+)em/)[1])).toBeGreaterThanOrEqual(0.08);
    // THE FLOOR IS PUBLISHED, NOT WRITTEN DOWN (design wave 9b). A ten-foot
    // floor is an angular claim and a rem is not an angle, so the frame measures
    // its screen root and publishes `--label-floor`; this rule reads it, with the
    // anchor root's 11.52px (0.72rem) as the fallback a slide rendered outside a
    // frame gets. A literal here would be right on one screen and wrong on the
    // other two.
    expect(label).toMatch(/font-size: var\(--label-floor, 11\.52px\)/);
    // The subject's name is one step up — in WEIGHT and VALUE, never in size,
    // which is the same law the map's subject country is drawn under.
    const subject = css.match(/\.surround-era-timeline__label--subject \{[^}]*\}/)[0];
    expect(subject).toMatch(/color: var\(--ink,/);
    expect(subject).not.toMatch(/font-size/);
    // ...and after wave 10 it is a step in VALUE ONLY. It used to take a weight
    // step too, on the map's law that the subject is what the slide is about —
    // but the map's subject is one country and a period can name TWO adjacent
    // eras, and two names in full ink a hair apart read as the single phrase
    // "CLASSICAL ROMANTIC". The dateline carries that emphasis now, in words.
    expect(subject).not.toMatch(/font-weight/);
  });

  it('never shrinks a label below that floor anywhere in the sheet', () => {
    const css = withStyles();
    const sizes = [...css.matchAll(/font-size:\s*(?:clamp\(\s*)?([\d.]+)rem/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    sizes.forEach((rem) => expect(rem, `${rem}rem is below the ten-foot floor`)
      .toBeGreaterThanOrEqual(0.72));
  });

  it('sets the note in body Garamond, in the caption’s register, reserve then clamp', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const note = css.match(/\.surround-era-timeline__note \{[^}]*\}/)[0];
    expect(note).toMatch(/font-family: var\(--surround-body,/);
    expect(note).toContain('font-style: italic');
    // The wave-5 split: the box centres and bounds, the inner span truncates.
    expect(note).toContain('display: grid');
    expect(note).toContain('align-content: center');
    expect(note).not.toContain('-webkit-line-clamp');
    const line = css.match(/\.surround-era-timeline__note-line \{[^}]*\}/)[0];
    expect(line).toContain('display: -webkit-box');
    expect(line).toContain('-webkit-line-clamp: 4');
    // ...and the ceiling matches the clamp, so the box cannot outgrow it.
    const cap = Number(note.match(/max-height: ([\d.]+)em/)[1]);
    const lh = Number(note.match(/line-height: ([\d.]+)/)[1]);
    expect(cap).toBeCloseTo(lh * 4, 2);
  });

  /**
   * The note is the only thing on the plate allowed to adapt, and on the WIDTH
   * axis: how many lines a sentence takes is decided by the measure. Measured,
   * the Eroica's 123-character note is three comfortable lines on the 278.8px
   * plate a 960x540 rail gives and two on a 1080p one.
   */
  it('sizes the note against the plate it was given, without breaking the floor', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const root = css.match(/\.surround-era-timeline \{[^}]*\}/)[0];
    expect(root, 'no container, so cqw would resolve against the viewport')
      .toContain('container-type: inline-size');
    expect(root).toContain('container-name: era-plate');

    const note = css.match(/\.surround-era-timeline__note \{[^}]*\}/)[0];
    const clamp = note.match(/font-size: clamp\(([\d.]+)rem, ([\d.]+)cqw, ([\d.]+)rem\)/);
    expect(clamp, 'the note is set at a fixed size').not.toBeNull();
    const [, min, per, max] = clamp.map(Number);
    expect(min).toBeGreaterThanOrEqual(0.72);
    expect(max).toBeGreaterThan(min);
    // ...and it bites between the plates the fleet actually produces.
    const at = (plate) => Math.min(Math.max((per * plate) / 100, min * 16), max * 16);
    expect(at(PLATE.hd)).toBeGreaterThan(at(PLATE.small));
  });

  it('gives the measured element nothing that would make it lie about its width', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    // The component observes `__rule` and computes every percentage against it,
    // so any padding, border or margin here would put the era bands and the
    // marker at coordinates the fitting did not compute.
    const rule = css.match(/\.surround-era-timeline__rule \{[^}]*\}/)[0];
    expect(rule).toContain('width: 100%');
    expect(rule).not.toMatch(/padding|border|margin/);
  });
});

describe('EraTimeline — smart quotes at the render seam (design wave 7)', () => {
  it('curls the period note', () => {
    const { getByTestId } = render(
      <EraTimeline
        period="Classical"
        year={1804}
        note="Written at the hinge — many date the Romantic era from Beethoven's Third."
      />,
    );
    expect(getByTestId('surround-era-note').textContent).toContain('Beethoven’s');
    expect(getByTestId('surround-era-note').textContent).not.toContain("'");
  });
});

/**
 * WAVE 10 — THE DATELINE.
 *
 * The finding it answers: the drawing carried less information than the
 * sentence beneath it. The note said "Baroque" in words, better; the rule said
 * "Baroque" as a picture and printed no date anywhere, so a marker on it could
 * not be located by a viewer who did not already know the boundaries.
 */
describe('EraTimeline — the dateline', () => {
  it('prints the author’s own phrase, and what it is worth in years', () => {
    expect(datelineFor('Baroque', ['Baroque']))
      .toEqual({ era: 'Baroque', span: '1600–1750' });
  });

  it('keeps a qualified phrase intact rather than reducing it to the era it matched', () => {
    // "Late Baroque" says something the four era names cannot, which is the
    // whole reason the dateline prints the AUTHORED string.
    expect(datelineFor('Late Baroque', ['Baroque']))
      .toEqual({ era: 'Late Baroque', span: '1600–1750' });
  });

  it('spans BOTH bands a hinge period names, rather than only the first', () => {
    // Taking the first band's dates alone would print 1750-1820 under a drawing
    // that lights the line all the way to 1910 — a heading its own picture
    // contradicts.
    expect(datelineFor('Classical to Romantic', ['Classical', 'Romantic']))
      .toEqual({ era: 'Classical to Romantic', span: '1750–1910' });
  });

  it('still writes a heading for a period the era table has never heard of', () => {
    // The words are the author's and they are printed. The dates are ours and
    // we do not have them, so none are invented.
    expect(datelineFor('Ars Nova', [])).toEqual({ era: 'Ars Nova', span: null });
  });

  it('writes nothing at all where nothing was authored', () => {
    expect(datelineFor(null, [])).toBeNull();
    expect(datelineFor('   ', [])).toBeNull();
  });

  it('renders the heading above the rule, era in ink and dates beside it', () => {
    const view = renderTimeline({ period: 'Baroque', year: 1742 });
    const dateline = view.container.querySelector('[data-testid="surround-era-dateline"]');
    expect(dateline).not.toBeNull();
    expect(dateline.textContent).toContain('Baroque');
    expect(dateline.textContent).toContain('1600–1750');
  });
});

/**
 * WAVE 10 — WHICH SIDE OF ITS THREAD THE YEAR HANGS ON.
 *
 * A display-sized numeral centred on its own position runs off the plate near
 * either end, where the mat's `overflow: hidden` cuts it. The numeral gives
 * way; the thread never does.
 */
describe('EraTimeline — hanging the year', () => {
  it('centres the year on its thread through the middle of the span', () => {
    expect(yearAnchorFor(0.5)).toBe('middle');
    expect(yearAnchorFor(fractionFor(1742))).toBe('middle');
  });

  it('hangs it off the right of the thread near the start of the span', () => {
    expect(yearAnchorFor(0)).toBe('start');
    expect(yearAnchorFor(YEAR_ANCHOR_EDGE - 0.01)).toBe('start');
    expect(yearAnchorFor(fractionFor(1600))).toBe('start');
  });

  it('hangs it off the left of the thread near the end of the span', () => {
    expect(yearAnchorFor(1)).toBe('end');
    expect(yearAnchorFor(1 - YEAR_ANCHOR_EDGE + 0.01)).toBe('end');
    expect(yearAnchorFor(fractionFor(1899))).toBe('end');
  });

  it('anchors nothing where there is no marker', () => {
    expect(yearAnchorFor(null)).toBeNull();
    expect(yearAnchorFor(Number.NaN)).toBeNull();
  });

  it('writes the anchor onto the element, so the sheet draws what the function decided', () => {
    const view = renderTimeline({ period: 'Baroque', year: 1742 });
    expect(view.container.querySelector('[data-testid="surround-era-year"]')
      .getAttribute('data-anchor')).toBe('middle');
    const early = renderTimeline({ period: 'Renaissance', year: 1570 });
    expect(early.container.querySelector('[data-testid="surround-era-year"]')
      .getAttribute('data-anchor')).toBe('start');
  });

  /**
   * THE THREE PARTS ARE ONE OBJECT. The year, the thread and the bob are placed
   * from a single number, and if they ever disagreed the drawing would be
   * asserting two different years at once.
   */
  it('puts the year, the thread and the marker at exactly one position', () => {
    const view = renderTimeline({ period: 'Baroque', year: 1742 });
    const left = (id) => view.container.querySelector(`[data-testid="${id}"]`).style.left;
    expect(left('surround-era-year')).toBe(left('surround-era-plumb'));
    expect(left('surround-era-plumb')).toBe(left('surround-era-marker'));
  });

  it('drops the whole plumb — year, thread and bob — where the piece names no year', () => {
    const view = renderTimeline({ period: 'Baroque', year: null });
    expect(view.container.querySelector('[data-testid="surround-era-year"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="surround-era-plumb"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="surround-era-marker"]')).toBeNull();
  });
});

/**
 * WAVE 10 — THE EXTENT.
 *
 * Three numerals on the plate — the span's two ends and the piece's own year —
 * are what make the drawing a scale instead of a bar of unknown length.
 */
describe('EraTimeline — the extent', () => {
  it('writes both ends of the span, from the table rather than from the sheet', () => {
    const view = renderTimeline();
    const ends = [...view.container.querySelectorAll('.surround-era-timeline__extent-year')]
      .map((el) => el.textContent);
    expect(ends).toEqual([String(TIMELINE_SPAN.from), String(TIMELINE_SPAN.to)]);
  });

  it('writes them even for a piece with no year of its own', () => {
    // The axis is context and does not depend on there being a marker on it.
    const view = renderTimeline({ year: null });
    expect(view.container.querySelectorAll('.surround-era-timeline__extent-year')).toHaveLength(2);
  });
});

/**
 * WAVE 10 — TWO LABELS, NOT ONE PHRASE.
 *
 * A period naming two eras lights two adjacent bands, and the old flat 6px
 * minimum is about one and a half word-spaces at this tracking: "CLASSICAL" and
 * "ROMANTIC" rendered as the single phrase "CLASSICAL ROMANTIC".
 */
describe('EraTimeline — the gap between two names', () => {
  it('separates two crowded subjects by several word-spaces, not one', () => {
    const placed = layoutEraLabels({
      widthPx: PLATE.small, subjects: ['Classical', 'Romantic'], labelPx: 8.64,
    });
    const centre = (name) => (placed.find((l) => l.name === name).leftPct / 100) * PLATE.small;
    expect(placed.filter((l) => l.role === 'subject')).toHaveLength(2);
    const [a, b] = [centre('Classical'), centre('Romantic')];
    const edgeToEdge = (b - eraLabelWidthPx('Romantic', 8.64) / 2)
      - (a + eraLabelWidthPx('Classical', 8.64) / 2);
    expect(edgeToEdge).toBeGreaterThanOrEqual(8.64 * ERA_LABEL_GAP_EM - 0.01);
    // A tracked word-space at this size is a shade over 4px. The old 6px could
    // not clear two of them; this clears four.
    expect(edgeToEdge / 4.3).toBeGreaterThan(2.5);
  });

  it('holds that minimum on every screen root, not just the anchor', () => {
    // A gap that separates on the 1920 root and closes on the 960 one is the
    // same bug in a different place — a ten-foot claim written as a flat pixel.
    // The gap is a MINIMUM, and it does not grow with the plate: wider labels
    // on a bigger root are pushed toward the plate's ends, so the measured
    // clearance shrinks toward the floor rather than away from it. What must
    // hold at every root is the floor itself.
    const clearance = (labelPx) => {
      const [a, b] = layoutEraLabels({
        widthPx: PLATE.hd, subjects: ['Classical', 'Romantic'], labelPx,
      }).map((l) => (l.leftPct / 100) * PLATE.hd);
      return (b - eraLabelWidthPx('Romantic', labelPx) / 2)
        - (a + eraLabelWidthPx('Classical', labelPx) / 2);
    };
    [8.64, 11.52, 17.28].forEach((labelPx) => {
      expect(clearance(labelPx), `${labelPx}px root`)
        .toBeGreaterThanOrEqual(labelPx * ERA_LABEL_GAP_EM - 0.01);
    });
  });

  /**
   * ...AND IT DROPS THE LATER NAME RATHER THAN PRINTING THE TWO INTO EACH OTHER.
   *
   * On the 960 root CLASSICAL and ROMANTIC stand about 6px apart at their real
   * measured widths — a shade over one word-space, which is the "CLASSICAL
   * ROMANTIC" failure again in the non-subject path, and rendering the plate
   * there showed them set solid as one word. Neither is a subject here, so
   * neither is protected, and the tie goes to the wider band: ROMANTIC's ninety
   * years beat CLASSICAL's seventy.
   */
  it('writes CLASSICAL on the office screen, where the pair has room', () => {
    // The other end of the same rule. A clash gap wide enough to separate is
    // only correct if it does not delete a name the shipped version wrote, and
    // the 1280 root is where that is decided: CLASSICAL and ROMANTIC clear each
    // other by about two word-spaces there.
    const names = layoutEraLabels({
      widthPx: PLATE.kiosk, subjects: ['Baroque'], labelPx: 11.52,
    }).map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(['Baroque', 'Classical', 'Romantic']));
  });

  it('drops the later name rather than setting two names solid, on the smallest plate', () => {
    const names = layoutEraLabels({
      widthPx: PLATE.small, subjects: ['Baroque'], labelPx: 8.64,
    }).map((l) => l.name);
    expect(names).toContain('Baroque');       // the subject, never dropped
    expect(names).toContain('Romantic');      // the wider of the two that clash
    expect(names).not.toContain('Classical');
  });

  /**
   * NOTHING THE FITTING PLACES MAY OVERLAP, at any root, for any period. This
   * is the assertion the old estimate could not have passed: it under-read
   * Cormorant's tracked caps by 11%, so the collision test cleared pairs that
   * rendered on top of each other.
   */
  it('never places two names into each other, at any root or period', () => {
    const PERIODS = [[], ['Baroque'], ['Classical'], ['Classical', 'Romantic'], ['Renaissance']];
    [[PLATE.small, 8.64], [PLATE.kiosk, 11.52], [PLATE.hd, 17.28]].forEach(([widthPx, labelPx]) => {
      PERIODS.forEach((subjects) => {
        const boxes = layoutEraLabels({ widthPx, subjects, labelPx }).map((l) => {
          const w = eraLabelWidthPx(l.name, labelPx);
          const centre = (l.leftPct / 100) * widthPx;
          return { name: l.name, x0: centre - w / 2, x1: centre + w / 2 };
        });
        boxes.slice(1).forEach((b, i) => {
          expect(b.x0, `${boxes[i].name}/${b.name} overlap at ${widthPx}px`)
            .toBeGreaterThanOrEqual(boxes[i].x1 - 0.01);
        });
      });
    });
  });

  /**
   * THE ESTIMATE COVERS THE WIDEST NAME, NOT THE AVERAGE ONE. Measured in
   * Chromium against the shipped face at the three roots the fleet lays out at.
   */
  it('estimates a label at least as wide as the face actually sets it', () => {
    const MEASURED_EM_PER_CHAR = {
      Renaissance: 0.7599, Baroque: 0.8236, Classical: 0.7139, Romantic: 0.8027,
    };
    Object.entries(MEASURED_EM_PER_CHAR).forEach(([name, em]) => {
      [8.64, 11.52, 17.28].forEach((labelPx) => {
        expect(eraLabelWidthPx(name, labelPx), `${name} is estimated narrower than it sets`)
          .toBeGreaterThanOrEqual(name.length * em * labelPx);
      });
      // ...and not so much wider that it starts deleting names that would fit.
      expect(ERA_LABEL_EM[name] / em).toBeLessThan(1.05);
    });
    // Every name in the frozen era table has a measured width of its own.
    expect(Object.keys(ERA_LABEL_EM).sort()).toEqual(ERAS.map((e) => e.name).sort());
  });

  it('keeps the drop test tighter than the nudge, which is why', () => {
    expect(ERA_LABEL_CLASH_EM).toBeLessThan(ERA_LABEL_GAP_EM);
  });
});
