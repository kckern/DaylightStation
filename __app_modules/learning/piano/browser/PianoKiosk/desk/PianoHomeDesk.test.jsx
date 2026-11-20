import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PianoHomeDesk, { PosterArt } from './PianoHomeDesk.jsx';
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

  it('gives each child one card, the piece when it is their latest, and tabs only to a child with both', async () => {
    mount();
    expect(await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kid: Lesson 12: Swing' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Sib: Lesson 12: Swing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Idle/ })).toBeNull();
    const [kid, sib] = [...document.querySelectorAll('.piano-desk__child')];
    const kidTabs = [...kid.querySelectorAll('.piano-desk__tab')];
    expect(kidTabs.map((tab) => [tab.getAttribute('aria-label'), tab.getAttribute('aria-pressed')])).toEqual([['Sheet music', 'true'], ['Video lesson', 'false']]);
    expect(sib.querySelectorAll('.piano-desk__tab')).toHaveLength(0);
    // The printed title, once on the card's title line (the poster stand-in repeats it).
    await screen.findAllByText('Jesu Joy');
    expect(screen.getByRole('button', { name: 'Kid: 1 of 3 Silver' }).querySelector('.piano-desk__title').textContent).toBe('Jesu Joy');
  });

  it('defaults to the course when it was played after the piece', async () => {
    h.recent.players[0].courses = [{ ...course, lastPlayedAt: '2026-11-19T10:00:00Z' }];
    mount();
    expect(await screen.findByRole('button', { name: 'Kid: Lesson 12: Swing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Video lesson' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('swaps the card on a tab press, and opens nothing', async () => {
    const { onOpenPassage, onOpenCourse } = mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(card.querySelector('.piano-desk__badge').textContent).toBe('Silver next');
    fireEvent.click(screen.getByRole('button', { name: 'Video lesson' }));
    const shown = screen.getByRole('button', { name: 'Kid: Lesson 12: Swing' });
    expect(shown.querySelector('.piano-desk__badge').textContent).toBe('Next lesson');
    expect(shown.querySelector('.piano-desk__title').textContent).toBe('Swing');
    expect(screen.queryByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Video lesson' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sheet music' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Sheet music' }));
    expect(screen.getByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeInTheDocument();
    expect(onOpenPassage).not.toHaveBeenCalled();
    expect(onOpenCourse).not.toHaveBeenCalled();
    // The shown card still opens its own activity.
    fireEvent.click(screen.getByRole('button', { name: 'Video lesson' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kid: Lesson 12: Swing' }));
    expect(onOpenCourse).toHaveBeenCalledWith('kid', 'plex:9', 'plex:91');
  });

  it('sizes the strip by the cards shown, not a piece behind the other tab', async () => {
    h.desk.players[0].piece = { ...piece, total: 20, passages: Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, start: index * 4, end: index * 4 + 3, state: 'todo' })) };
    h.recent.players[0].courses = [{ ...course, lastPlayedAt: '2026-11-19T10:00:00Z' }];
    mount();
    await screen.findByRole('button', { name: 'Kid: Lesson 12: Swing' });
    expect(document.querySelector('.piano-desk').hasAttribute('data-tall')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Sheet music' }));
    expect(document.querySelector('.piano-desk').hasAttribute('data-tall')).toBe(true);
  });

  it('draws a course as its title without the lesson number, the number below, and a bar', async () => {
    mount();
    const sib = await screen.findByRole('button', { name: 'Sib: Lesson 12: Swing' });
    expect(sib.querySelector('.piano-desk__title').textContent).toBe('Swing');
    expect(sib.querySelector('.piano-desk__step').textContent).toBe('Lesson 12');
    expect(sib.querySelector('.piano-desk__badge').textContent).toBe('Next lesson');
    expect(sib.querySelector('.piano-desk__bar i').style.width).toBe('6%');
    expect(sib.querySelector('.piano-desk__pct').textContent).toBe('6%');
    expect(sib.querySelector('.psc-ring')).toBeNull();
  });

  it('heads each child once, above their cards, never a time', async () => {
    mount();
    await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    const panels = [...document.querySelectorAll('.piano-desk__child')];
    expect(panels.map((panel) => panel.querySelector('.piano-desk__name').textContent)).toEqual(['Kid', 'Sib']);
    expect(panels.map((panel) => panel.querySelectorAll('.piano-desk__card').length)).toEqual([1, 1]);
    expect(document.querySelectorAll('.piano-desk__card .piano-avatar')).toHaveLength(0);
    expect(document.querySelector('.piano-desk').textContent).not.toMatch(/ago|just now/);
  });

  it('puts the course art on the poster, and a stand-in when there is none', async () => {
    h.recent.players[0].courses = [{ ...course, thumbnail: '/api/course.jpg' }];
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Video lesson' }));
    const kid = await screen.findByRole('button', { name: 'Kid: Lesson 12: Swing' });
    expect(kid.querySelector('.piano-desk__poster img').getAttribute('src')).toBe('/api/course.jpg?w=120&h=180');
    const sib = screen.getByRole('button', { name: 'Sib: Lesson 12: Swing' });
    expect(sib.querySelector('.piano-desk__poster img')).toBeNull();
    expect(sib.querySelector('.piano-desk__poster[data-stand-in]').textContent).toMatch(/Piano University/);
  });

  it('shows the score poster on a piece card', async () => {
    h.desk.players[0].piece = { ...piece, cover: '/api/cover.jpg' };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(card.querySelector('.piano-desk__poster img')).toHaveAttribute('src', '/api/cover.jpg?w=120&h=180');
  });

  it('stands in for a piece with no cover with its title', async () => {
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(card.querySelector('.piano-desk__poster img')).toBeNull();
    await screen.findAllByText('Jesu Joy');
    expect(card.querySelector('.piano-desk__poster[data-stand-in]').textContent).toMatch(/Jesu Joy/);
  });

  it('swaps a cover that fails to load for the stand-in', async () => {
    h.desk.players[0].piece = { ...piece, cover: '/api/cover.jpg' };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    fireEvent.error(card.querySelector('.piano-desk__poster img'));
    expect(card.querySelector('.piano-desk__poster img')).toBeNull();
    expect(card.querySelector('.piano-desk__poster[data-stand-in]')).not.toBeNull();
  });

  it('tries a new picture after an old one failed', () => {
    // The strip keys each poster by its picture, as here.
    const { container, rerender } = render(<PosterArt key="/api/old.jpg" src="/api/old.jpg" title="Old" />);
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('[data-stand-in]')).not.toBeNull();
    rerender(<PosterArt key="/api/new.jpg" src="/api/new.jpg" title="New" />);
    expect(container.querySelector('img').getAttribute('src')).toBe('/api/new.jpg?w=120&h=180');
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

  it('badges a piece Silver next and leaves the counting to the coins', async () => {
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(card.querySelector('.piano-desk__badge').textContent).toBe('Silver next');
    expect(card.querySelector('.piano-desk__step').textContent).toBe('Bars 6–9');
    expect(card.querySelector('.piano-desk__count')).toBeNull();
    expect(card.textContent).not.toMatch(/ of 3 Silver/);
  });

  it('keeps up to fourteen passages on one row of coins', async () => {
    h.desk.players[0].piece = { ...piece, total: 12, passages: Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, start: index * 4, end: index * 4 + 3, state: 'todo' })) };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 12 Silver' });
    expect(card.querySelector('.piano-desk__map').style.gridTemplateColumns).toBe('repeat(12, minmax(0, 21px))');
    expect(card.hasAttribute('data-rows')).toBe(false);
    expect(document.querySelector('.piano-desk').hasAttribute('data-tall')).toBe(false);
  });

  it('wraps a longer piece onto two rows and makes every card on the strip taller', async () => {
    h.desk.players[0].piece = { ...piece, total: 20, passages: Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, start: index * 4, end: index * 4 + 3, state: 'todo' })) };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 20 Silver' });
    expect(card.querySelector('.piano-desk__map').style.gridTemplateColumns).toBe('repeat(10, minmax(0, 22px))');
    expect(card.getAttribute('data-rows')).toBe('2');
    expect(document.querySelector('.piano-desk').hasAttribute('data-tall')).toBe(true);
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

  it('disables every card and tab while closed', async () => {
    const { onOpenPassage } = mount({ disabled: true });
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(card).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sheet music' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Video lesson' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Video lesson' }));
    expect(screen.getByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeInTheDocument();
    fireEvent.click(card);
    expect(onOpenPassage).not.toHaveBeenCalled();
  });
});
