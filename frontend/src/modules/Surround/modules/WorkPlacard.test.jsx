// WorkPlacard.test.jsx — mirror the mount style of ComposerCard.test.jsx.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass-embedded';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import WorkPlacard from './WorkPlacard.jsx';

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
  const css = sass.compile(path.join(__dirname, 'WorkPlacard.scss')).css.replace(/\s+/g, ' ');
  const size = (sel) => {
    const rule = css.match(new RegExp(`\\.surround-work-placard__${sel} \\{([^}]*)\\}`))?.[1] ?? '';
    const m = rule.match(/font-size: ([\d.]+)rem/);
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
