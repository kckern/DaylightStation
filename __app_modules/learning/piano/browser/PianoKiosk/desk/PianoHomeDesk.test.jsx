import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PianoHomeDesk, { PosterArt } from './PianoHomeDesk.jsx';
import { __clearPianoListCache } from '../usePianoList.js';

const h = vi.hoisted(() => ({ desk: null, recent: null, logs: [] }));
vi.mock('../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ users: [{ id: 'kid', schoolLearner: true }, { id: 'sib', schoolLearner: true }, { id: 'parent', schoolLearner: false }] }) }));
vi.mock('../../../../../../frontend/src/lib/logging/Logger.js', () => {
  const log = (event, data) => h.logs.push({ event, data });
  return { default: () => ({ child: () => ({ info: log, warn: log, debug: log }) }) };
});
vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => (path.includes('desk') ? h.desk : h.recent)),
  DaylightAPIText: vi.fn(async () => '<work-title>Jesu Joy</work-title>'),
}));
vi.mock('../pianoListCache.js', () => ({ idbGet: async () => null, idbSet: async () => {}, idbClear: async () => {} }));

// jsdom ships no PointerEvent, so fireEvent.pointer* would carry no coordinates.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse'; this.isPrimary = true; }
  };
}

const piece = { scoreId: 'files:docs/sheet-music/jesu.mxl', practicedAt: '2026-11-18T10:00:00Z', total: 3, silver: 1, gold: 0,
  next: { passageId: 'b' }, nextGoldPassageId: 'a',
  passages: [{ id: 'a', start: 0, end: 4, state: 'silver' }, { id: 'b', start: 5, end: 8, state: 'learning' }, { id: 'c', start: 9, end: 12, state: 'todo' }] };
const course = { courseId: 'plex:9', courseTitle: 'Piano University', thumbnail: null, completed: 11, total: 173, lastPlayedAt: '2026-11-17T10:00:00Z',
  next: { id: 'plex:91', title: 'Lesson 12: Swing', thumbnail: '/api/still.jpg' } };
const mount = (props = {}) => { const handlers = { onOpenPassage: vi.fn(), onOpenCourse: vi.fn() }; render(<PianoHomeDesk {...handlers} {...props} />); return handlers; };

