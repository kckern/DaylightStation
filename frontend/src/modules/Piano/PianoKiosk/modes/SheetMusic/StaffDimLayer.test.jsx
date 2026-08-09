import { render, cleanup } from '@testing-library/react';
import StaffDimLayer from './StaffDimLayer.jsx';

// Mirrors the real engraved DOM: OSMD renders its <svg> into the renderer's host
// div, one g.staffline per staff PER SYSTEM, with a 1-based id suffix; staffGroups
// reads the sheet-global `data-staff` stamped by tagStaffGroups during extraction
// (see osmdRender.js), not the id suffix, so the fixture stamps it directly —
// this component's own tests aren't exercising tagStaffGroups.
function makeHost(ids = ['Piano0-1', 'Piano0-2'], staffIds = [0, 1]) {
  const host = document.createElement('div');
  const groups = ids.map((id, i) => `<g class="staffline" id="${id}" data-staff="${staffIds[i]}"></g>`).join('');
  host.innerHTML = `<div class="musicxml-renderer__svg"><svg>${groups}</svg></div>`;
  document.body.appendChild(host);
  return host;
}

const dimmedIds = (host) => [...host.querySelectorAll('g.staffline.is-dimmed')].map((g) => g.id);

// Stable identity, so the re-engrave test proves layoutToken drives the re-apply
// rather than a fresh array reference doing it incidentally.
const DIM_LH = [1];

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

describe('StaffDimLayer', () => {
  it("dims only the deselected staff, by class on OSMD's own group", () => {
    const host = makeHost();
    render(<StaffDimLayer container={host} dimmed={[1]} />);
    expect(dimmedIds(host)).toEqual(['Piano0-2']);
  });

  it('dims every system of that staff, not just the first', () => {
    const host = makeHost(['Piano0-1', 'Piano0-2', 'Piano0-1', 'Piano0-2'], [0, 1, 0, 1]);
    render(<StaffDimLayer container={host} dimmed={[0]} />);
    expect(dimmedIds(host)).toEqual(['Piano0-1', 'Piano0-1']);
  });

  it('renders no element of its own — nothing is covered', () => {
    const host = makeHost();
    const { container } = render(<StaffDimLayer container={host} dimmed={[1]} />);
    expect(container.innerHTML).toBe('');
    expect(host.querySelectorAll('.piano-score-staff-dim')).toHaveLength(0);
  });

  it('clears the class when the staff is reselected', () => {
    const host = makeHost();
    const { rerender } = render(<StaffDimLayer container={host} dimmed={[1]} />);
    expect(dimmedIds(host)).toEqual(['Piano0-2']);
    rerender(<StaffDimLayer container={host} dimmed={[]} />);
    expect(dimmedIds(host)).toEqual([]);
  });

  it('re-applies after a re-engrave replaces the SVG', () => {
    const host = makeHost();
    const { rerender } = render(<StaffDimLayer container={host} dimmed={DIM_LH} layoutToken={1} />);
    host.querySelector('g.staffline.is-dimmed').classList.remove('is-dimmed');
    rerender(<StaffDimLayer container={host} dimmed={DIM_LH} layoutToken={2} />);
    expect(dimmedIds(host)).toEqual(['Piano0-2']);
  });

  it('does nothing when nothing is deselected, nothing is engraved, or there is no container', () => {
    const host = makeHost([]);
    render(<StaffDimLayer container={host} dimmed={[]} />);
    expect(dimmedIds(host)).toEqual([]);
    cleanup();
    expect(() => render(<StaffDimLayer container={null} dimmed={[1]} />)).not.toThrow();
  });
});
