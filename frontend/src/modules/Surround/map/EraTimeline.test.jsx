import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import * as sass from 'sass-embedded';
import EraTimeline, {
  ERAS, TIMELINE_SPAN, NOMINAL_WIDTH_PX,
  ERA_LABEL_PX, ERA_LABEL_OVERHANG,
  eraLabelWidthPx, fractionFor, layoutEraLabels, subjectErasFor,
} from './EraTimeline.jsx';

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

const labelNames = (container) =>
  [...container.querySelectorAll('[data-testid="surround-era-label"]')]
    .map((el) => el.getAttribute('data-era'));

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
    const compiled = sass.compile(path.join(__dirname, 'EraTimeline.scss'));
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

    const marker = css.match(/\.surround-era-timeline__marker \{[^}]*\}/)[0];
    expect(marker).toMatch(/background: var\(--brass-lit,/);
    const year = css.match(/\.surround-era-timeline__year \{[^}]*\}/)[0];
    expect(year).toMatch(/color: var\(--brass,/);
  });

  it('sets every era name as letterspaced small caps at the ten-foot floor', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const label = css.match(/\.surround-era-timeline__label \{[^}]*\}/)[0];
    expect(label).toContain('text-transform: uppercase');
    expect(Number(label.match(/letter-spacing: ([\d.]+)em/)[1])).toBeGreaterThanOrEqual(0.08);
    expect(Number(label.match(/font-size: ([\d.]+)rem/)[1])).toBe(0.72);
    // The subject's name is one step up — in WEIGHT and VALUE, never in size,
    // which is the same law the map's subject country is drawn under.
    const subject = css.match(/\.surround-era-timeline__label--subject \{[^}]*\}/)[0];
    expect(subject).toMatch(/color: var\(--ink,/);
    expect(subject).not.toMatch(/font-size/);
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