describe('PianoHomeDesk progress strip', () => {
  beforeEach(() => {
    __clearPianoListCache();
    h.logs = [];
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
    expect(kidTabs.map((tab) => [tab.getAttribute('aria-label'), tab.getAttribute('aria-pressed')])).toEqual([['Kid: Sheet music', 'true'], ['Kid: Video lesson', 'false']]);
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
    expect(screen.getByRole('button', { name: 'Kid: Video lesson' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('swaps the card on a tab press, and opens nothing', async () => {
    const { onOpenPassage, onOpenCourse } = mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(card.querySelector('.piano-desk__badge').textContent).toBe('Silver next');
    fireEvent.click(screen.getByRole('button', { name: 'Kid: Video lesson' }));
    const shown = screen.getByRole('button', { name: 'Kid: Lesson 12: Swing' });
    expect(shown.querySelector('.piano-desk__badge')).toBeNull();
    expect(shown.querySelector('.piano-desk__title').textContent).toBe('Swing');
    expect(screen.queryByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Kid: Video lesson' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Kid: Sheet music' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Kid: Sheet music' }));
    expect(screen.getByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeInTheDocument();
    expect(onOpenPassage).not.toHaveBeenCalled();
    expect(onOpenCourse).not.toHaveBeenCalled();
    // The shown card still opens its own activity.
    fireEvent.click(screen.getByRole('button', { name: 'Kid: Video lesson' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kid: Lesson 12: Swing' }));
    expect(onOpenCourse).toHaveBeenCalledWith('kid', 'plex:9', 'plex:91');
  });

  it('sizes the strip by the cards shown, not a piece behind the other tab', async () => {
    h.desk.players[0].piece = { ...piece, total: 20, passages: Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, start: index * 4, end: index * 4 + 3, state: 'todo' })) };
    h.recent.players[0].courses = [{ ...course, lastPlayedAt: '2026-11-19T10:00:00Z' }];
    mount();
    await screen.findByRole('button', { name: 'Kid: Lesson 12: Swing' });
    expect(document.querySelector('.piano-desk').hasAttribute('data-tall')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Kid: Sheet music' }));
    expect(document.querySelector('.piano-desk').hasAttribute('data-tall')).toBe(true);
  });

  it('draws a course as its title without the lesson number, the number by the episode still, and a bar', async () => {
    mount();
    const sib = await screen.findByRole('button', { name: 'Sib: Lesson 12: Swing' });
    expect(sib.querySelector('.piano-desk__title').textContent).toBe('Swing');
    expect(sib.querySelector('.piano-desk__episode .piano-desk__step').textContent).toBe('Lesson 12');
    // No badge: the episode's own still says which lesson is next.
    expect(sib.querySelector('.piano-desk__badge')).toBeNull();
    expect(sib.querySelector('.piano-desk__still img').getAttribute('src')).toBe('/api/still.jpg?w=192&h=108');
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
    fireEvent.click(await screen.findByRole('button', { name: 'Kid: Video lesson' }));
    const kid = await screen.findByRole('button', { name: 'Kid: Lesson 12: Swing' });
    expect(kid.querySelector('.piano-desk__poster img').getAttribute('src')).toBe('/api/course.jpg?w=180&h=270');
    const sib = screen.getByRole('button', { name: 'Sib: Lesson 12: Swing' });
    expect(sib.querySelector('.piano-desk__poster img')).toBeNull();
    expect(sib.querySelector('.piano-desk__poster[data-stand-in]').textContent).toMatch(/Piano University/);
  });

  it('shows the score poster on a piece card', async () => {
    h.desk.players[0].piece = { ...piece, cover: '/api/cover.jpg' };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(card.querySelector('.piano-desk__poster img')).toHaveAttribute('src', '/api/cover.jpg?w=180&h=270');
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
    expect(container.querySelector('img').getAttribute('src')).toBe('/api/new.jpg?w=180&h=270');
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

  it('badges a piece Silver next, names the bars, and counts Silver over the coins', async () => {
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(card.querySelector('.piano-desk__badge').textContent).toBe('Silver next');
    expect(card.querySelector('.piano-desk__step').textContent).toBe('Bars 6–9');
    const progress = card.querySelector('.piano-desk__progress');
    expect(progress.querySelector('.piano-desk__count [data-level="silver"]').textContent).toBe('1/3');
    expect(progress.querySelector('.piano-desk__count [data-level="gold"]')).toBeNull();
    // One row: the coins, then the count beside them.
    expect([...progress.children].map((el) => el.className)).toEqual(['piano-desk__map', 'piano-desk__count']);
    expect(progress.getAttribute('data-rows')).toBe('1');
  });

  it('adds the coach\'s next skill as what to do in the bars, and leaves it out when there is none', async () => {
    h.desk.players[0].piece = { ...piece, next: { passageId: 'b', skill: 'pulse', label: 'Settle into a beat', start: 5, end: 8 } };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(card.querySelector('.piano-desk__skill').textContent).toBe('Settle into a beat');
    // The order down the right column: badge, title, bars, skill, progress.
    expect([...card.querySelector('.piano-desk__text').children].map((el) => el.className.replace('piano-desk__', '')))
      .toEqual(['badge', 'title', 'step', 'skill', 'progress']);
  });

  it('draws no skill line when the coach names none', async () => {
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(card.querySelector('.piano-desk__skill')).toBeNull();
  });

  it('keeps seven passages on one row of coins, under the count', async () => {
    h.desk.players[0].piece = { ...piece, total: 7, passages: Array.from({ length: 7 }, (_, index) => ({ id: `p${index}`, start: index * 4, end: index * 4 + 3, state: 'todo' })) };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 7 Silver' });
    expect(card.querySelector('.piano-desk__map').style.gridTemplateColumns).toBe('repeat(7, minmax(0, 23px))');
    expect(card.querySelector('.piano-desk__progress').getAttribute('data-count')).toBe('above');
    expect(card.hasAttribute('data-rows')).toBe(false);
    expect(document.querySelector('.piano-desk').hasAttribute('data-tall')).toBe(false);
  });

  it('wraps a longer piece onto two rows and makes every card on the strip taller', async () => {
    h.desk.players[0].piece = { ...piece, total: 20, passages: Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, start: index * 4, end: index * 4 + 3, state: 'todo' })) };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 20 Silver' });
    expect(card.querySelector('.piano-desk__map').style.gridTemplateColumns).toBe('repeat(10, minmax(0, 15px))');
    expect(card.getAttribute('data-rows')).toBe('2');
    expect(document.querySelector('.piano-desk').hasAttribute('data-tall')).toBe(true);
  });

  it('ends the coin row with the Polish gem, sized like a coin, and badges Diamond next', async () => {
    const coins = piece.passages.map((passage) => ({ ...passage, state: 'gold' }));
    h.desk.players[0].piece = { ...piece, silver: 3, gold: 3, passages: coins, polish: { gem: true, diamond: false } };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 3 of 3 Silver, Polish gem' });
    const map = card.querySelector('.piano-desk__map');
    expect(map.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 30px)) minmax(0, 30px)');
    const stone = map.lastElementChild;
    expect(stone.getAttribute('data-stone')).toBe('gem');
    expect(stone.querySelector('svg.gem-icon')).not.toBeNull();
    expect(map.querySelectorAll('[data-stone]')).toHaveLength(1);
    expect(card.querySelector('.piano-desk__badge').textContent).toBe('Diamond next');
    expect(card.querySelector('.piano-desk__badge').getAttribute('data-level')).toBe('diamond');
  });

  it('shows the diamond in the gem\'s place, and badges an all-Gold piece Polish next before either', async () => {
    const coins = piece.passages.map((passage) => ({ ...passage, state: 'gold' }));
    h.desk.players[0].piece = { ...piece, silver: 3, gold: 3, passages: coins, polish: { gem: true, diamond: true } };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 3 of 3 Silver, Polish diamond' });
    expect([...card.querySelectorAll('[data-stone]')].map((stone) => stone.getAttribute('data-stone'))).toEqual(['diamond']);
    expect(card.querySelector('.piano-desk__badge').textContent).toBe('Diamond');
  });

  it('draws no stone before the gem, and keeps the row its usual width', async () => {
    const coins = piece.passages.map((passage) => ({ ...passage, state: 'gold' }));
    h.desk.players[0].piece = { ...piece, silver: 3, gold: 3, passages: coins, polish: { gem: false, diamond: false } };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 3 of 3 Silver' });
    expect(card.querySelector('[data-stone]')).toBeNull();
    expect(card.querySelector('.piano-desk__map').style.gridTemplateColumns).toBe('repeat(3, minmax(0, 36px))');
    expect(card.querySelector('.piano-desk__progress').getAttribute('data-count')).toBe('beside');
    expect(card.querySelector('.piano-desk__badge').textContent).toBe('Polish next');
  });

  it('sends an all-Gold piece to Polish: the whole piece, no passage ringed', async () => {
    const coins = piece.passages.map((passage) => ({ ...passage, state: 'gold' }));
    h.desk.players[0].piece = { ...piece, silver: 3, gold: 3, passages: coins, polish: { gem: false, diamond: false } };
    const { onOpenPassage } = mount();
    const card = await screen.findByRole('button', { name: 'Kid: 3 of 3 Silver' });
    expect(card.querySelector('.piano-desk__step').textContent).toBe('Whole piece');
    expect(card.querySelector('.piano-desk__map [data-current]')).toBeNull();
    fireEvent.click(card);
    expect(onOpenPassage).toHaveBeenCalledWith('kid', piece.scoreId, null, { mode: 'polish' });
  });

  it('stands the stone beside both rows of a two-row piece', async () => {
    h.desk.players[0].piece = { ...piece, total: 20, polish: { gem: true, diamond: false },
      passages: Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, start: index * 4, end: index * 4 + 3, state: 'gold' })) };
    mount();
    const card = await screen.findByRole('button', { name: 'Kid: 1 of 20 Silver, Polish gem' });
    const stone = card.querySelector('[data-stone]');
    expect(stone.style.gridColumn).toBe('11');
    expect(stone.style.gridRow).toBe('1 / span 2');
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
    expect(screen.getByRole('button', { name: 'Kid: Sheet music' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kid: Video lesson' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Kid: Video lesson' }));
    expect(screen.getByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeInTheDocument();
    fireEvent.click(card);
    expect(onOpenPassage).not.toHaveBeenCalled();
  });

  it('stands in for a missing or broken episode still with a play frame', async () => {
    h.recent.players[1].courses = [{ ...course, next: { ...course.next, thumbnail: null } }];
    mount();
    const sib = await screen.findByRole('button', { name: 'Sib: Lesson 12: Swing' });
    expect(sib.querySelector('.piano-desk__still img')).toBeNull();
    expect(sib.querySelector('.piano-desk__still[data-stand-in] .piano-icon')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Kid: Video lesson' }));
    const kid = screen.getByRole('button', { name: 'Kid: Lesson 12: Swing' });
    fireEvent.error(kid.querySelector('.piano-desk__still img'));
    expect(kid.querySelector('.piano-desk__still img')).toBeNull();
    expect(kid.querySelector('.piano-desk__still[data-stand-in]')).not.toBeNull();
  });

  it('keeps the same structure for a short and a long title', async () => {
    const long = 'Counting Rhythms with Our Rhythm Challenge - Eighth Rests';
    h.recent.players[1].courses = [{ ...course, next: { ...course.next, title: `Lesson 101 | ${long}` } }];
    mount();
    const sib = await screen.findByRole('button', { name: `Sib: Lesson 101 | ${long}` });
    const shortCard = screen.getByRole('button', { name: 'Kid: 1 of 3 Silver' });
    expect(sib.querySelector('.piano-desk__title').textContent).toBe(long);
    expect(sib.querySelector('.piano-desk__step').textContent).toBe('Lesson 101');
    for (const card of [sib, shortCard]) {
      expect([...card.children].map((el) => el.className)).toEqual(['piano-desk__poster', 'piano-desk__text']);
      expect(card.querySelector('.piano-desk__text').lastElementChild.className).toBe('piano-desk__progress');
    }
  });

  describe('swiping between a child\'s cards', () => {
    const deckOf = (name) => screen.getByRole('button', { name }).closest('.piano-desk__deck');
    const drag = (deck, dx, dy = 0, { click = true } = {}) => {
      const target = deck.querySelector('.piano-desk__card');
      fireEvent.pointerDown(target, { pointerId: 1, clientX: 100, clientY: 50, button: 0 });
      fireEvent.pointerMove(target, { pointerId: 1, clientX: 100 + dx / 2, clientY: 50 + dy / 2 });
      fireEvent.pointerMove(target, { pointerId: 1, clientX: 100 + dx, clientY: 50 + dy });
      fireEvent.pointerUp(target, { pointerId: 1, clientX: 100 + dx, clientY: 50 + dy });
      // The browser's click after the gesture lands on whatever card is there now.
      if (click) fireEvent.click(deck.querySelector('.piano-desk__card'));
    };

    it('switches on a swipe left or right, wrapping, and opens nothing', async () => {
      const { onOpenPassage, onOpenCourse } = mount();
      await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
      drag(deckOf('Kid: 1 of 3 Silver'), -60);
      expect(screen.getByRole('button', { name: 'Kid: Lesson 12: Swing' })).toHaveAttribute('data-enter', 'left');
      expect(screen.getByRole('button', { name: 'Kid: Video lesson' })).toHaveAttribute('aria-pressed', 'true');
      expect(h.logs.filter((log) => log.event === 'piano.desk.swipe').at(-1).data).toEqual({ userId: 'kid', from: 'piece', to: 'course' });
      // Past the last card, a swipe left wraps to the first.
      drag(deckOf('Kid: Lesson 12: Swing'), -60);
      expect(screen.getByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeInTheDocument();
      drag(deckOf('Kid: 1 of 3 Silver'), 60);
      expect(screen.getByRole('button', { name: 'Kid: Lesson 12: Swing' })).toHaveAttribute('data-enter', 'right');
      expect(onOpenPassage).not.toHaveBeenCalled();
      expect(onOpenCourse).not.toHaveBeenCalled();
    });

    it('ignores a short or mostly vertical drag, which opens nothing either', async () => {
      const { onOpenPassage } = mount();
      await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
      drag(deckOf('Kid: 1 of 3 Silver'), -30);
      expect(screen.getByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeInTheDocument();
      drag(deckOf('Kid: 1 of 3 Silver'), -50, 80, { click: false });
      expect(screen.getByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeInTheDocument();
      // A short sideways drag is still a drag, so its click is swallowed.
      expect(onOpenPassage).not.toHaveBeenCalled();
    });

    it('still opens the card on a plain tap after a swipe', async () => {
      const { onOpenCourse } = mount();
      await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
      drag(deckOf('Kid: 1 of 3 Silver'), -60);
      const card = screen.getByRole('button', { name: 'Kid: Lesson 12: Swing' });
      fireEvent.pointerDown(card, { pointerId: 2, clientX: 10, clientY: 10, button: 0 });
      fireEvent.pointerUp(card, { pointerId: 2, clientX: 11, clientY: 10 });
      fireEvent.click(card);
      expect(onOpenCourse).toHaveBeenCalledWith('kid', 'plex:9', 'plex:91');
    });

    it('does not swipe a child with one card, nor any card while closed', async () => {
      mount({ disabled: true });
      await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
      drag(deckOf('Kid: 1 of 3 Silver'), -60, 0, { click: false });
      expect(screen.getByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeInTheDocument();
      drag(deckOf('Sib: Lesson 12: Swing'), -60, 0, { click: false });
      expect(screen.getByRole('button', { name: 'Sib: Lesson 12: Swing' })).toBeInTheDocument();
      expect(deckOf('Sib: Lesson 12: Swing').hasAttribute('data-swipe')).toBe(false);
    });

    it('follows the finger a little while dragging, then lets go', async () => {
      mount();
      await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
      const deck = deckOf('Kid: 1 of 3 Silver');
      const card = deck.querySelector('.piano-desk__card');
      fireEvent.pointerDown(card, { pointerId: 3, clientX: 100, clientY: 50, button: 0 });
      fireEvent.pointerMove(card, { pointerId: 3, clientX: 80, clientY: 50 });
      expect(deck.style.getPropertyValue('--piano-desk-drag')).toBe('-10px');
      expect(deck.hasAttribute('data-dragging')).toBe(true);
      fireEvent.pointerMove(card, { pointerId: 3, clientX: -200, clientY: 50 });
      expect(deck.style.getPropertyValue('--piano-desk-drag')).toBe('-32px');
      fireEvent.pointerCancel(card, { pointerId: 3 });
      expect(deck.style.getPropertyValue('--piano-desk-drag')).toBe('0px');
      expect(deck.hasAttribute('data-dragging')).toBe(false);
    });
    it('never eats the next tap: a drag with no click after it, then a tap at once, opens', async () => {
      const { onOpenCourse } = mount();
      await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
      // The Android WebView sends no click after a drag.
      drag(deckOf('Kid: 1 of 3 Silver'), -60, 0, { click: false });
      const card = screen.getByRole('button', { name: 'Kid: Lesson 12: Swing' });
      fireEvent.pointerDown(card, { pointerId: 5, clientX: 50, clientY: 50, button: 0 });
      fireEvent.pointerUp(card, { pointerId: 5, clientX: 50, clientY: 50 });
      fireEvent.click(card);
      expect(onOpenCourse).toHaveBeenCalledWith('kid', 'plex:9', 'plex:91');
    });

    it('opens on a jittery tap that wanders 10px', async () => {
      const { onOpenPassage } = mount();
      const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
      fireEvent.pointerDown(card, { pointerId: 6, clientX: 100, clientY: 50, button: 0 });
      fireEvent.pointerMove(card, { pointerId: 6, clientX: 110, clientY: 52 });
      fireEvent.pointerUp(card, { pointerId: 6, clientX: 110, clientY: 52 });
      fireEvent.click(card);
      expect(onOpenPassage).toHaveBeenCalledWith('kid', piece.scoreId, 'b');
    });

    it('also opens after a small sideways wobble short of half a swipe', async () => {
      const { onOpenPassage } = mount();
      const card = await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' });
      fireEvent.pointerDown(card, { pointerId: 7, clientX: 100, clientY: 50, button: 0 });
      fireEvent.pointerMove(card, { pointerId: 7, clientX: 115, clientY: 50 });
      fireEvent.pointerUp(card, { pointerId: 7, clientX: 115, clientY: 50 });
      fireEvent.click(card);
      expect(onOpenPassage).toHaveBeenCalledTimes(1);
    });

    it('ignores a second finger, and a lost capture ends the drag', async () => {
      mount();
      const deck = (await screen.findByRole('button', { name: 'Kid: 1 of 3 Silver' })).closest('.piano-desk__deck');
      const card = deck.querySelector('.piano-desk__card');
      fireEvent.pointerDown(card, { pointerId: 8, clientX: 100, clientY: 50, button: 0 });
      // A second finger lands and swipes; only the first finger counts.
      fireEvent.pointerDown(card, { pointerId: 9, clientX: 200, clientY: 50, button: 0 });
      fireEvent.pointerMove(card, { pointerId: 9, clientX: 100, clientY: 50 });
      fireEvent.pointerUp(card, { pointerId: 9, clientX: 100, clientY: 50 });
      expect(screen.getByRole('button', { name: 'Kid: 1 of 3 Silver' })).toBeInTheDocument();
      fireEvent.pointerMove(card, { pointerId: 8, clientX: 70, clientY: 50 });
      expect(deck.hasAttribute('data-dragging')).toBe(true);
      // The card losing touch's implicit capture to the deck does not end the drag...
      fireEvent(card, new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 8 }));
      expect(deck.hasAttribute('data-dragging')).toBe(true);
      // ...the deck losing its own capture does.
      fireEvent(deck, new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 8 }));
      expect(deck.hasAttribute('data-dragging')).toBe(false);
      expect(deck.style.getPropertyValue('--piano-desk-drag')).toBe('0px');
      // The gesture is over: a new swipe works.
      drag(deck, -60);
      expect(screen.getByRole('button', { name: 'Kid: Lesson 12: Swing' })).toBeInTheDocument();
    });
  });
});
