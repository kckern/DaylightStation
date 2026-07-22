import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MaterialDetail from './MaterialDetail.jsx';

const materialUnitsMock = vi.fn();
vi.mock('../schoolApi.js', () => ({
  schoolApi: { materialUnits: (...a) => materialUnitsMock(...a) },
}));

const material = { id: 'plex:1', title: 'Bill Nye', category: 'course' };

beforeEach(() => {
  materialUnitsMock.mockReset();
});

describe('MaterialDetail', () => {
  it('fetches units for the given material/userId and renders a flat list when no unit has a group', async () => {
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: {
        material,
        units: [
          { id: 'plex:10', index: 1, title: 'Air', durationMs: 20 * 60000, group: null, percent: 100, playhead: 1200, completed: true, locked: false, current: false, lockReason: null, quiz: null },
          { id: 'plex:11', index: 2, title: 'Water', durationMs: 18 * 60000, group: null, percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null },
        ],
      },
    });
    render(<MaterialDetail material={material} userId="kid1" onBack={() => {}} onPlay={() => {}} notice={null} sectionLabel="Courses" />);
    expect(materialUnitsMock).toHaveBeenCalledWith('plex:1', 'kid1');
    expect(await screen.findByText('Air')).toBeInTheDocument();
    expect(screen.getByText('Water')).toBeInTheDocument();
    expect(screen.getByText('~20 min')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    // no group headers in a flat list
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('groups units under a header row per distinct group', async () => {
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: {
        material,
        units: [
          { id: 'plex:10', index: 1, title: 'Ep 1', durationMs: null, group: 'Season 1', percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null },
          { id: 'plex:11', index: 2, title: 'Ep 2', durationMs: null, group: 'Season 2', percent: 0, playhead: 0, completed: false, locked: true, current: false, lockReason: 'Finish Ep 1 first', quiz: null },
        ],
      },
    });
    render(<MaterialDetail material={material} userId="kid1" onBack={() => {}} onPlay={() => {}} notice={null} sectionLabel="Courses" />);
    expect(await screen.findByText('Season 1')).toBeInTheDocument();
    expect(screen.getByText('Season 2')).toBeInTheDocument();
  });

  it('a locked unit tap is a no-op and shows its lockReason; an unlocked/current tap calls onPlay', async () => {
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: {
        material,
        units: [
          { id: 'plex:10', index: 1, title: 'Ep 1', durationMs: null, group: null, percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null },
          { id: 'plex:11', index: 2, title: 'Ep 2', durationMs: null, group: null, percent: 0, playhead: 0, completed: false, locked: true, current: false, lockReason: 'Finish Ep 1 first', quiz: null },
        ],
      },
    });
    const onPlay = vi.fn();
    render(<MaterialDetail material={material} userId="kid1" onBack={() => {}} onPlay={onPlay} notice={null} sectionLabel="Courses" />);
    await screen.findByText('Ep 1');

    expect(screen.getByText('Finish Ep 1 first')).toBeInTheDocument();
    const lockedBtn = screen.getByText('Ep 2').closest('button');
    expect(lockedBtn).toBeDisabled();
    fireEvent.click(lockedBtn);
    expect(onPlay).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Ep 1').closest('button'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: 'plex:10' }));
  });

  it('renders an "All <sectionLabel>" back row that calls onBack', async () => {
    materialUnitsMock.mockResolvedValue({ ok: true, status: 200, data: { material, units: [] } });
    const onBack = vi.fn();
    render(<MaterialDetail material={material} userId="kid1" onBack={onBack} onPlay={() => {}} notice={null} sectionLabel="Courses" />);
    const back = await screen.findByText(/all courses/i);
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalled();
  });

  it('renders the guest/course sign-in notice when the parent passes one', async () => {
    materialUnitsMock.mockResolvedValue({ ok: true, status: 200, data: { material, units: [] } });
    render(<MaterialDetail material={material} userId={undefined} onBack={() => {}} onPlay={() => {}} notice="Sign in for courses — guests get the listening shelf." sectionLabel="Courses" />);
    expect(await screen.findByText(/sign in for courses/i)).toBeInTheDocument();
  });

  it('renders an empty state and a loading state', async () => {
    materialUnitsMock.mockResolvedValue({ ok: true, status: 200, data: { material, units: [] } });
    render(<MaterialDetail material={material} userId="kid1" onBack={() => {}} onPlay={() => {}} notice={null} sectionLabel="Courses" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(await screen.findByText(/no units yet/i)).toBeInTheDocument();
  });
});
