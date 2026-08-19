// WorkPlacard.test.jsx — mirror the mount style of ComposerCard.test.jsx.
import { render } from '@testing-library/react';
import WorkPlacard from './WorkPlacard.jsx';

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

it('renders nothing without a piece — an empty plate is worse than no plate', () => {
  const { container } = render(<WorkPlacard data={{ composer: { name: 'X' } }} position={0} duration={0} region={{ slot: 'top' }} />);
  expect(container.firstChild).toBeNull();
});
