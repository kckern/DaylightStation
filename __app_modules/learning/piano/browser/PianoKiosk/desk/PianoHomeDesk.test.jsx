import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PianoHomeDesk from './PianoHomeDesk.jsx';
import { __clearPianoListCache } from '../usePianoList.js';

const h = vi.hoisted(() => ({ desk: null, recent: null }));
vi.mock('../../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info() {}, warn() {}, debug() {} }) }) }));
vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => (path.includes('desk') ? h.desk : h.recent)),
  DaylightAPIText: vi.fn(async () => '<work-title>Jesu Joy</work-title>'),
}));
vi.mock('../pianoListCache.js', () => ({ idbGet: async () => null, idbSet: async () => {}, idbClear: async () => {} }));

const piece = { scoreId: 'files:docs/sheet-music/jesu.mxl', practicedAt: '2026-11-18T10:00:00Z', total: 3, silver: 1, gold: 0,
  next: { passageId: 'b' }, nextGoldPassageId: 'a',
  passages: [{ id: 'a', start: 0, end: 4, state: 'silver' }, { id: 'b', start: 5, end: 8, state: 'learning' }, { id: 'c', start: 9, end: 12, state: 'todo' }] };
const course = { courseId: 'plex:9', courseTitle: 'Piano University', thumbnail: null, completed: 11, total: 173, lastPlayedAt: '2026-11-17T10:00:00Z' };
const mount = (props = {}) => { const handlers = { onOpenPassage: vi.fn(), onOpenCourse: vi.fn() }; render(<PianoHomeDesk {...handlers} {...props} />); return handlers; };

describe('PianoHomeDesk progress strip', () => {
  beforeEach(() => {
    __clearPianoListCache();
    h.desk = { players: [{ userId: 'kid', name: 'Kid', piece }, { userId: 'sib', name: 'Sib', piece: null }, { userId: 'idle', name: 'Idle', piece: null }] };
    h.recent = { players: [{ userId: 'kid', name: 'Kid', courses: [course] }, { userId: 'sib', name: 'Sib', courses: [course] }] };
  });

  it('shows one card per child with the more recent of piece and course', async () => {
    mount();
    expect(await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Sib: Piano University' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Idle/ })).toBeNull();
    expect(await screen.findByText('Jesu Joy')).toBeInTheDocument();
    expect(screen.getByText('11 of 173 lessons')).toBeInTheDocument();
  });

  it('opens the child next passage or course', async () => {
    const { onOpenPassage, onOpenCourse } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' }));
    expect(onOpenPassage).toHaveBeenCalledWith('kid', piece.scoreId, 'b');
    fireEvent.click(await screen.findByRole('button', { name: 'Sib: Piano University' }));
    expect(onOpenCourse).toHaveBeenCalledWith('sib', 'plex:9');
  });

  it('rechecks progress every time the home screen opens', async () => {
    const first = render(<PianoHomeDesk />);
    await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    first.unmount();
    h.desk = { players: [{ userId: 'kid', name: 'Kid', piece: { ...piece, silver: 2 } }] };
    render(<PianoHomeDesk />);
    expect(await screen.findByRole('button', { name: 'Kid: 2 of 3 Silver' })).toBeInTheDocument();
  });

  it('disables every card while closed', async () => {
    const { onOpenPassage } = mount({ disabled: true });
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(onOpenPassage).not.toHaveBeenCalled();
  });
});
