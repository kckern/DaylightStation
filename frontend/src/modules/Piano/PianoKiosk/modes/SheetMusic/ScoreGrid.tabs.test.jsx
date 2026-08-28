import { render, fireEvent, screen } from '@testing-library/react';

// Heavy engraving chunk — irrelevant to tab behavior.
vi.mock('../../../../MusicNotation/renderers/osmdRender.js', () => ({
  prefetchOsmd: () => Promise.resolve(),
}));

// One fake folder listing per list path.
const LISTS = {
  'api/v1/list/files/docs/sheet-music/video-games': [
    { id: 'files:docs/sheet-music/video-games/super-mario-theme.mxl', type: 'notation', title: 'super-mario-theme' },
  ],
  'api/v1/list/files/docs/sheet-music/tv-shows': [
    { id: 'files:docs/sheet-music/tv-shows/the-adventures-of-tintin-theme.mxl', type: 'notation', title: 'the-adventures-of-tintin-theme' },
  ],
};
const pianoListMock = vi.fn((path) => ({ data: LISTS[path] ?? [], loading: false, error: null }));
vi.mock('../../usePianoList.js', () => ({
  default: (path) => pianoListMock(path),
  usePianoList: (path) => pianoListMock(path),
}));

import ScoreGrid from './ScoreGrid.jsx';

const GROUPS = [
  { label: 'Video Games', listPath: 'api/v1/list/files/docs/sheet-music/video-games' },
  { label: 'TV Shows', listPath: 'api/v1/list/files/docs/sheet-music/tv-shows' },
];

beforeEach(() => {
  window.localStorage.clear();
  pianoListMock.mockClear();
});

describe('ScoreGrid tabs', () => {
  it('renders a tab per group, first active, and lists that tab’s scores', () => {
    render(<ScoreGrid groups={GROUPS} onSelect={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Video Games', 'TV Shows']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Super Mario Theme')).toBeInTheDocument();
    expect(screen.queryByText(/Tintin/)).toBeNull();
  });

  it('switching tabs swaps the listed folder and remembers the choice', () => {
    const { unmount } = render(<ScoreGrid groups={GROUPS} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'TV Shows' }));
    expect(screen.getByText('The Adventures Of Tintin Theme')).toBeInTheDocument();
    expect(screen.queryByText(/Mario/)).toBeNull();
    unmount();
    // A fresh mount (walk-up reload) restores the remembered tab.
    render(<ScoreGrid groups={GROUPS} onSelect={() => {}} />);
    expect(screen.getByRole('tab', { name: 'TV Shows' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('The Adventures Of Tintin Theme')).toBeInTheDocument();
  });

  it('a remembered label no longer in config falls back to the first tab', () => {
    window.localStorage.setItem('daylight.piano.sm.tab', 'Retired Tab');
    render(<ScoreGrid groups={GROUPS} onSelect={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Video Games' })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders no tab strip for a single group', () => {
    render(<ScoreGrid groups={[GROUPS[0]]} onSelect={() => {}} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Super Mario Theme')).toBeInTheDocument();
  });

  it('renders the empty state when there are no groups', () => {
    render(<ScoreGrid groups={[]} onSelect={() => {}} />);
    expect(screen.getByText('No sheet music has been set up yet.')).toBeInTheDocument();
  });
});
