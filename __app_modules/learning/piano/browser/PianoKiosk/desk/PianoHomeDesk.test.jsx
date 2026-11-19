import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PianoHomeDesk from './PianoHomeDesk.jsx';
import { __clearPianoListCache } from '../usePianoList.js';

const h = vi.hoisted(() => ({ desk: null, recent: null }));
vi.mock('../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ users: [{ id: 'kid', schoolLearner: true }, { id: 'sib', schoolLearner: true }, { id: 'parent', schoolLearner: false }] }) }));
vi.mock('../../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info() {}, warn() {}, debug() {} }) }) }));
vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => (path.includes('desk') ? h.desk : h.recent)),
  DaylightAPIText: vi.fn(async () => '<work-title>Jesu Joy</work-title>'),
}));
vi.mock('../pianoListCache.js', () => ({ idbGet: async () => null, idbSet: async () => {}, idbClear: async () => {} }));

const piece = { scoreId: 'files:docs/sheet-music/jesu.mxl', practicedAt: '2026-11-18T10:00:00Z', total: 3, silver: 1, gold: 0,
  next: { passageId: 'b' }, nextGoldPassageId: 'a',
  passages: [{ id: 'a', start: 0, end: 4, state: 'silver' }, { id: 'b', start: 5, end: 8, state: 'learning' }, { id: 'c', start: 9, end: 12, state: 'todo' }] };
const course = { courseId: 'plex:9', courseTitle: 'Piano University', thumbnail: null, completed: 11, total: 173, lastPlayedAt: '2026-11-17T10:00:00Z',
  next: { id: 'plex:91', title: 'Lesson 12: Swing', thumbnail: '/api/still.jpg' } };
const mount = (props = {}) => { const handlers = { onOpenPassage: vi.fn(), onOpenCourse: vi.fn() }; render(<PianoHomeDesk {...handlers} {...props} />); return handlers; };

describe('PianoHomeDesk progress strip', () => {
  beforeEach(() => {
    __clearPianoListCache();
    h.desk = { players: [{ userId: 'kid', name: 'Kid', piece }, { userId: 'sib', name: 'Sib', piece: null }, { userId: 'idle', name: 'Idle', piece: null }] };
    h.recent = { players: [{ userId: 'kid', name: 'Kid', courses: [course] }, { userId: 'sib', name: 'Sib', courses: [course] }] };
  });

  it('gives a child with both a piece card and a course card, the course drawn as a ring', async () => {
    mount();
    expect(await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Kid: Lesson 12: Swing' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Sib: Lesson 12: Swing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Idle/ })).toBeNull();
    expect(await screen.findByText('Jesu Joy')).toBeInTheDocument();
    // A course is drawn as a ring with its percent, never a bar or a sentence.
    const sib = screen.getByRole('button', { name: 'Sib: Lesson 12: Swing' });
    const ring = sib.querySelector('.psc-ring');
    expect(ring.style.getPropertyValue('--p')).toBe('6');
    expect(ring.textContent).toBe('6%');
    expect(sib.querySelector('.piano-desk__bar')).toBeNull();
    expect(sib.textContent).not.toMatch(/lessons/);
  });

  it('puts the child avatar and name on every card, never a time', async () => {
    mount();
    await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    const cards = [...document.querySelectorAll('.piano-desk__card')];
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.querySelector('.piano-desk__name').textContent)).toEqual(['Kid', 'Kid', 'Sib']);
    expect(cards.every((card) => card.querySelector('.piano-avatar'))).toBe(true);
    expect(document.querySelector('.piano-desk').textContent).not.toMatch(/ago|just now/);
  });

  it('leads a course card with the next lesson: its still and its title', async () => {
    mount();
    const sib = await screen.findByRole('button', { name: 'Sib: Lesson 12: Swing' });
    expect(sib.querySelector('.piano-desk__media img').getAttribute('src')).toMatch(/^\/api\/still\.jpg/);
    expect(sib.querySelector('.piano-desk__title').textContent).toBe('Lesson 12: Swing');
  });

  it('shows the score poster on a piece card', async () => {
    h.desk.players[0].piece = { ...piece, cover: '/api/cover.jpg' };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(card.querySelector('.piano-desk__media img')).toHaveAttribute('src', '/api/cover.jpg');
  });

  it('fades the tomatoes nobody has started, and keeps the one up next bright', async () => {
    h.desk.players[0].piece = { ...piece, next: { passageId: 'c' }, passages: [
      { id: 'a', start: 0, end: 4, state: 'todo', steps: { done: 1, total: 4 } },
      { id: 'b', start: 5, end: 8, state: 'todo', steps: { done: 0, total: 4 } },
      { id: 'c', start: 9, end: 12, state: 'todo', steps: { done: 0, total: 4 } },
    ] };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect([...card.querySelectorAll('.piano-desk__map i')].map((mark) => mark.hasAttribute('data-faded'))).toEqual([false, true, false]);
  });

  it('draws each passage as its icon: a silver coin, a flower, a tomato, with the next one ringed', async () => {
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    const marks = [...card.querySelectorAll('.piano-desk__map i')];
    expect(marks.map((mark) => mark.querySelector('svg').getAttribute('class') + (mark.querySelector('svg').dataset.metal ?? ''))).toEqual(['coin-iconsilver', 'flower-icon', 'tomato-icon']);
    expect(marks.map((mark) => mark.hasAttribute('data-current'))).toEqual([false, true, false]);
  });

  it('counts the piece with coins, as the passage board does, and says no sentence', async () => {
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    const count = card.querySelector('.piano-desk__count');
    expect(count.textContent).toBe('1/3');
    expect(count.querySelectorAll('.coin-icon[data-metal="silver"]')).toHaveLength(1);
    // Gold is counted only once there is some.
    expect(count.querySelector('[data-level="gold"]')).toBeNull();
    expect(card.textContent).not.toMatch(/ of 3 Silver/);
  });

  it('keeps a twelve-passage piece to two rows of six small icons, so a card fits with or without a poster', async () => {
    h.desk.players[0].piece = { ...piece, total: 12, passages: Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, start: index * 4, end: index * 4 + 3, state: 'todo' })) };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 12 Silver' });
    expect(card.querySelector('.piano-desk__map').style.gridTemplateColumns).toBe('repeat(6, 26px)');
  });

  it('shows only the children, never the parents', async () => {
    h.recent.players.push({ userId: 'parent', name: 'Parent', courses: [course] });
    mount();
    await screen.findByRole('button', { name: 'Sib: Lesson 12: Swing' });
    expect(screen.queryByRole('button', { name: /Parent/ })).toBeNull();
  });

  it('opens the child next passage or course', async () => {
    const { onOpenPassage, onOpenCourse } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' }));
    expect(onOpenPassage).toHaveBeenCalledWith('kid', piece.scoreId, 'b');
    fireEvent.click(await screen.findByRole('button', { name: 'Sib: Lesson 12: Swing' }));
    expect(onOpenCourse).toHaveBeenCalledWith('sib', 'plex:9', 'plex:91');
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
