import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PianoHomeDesk from './PianoHomeDesk.jsx';
import { __clearPianoListCache } from '../usePianoList.js';

const h = vi.hoisted(() => ({ currentUser: 'kid', setCurrentUser: vi.fn(), desk: null, recent: null, notation: vi.fn() }));
vi.mock('../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: h.currentUser, setCurrentUser: h.setCurrentUser }) }));
vi.mock('../../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info() {}, warn() {}, debug() {} }) }) }));
vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn(async (path) => (path.includes('desk') ? h.desk : h.recent)) }));
vi.mock('../pianoListCache.js', () => ({ idbGet: async () => null, idbSet: async () => {}, idbClear: async () => {} }));
vi.mock('./DeskNotation.jsx', () => ({ default: (props) => { h.notation(props); return <div>Notation</div>; } }));

const piece = { scoreId: 'files:docs/sheet-music/jesu-joy.mxl', scoreKey: 'k', practicedAt: '2026-11-01', total: 3, silver: 1, gold: 0,
  next: { passageId: 'b', skill: 'right', label: 'Find the right-hand notes', start: 5, end: 8 }, nextGoldPassageId: 'a',
  passages: [{ id: 'a', start: 0, end: 4, state: 'silver', steps: { done: 4, total: 4 } }, { id: 'b', start: 5, end: 8, state: 'learning', steps: { done: 1, total: 4 } }, { id: 'c', start: 9, end: 12, state: 'todo', steps: { done: 0, total: 4 } }] };
const course = { courseId: 'plex:9', courseTitle: 'Piano University', thumbnail: null, completed: 11, total: 173 };
const mount = (props = {}) => { const handlers = { onOpenPassage: vi.fn(), onOpenCourse: vi.fn(), onOpenLibrary: vi.fn() }; render(<PianoHomeDesk {...handlers} {...props} />); return handlers; };

describe('PianoHomeDesk', () => {
  beforeEach(() => {
    __clearPianoListCache(); h.currentUser = 'kid'; h.setCurrentUser.mockClear(); h.notation.mockClear();
    h.desk = { players: [{ userId: 'kid', name: 'Kid', piece }, { userId: 'sib', name: 'Sib', piece: null }] };
    h.recent = { players: [{ userId: 'kid', courses: [course] }] };
  });

  it('shows the piece, its next step and honest progress', async () => {
    mount();
    expect(await screen.findByText('Bars 6–9')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Jesu Joy' })).toBeInTheDocument();
    expect(screen.getByText('Find the right-hand notes')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 passages Silver, 0 Gold')).toBeInTheDocument();
    expect(await screen.findByText('11 of 173 lessons')).toBeInTheDocument();
    expect(await screen.findByText('Notation')).toBeInTheDocument();
    expect(h.notation.mock.calls[0][0].passage.id).toBe('b');
  });

  it('opens the next passage from Continue and any passage from the map', async () => {
    const { onOpenPassage } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(onOpenPassage).toHaveBeenLastCalledWith(piece.scoreId, 'b');
    fireEvent.click(screen.getByRole('button', { name: 'Bars 1–5, Silver' }));
    expect(onOpenPassage).toHaveBeenLastCalledWith(piece.scoreId, 'a');
    expect(screen.getByRole('button', { name: 'Bars 6–9, Learning' })).toHaveAttribute('aria-current', 'step');
  });

  it('switches player only from the family row', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Sib' }));
    expect(h.setCurrentUser).toHaveBeenCalledWith('sib');
  });

  it('invites a player without a piece to find one', async () => {
    h.currentUser = 'sib';
    const { onOpenLibrary } = mount();
    expect(await screen.findByRole('heading', { name: 'Choose a piece to learn' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Find a piece' }));
    expect(onOpenLibrary).toHaveBeenCalled();
  });

  it('rechecks progress every time the home screen opens', async () => {
    const first = render(<PianoHomeDesk />);
    await screen.findByText('1 of 3 passages Silver, 0 Gold');
    first.unmount();
    h.desk = { players: [{ userId: 'kid', name: 'Kid', piece: { ...piece, silver: 2 } }] };
    render(<PianoHomeDesk />);
    expect(await screen.findByText('2 of 3 passages Silver, 0 Gold')).toBeInTheDocument();
  });

  it('shuts every door while disabled', async () => {
    const { onOpenPassage, onOpenCourse } = mount({ disabled: true });
    await screen.findByText('Bars 6–9');
    await waitFor(() => expect(screen.getByRole('button', { name: /Piano University/ })).toBeDisabled());
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    expect(onOpenPassage).not.toHaveBeenCalled();
    expect(onOpenCourse).not.toHaveBeenCalled();
  });
});
