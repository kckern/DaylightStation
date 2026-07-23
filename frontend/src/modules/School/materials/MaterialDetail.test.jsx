import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MaterialDetail from './MaterialDetail.jsx';

const materialUnitsMock = vi.fn();
const quizRequestsMock = vi.fn();
const requestQuizMock = vi.fn();
vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    materialUnits: (...a) => materialUnitsMock(...a),
    quizRequests: (...a) => quizRequestsMock(...a),
    requestQuiz: (...a) => requestQuizMock(...a),
  },
}));

const material = { id: 'plex:1', title: 'Bill Nye', category: 'course' };

beforeEach(() => {
  materialUnitsMock.mockReset();
  quizRequestsMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: [] });
  requestQuizMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { requested: true, duplicate: false } });
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
    expect(screen.getByText('20 min')).toBeInTheDocument();
    // completed units carry the done modifier (check badge, not text)
    expect(screen.getByText('Air').closest('button').className).toMatch(/--done/);
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

  it('renders no back row of its own — navigation is the app header breadcrumb', async () => {
    materialUnitsMock.mockResolvedValue({ ok: true, status: 200, data: { material, units: [] } });
    render(<MaterialDetail material={material} userId="kid1" onBack={() => {}} onPlay={() => {}} notice={null} sectionLabel="Courses" />);
    await screen.findByText(/no units yet/i);
    expect(screen.queryByText(/all courses/i)).toBeNull();
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

  it('a needsQuiz current unit shows the request affordance; tapping it records the request and flips to requested', async () => {
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: {
        material,
        units: [
          { id: 'plex:10', index: 1, title: 'Budgets', durationMs: null, group: null, percent: 100, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null, needsQuiz: true, played: true },
          { id: 'plex:11', index: 2, title: 'Saving', durationMs: null, group: null, percent: 0, playhead: 0, completed: false, locked: true, current: false, lockReason: '“Budgets” is waiting for its quiz — request one to move on', quiz: null, needsQuiz: false },
        ],
      },
    });
    render(<MaterialDetail material={material} userId="kid1" onBack={() => {}} onPlay={() => {}} notice={null} sectionLabel="Courses" />);
    const btn = await screen.findByRole('button', { name: /request a quiz/i });
    fireEvent.click(btn);
    expect(requestQuizMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'kid1', unitId: 'plex:10', materialId: 'plex:1' }));
    expect(await screen.findByRole('button', { name: /quiz requested/i })).toBeDisabled();
  });

  it('audio material renders chapters as a list (no thumbnails), locked ones inert with their reason', async () => {
    const audio = { id: 'plex:685120', title: 'Hamlet', category: 'course', medium: 'audio', poster: '/p/h' };
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: {
        material: audio,
        units: [
          { id: 'plex:1', index: 1, title: 'Chapter 1', durationMs: 5 * 60000, group: null, percent: 0, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null, needsQuiz: false },
          { id: 'plex:2', index: 2, title: 'Chapter 2', durationMs: 6 * 60000, group: null, percent: 0, playhead: 0, completed: false, locked: true, current: false, lockReason: 'Pass the quiz for “Chapter 1” first', quiz: null, needsQuiz: false },
        ],
      },
    });
    const onPlay = vi.fn();
    render(<MaterialDetail material={audio} userId="kid1" onBack={() => {}} onPlay={onPlay} notice={null} sectionLabel="Shakespeare Tales" />);
    await screen.findByText('Chapter 1');
    // No episode thumbnails in the audio list.
    expect(document.querySelector('.school-material-detail__thumb')).toBeNull();
    expect(document.querySelector('.school-material-detail__chapters')).not.toBeNull();
    // Locked chapter shows its reason and does not launch on tap.
    expect(screen.getAllByText(/Pass the quiz/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Chapter 2').closest('button'));
    expect(onPlay).not.toHaveBeenCalled();
    // The current (unlocked) chapter launches.
    fireEvent.click(screen.getByText('Chapter 1').closest('button'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: 'plex:1' }));
  });

  it('a guest sees the needsQuiz explanation but no request button', async () => {
    materialUnitsMock.mockResolvedValue({
      ok: true, status: 200,
      data: {
        material,
        units: [
          { id: 'plex:10', index: 1, title: 'Budgets', durationMs: null, group: null, percent: 100, playhead: 0, completed: false, locked: false, current: true, lockReason: null, quiz: null, needsQuiz: true, played: true },
        ],
      },
    });
    render(<MaterialDetail material={material} userId={undefined} onBack={() => {}} onPlay={() => {}} notice={null} sectionLabel="Courses" />);
    expect(await screen.findByText(/doesn't have a quiz yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request a quiz/i })).toBeNull();
    expect(screen.getByText(/sign in to request one/i)).toBeInTheDocument();
  });
});
