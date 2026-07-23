import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ContinueRail from './ContinueRail.jsx';
import { schoolApi } from '../schoolApi.js';

vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    materialProgress: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
  },
}));

let profile;
vi.mock('../identity/SchoolProfileContext.jsx', () => ({
  useSchoolProfile: () => profile,
}));

vi.mock('../schoolLog.js', () => ({
  schoolLog: { home: vi.fn() },
  default: { home: vi.fn() },
}));

const materials = [
  { id: 'plex:v1', title: 'Bill Nye', poster: '/p/1' },
  { id: 'plex:v2', title: 'Cash', poster: '/p/2' },
];

const progressData = [
  {
    materialId: 'plex:v1',
    unitsDone: 1,
    unitTotal: 3,
    nextUnitId: 'plex:u2',
    nextUnitTitle: 'Water',
    percent: 33,
    lastActivity: '2026-07-20T10:00:00Z',
  },
  {
    materialId: 'plex:v2',
    unitsDone: 4,
    unitTotal: 4,
    nextUnitId: null,
    nextUnitTitle: null,
    percent: 100,
    lastActivity: '2026-07-21T10:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  profile = { currentUser: { id: 'kid1' }, isGuest: false };
});

describe('ContinueRail', () => {
  it('shows in-progress materials for a claimed user, excludes done ones, and resumes on tap', async () => {
    schoolApi.materialProgress.mockResolvedValueOnce({ ok: true, status: 200, data: progressData });
    const onOpen = vi.fn();
    render(<ContinueRail subjectId="science" materials={materials} onOpen={onOpen} />);

    expect(await screen.findByText('Continue')).toBeInTheDocument();
    expect(screen.getByText('Bill Nye')).toBeInTheDocument();
    expect(screen.getByText('Next: Water')).toBeInTheDocument();
    expect(screen.queryByText('Cash')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Bill Nye').closest('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    const openedWith = onOpen.mock.calls[0][0];
    expect(openedWith.materialId ?? openedWith.id).toBe('plex:v1');

    expect(schoolApi.materialProgress).toHaveBeenCalledWith('kid1', 'science');
  });

  it('renders nothing for a guest/unclaimed device and does not fetch', async () => {
    profile = { currentUser: null, isGuest: true };
    render(<ContinueRail subjectId="science" materials={materials} onOpen={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByText('Continue')).not.toBeInTheDocument();
    });
    expect(schoolApi.materialProgress).not.toHaveBeenCalled();
  });

  it('renders nothing when there is no in-progress work', async () => {
    schoolApi.materialProgress.mockResolvedValueOnce({ ok: true, status: 200, data: [] });
    render(<ContinueRail subjectId="science" materials={materials} onOpen={vi.fn()} />);

    await waitFor(() => {
      expect(schoolApi.materialProgress).toHaveBeenCalledWith('kid1', 'science');
    });
    expect(screen.queryByText('Continue')).not.toBeInTheDocument();
  });

  it('uses a parent-supplied progress prop and does not self-fetch', async () => {
    render(
      <ContinueRail
        subjectId="science"
        materials={materials}
        onOpen={vi.fn()}
        progress={[progressData[0]]}
      />
    );

    expect(await screen.findByText('Continue')).toBeInTheDocument();
    expect(screen.getByText('Bill Nye')).toBeInTheDocument();
    expect(schoolApi.materialProgress).not.toHaveBeenCalled();
  });
});
