import { render } from '@testing-library/react';
import { useRef } from 'react';
import StaffDimLayer from './StaffDimLayer.jsx';

// Mirrors the real engraved DOM: OSMD renders its <svg> inside the renderer's
// host div, one g.staffline per staff per system, 1-based id suffix.
function Harness({ dimmed, layoutToken = 1, ids = ['Piano0-1', 'Piano0-2'] }) {
  const ref = useRef(null);
  return (
    <div ref={ref}>
      <div className="musicxml-renderer__svg">
        <svg>
          {ids.map((id, i) => <g key={i} className="staffline" id={id} />)}
        </svg>
      </div>
      <StaffDimLayer containerRef={ref} dimmed={dimmed} layoutToken={layoutToken} />
    </div>
  );
}

const dimmedIds = (c) => [...c.querySelectorAll('g.staffline.is-dimmed')].map((g) => g.id);

describe('StaffDimLayer', () => {
  it('dims only the deselected staff, by class on OSMD\'s own group', () => {
    const { container } = render(<Harness dimmed={[1]} />);
    expect(dimmedIds(container)).toEqual(['Piano0-2']);
  });

  it('dims every system of that staff, not just the first', () => {
    const { container } = render(
      <Harness dimmed={[0]} ids={['Piano0-1', 'Piano0-2', 'Piano0-1', 'Piano0-2']} />,
    );
    expect(dimmedIds(container)).toEqual(['Piano0-1', 'Piano0-1']);
  });

  it('renders no element of its own — nothing is covered', () => {
    const { container } = render(<Harness dimmed={[1]} />);
    expect(container.querySelectorAll('.piano-score-staff-dim')).toHaveLength(0);
  });

  it('clears the class when the staff is reselected', () => {
    const { container, rerender } = render(<Harness dimmed={[1]} />);
    expect(dimmedIds(container)).toEqual(['Piano0-2']);
    rerender(<Harness dimmed={[]} />);
    expect(dimmedIds(container)).toEqual([]);
  });

  it('re-applies after a re-engrave replaces the SVG', () => {
    // A new layoutToken stands for a fresh engrave (zoom, flow, transpose).
    const { container, rerender } = render(<Harness dimmed={[1]} layoutToken={1} />);
    container.querySelector('g.staffline.is-dimmed').classList.remove('is-dimmed');
    rerender(<Harness dimmed={[1]} layoutToken={2} />);
    expect(dimmedIds(container)).toEqual(['Piano0-2']);
  });

  it('does nothing when nothing is deselected or nothing is engraved', () => {
    const { container } = render(<Harness dimmed={[]} ids={[]} />);
    expect(dimmedIds(container)).toEqual([]);
  });
});
