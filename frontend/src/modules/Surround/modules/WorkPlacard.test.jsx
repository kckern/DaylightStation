// WorkPlacard.test.jsx — mirror the mount style of ComposerCard.test.jsx.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass-embedded';
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
