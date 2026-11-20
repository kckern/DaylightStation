import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: () => logger };
  return { default: () => logger, getLogger: () => logger };
});
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: api.call }));

import PassageRail from './PassageRail.jsx';
import PassageBoard from './PassageBoard.jsx';
import usePieceGemOffer from './usePieceGemOffer.js';
import { railModel } from './passageRail.js';

const segment = (index, state, done = 0) => ({ id: `p${index}`, inMeasure: index * 4, outMeasure: index * 4 + 3, barLabel: `Bars ${index * 4 + 1}–${index * 4 + 4}`,
  printedMeasures: [index * 4 + 1, index * 4 + 4],
  certification: { silver: state === 'silver' || state === 'gold' ? { at: 'x' } : null, gold: state === 'gold' ? { at: 'x' } : null },
  flower: state === 'learning',
  skills: Array.from({ length: 4 }, (_, step) => ({ track: 'silver', ready: state === 'silver' || state === 'gold' || step < done, successes: 0 })) });
const projectionOf = (segments, recommended) => ({ segments, recommended: recommended ? { passageId: recommended } : null,
  piece: { total: segments.length, silver: segments.filter((item) => item.certification.silver).length, gold: segments.filter((item) => item.certification.gold).length,
    nextGoldPassageId: segments.find((item) => !item.certification.gold)?.id ?? null } });
const modelOf = (segments, recommended, selectedId = null) => railModel({ segments, projection: projectionOf(segments, recommended), selectedId });
const widthOf = (px) => vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(px);
afterEach(() => { vi.restoreAllMocks(); api.call.mockReset(); });

describe('PassageRail', () => {
  const four = [segment(0, 'gold'), segment(1, 'silver'), segment(2, 'learning', 2), segment(3, 'todo')];

  it('shows every passage by starting bar with its state, and never the word Segment', () => {
    widthOf(900);
    render(<PassageRail model={modelOf(four, 'p2')} onPractice={vi.fn()} />);
    const rail = screen.getByRole('navigation', { name: 'Passages in this piece' });
    const tiles = within(rail).getAllByRole('listitem').map((item) => within(item).getByRole('button'));
    expect(tiles.map((tile) => [tile.textContent, tile.dataset.state])).toEqual([['1', 'gold'], ['5', 'silver'], ['9', 'learning'], ['13', 'todo']]);
    // A passage is its icon: a gold coin, a silver coin, a flower, a tomato.
    expect(tiles.map((tile) => tile.querySelector('svg').getAttribute('class') + (tile.querySelector('svg').dataset.metal ?? ''))).toEqual(['coin-icongold', 'coin-iconsilver', 'flower-icon', 'tomato-icon']);
    expect(tiles[2]).toHaveAttribute('aria-current', 'step');
    expect(rail.textContent).not.toMatch(/Segment/);
    expect(screen.getByRole('button', { name: 'Practice bars 9–12' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 of 4 Silver. Open the passage board' })).toHaveTextContent('2/4');
    expect(screen.getByRole('button', { name: '2 of 4 Silver. Open the passage board' }).querySelector('.coin-icon[data-metal="silver"]')).not.toBeNull();
  });

  it('is only the map and the count when the host has its own controls', () => {
    widthOf(900);
    const onSelect = vi.fn();
    render(<PassageRail model={modelOf(four, null, 'p1')} onSelect={onSelect} />);
    const rail = screen.getByRole('navigation', { name: 'Passages in this piece' });
    expect(rail).toHaveAttribute('data-bare', 'true');
    expect(rail.querySelector('.piano-passage-rail__go')).toBeNull();
    expect(within(rail).getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Bars 13–16, Not started' }));
    expect(onSelect).toHaveBeenCalledWith('p3');
  });

  it('selects on a tile tap and practices only from the button', () => {
    widthOf(900);
    const onSelect = vi.fn(); const onPractice = vi.fn(); const onOpenBoard = vi.fn();
    render(<PassageRail model={modelOf(four, 'p2', 'p3')} onSelect={onSelect} onPractice={onPractice} onOpenBoard={onOpenBoard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bars 1–4, Gold' }));
    expect(onSelect).toHaveBeenCalledWith('p0');
    expect(onPractice).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Bars 13–16, Not started' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Practice bars 13–16' }));
    expect(onPractice).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '2 of 4 Silver. Open the passage board' }));
    expect(onOpenBoard).toHaveBeenCalledWith(null);
  });

  it('sizes tiles by bar count with a touch-target floor', () => {
    widthOf(900);
    const uneven = [segment(0, 'todo'), { ...segment(1, 'todo'), outMeasure: 13 }];
    render(<PassageRail model={modelOf(uneven, 'p0')} />);
    expect(screen.getByRole('list').style.gridTemplateColumns).toBe('minmax(44px, 4fr) minmax(44px, 10fr)');
  });

  it('turns a long piece into a map whose taps open the board at that passage', () => {
    widthOf(900);
    const long = Array.from({ length: 40 }, (_, index) => segment(index, index < 3 ? 'silver' : 'todo'));
    const onSelect = vi.fn(); const onOpenBoard = vi.fn();
    render(<PassageRail model={modelOf(long, 'p3')} onSelect={onSelect} onOpenBoard={onOpenBoard} />);
    const list = screen.getByRole('list');
    expect(list).toHaveAttribute('data-compact', 'true');
    expect(within(list).getAllByRole('button')).toHaveLength(40);
    expect(list.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Bars 37–40, Not started. Open the passage board' }));
    expect(onOpenBoard).toHaveBeenCalledWith('p9');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('turns the tiles that were just earned, held until the ceremony announces them', () => {
    widthOf(900);
    const done = [segment(0, 'silver'), segment(1, 'silver')];
    render(<PassageRail model={modelOf(done, null)} flips={{ p0: 'silver' }} flipDelayMs={1200} />);
    const earned = screen.getByRole('button', { name: 'Bars 1–4, Silver' });
    expect(earned).toHaveAttribute('data-flip', 'silver');
    expect(earned.style.getPropertyValue('--turn-delay')).toBe('1200ms');
    // The earned tile's icon turns over: the flower leaves and the silver coin lands.
    const turn = earned.querySelector('.piano-passage-turn');
    expect([...turn.children].map((icon) => icon.getAttribute('class') + (icon.dataset.metal ?? ''))).toEqual(['flower-icon', 'coin-iconsilver']);
    expect(screen.getByRole('button', { name: 'Bars 5–8, Silver' }).querySelector('.piano-passage-turn')).toBeNull();
  });

  it('turns a finished piece as a wave, with no banner and no sentence', () => {
    widthOf(900);
    const done = [segment(0, 'silver'), segment(1, 'silver'), segment(2, 'silver')];
    render(<PassageRail model={modelOf(done, null)} flips={{ p0: 'silver', p1: 'silver', p2: 'silver' }} flipDelayMs={1000} wave onPractice={vi.fn()} />);
    const delays = screen.getAllByRole('button', { name: /Bars .*, Silver/ }).map((tile) => parseInt(tile.style.getPropertyValue('--turn-delay'), 10));
    expect(delays).toEqual([1000, 1045, 1090]);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/whole piece/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Go for Gold: bars 1–4' })).toHaveAttribute('data-kind', 'gold');
  });

  it('writes the turn delay into the animation itself, so a later rule cannot reset it', () => {
    const source = readFileSync(resolve(__dirname, 'PassageRail.scss'), 'utf8');
    expect(source.match(/animation: piano-passage-turn-(out|in) [^;]*var\(--turn-delay, 0ms\)[^;]*;/g)).toHaveLength(2);
    expect(source).not.toMatch(/animation-delay/);
  });

  it('carries state without opacity, and draws it with the one passage icon', () => {
    const source = readFileSync(resolve(__dirname, 'PassageRail.scss'), 'utf8');
    expect(source).not.toMatch(/opacity\s*:/);
    expect(source).not.toMatch(/transparent|rgba\(|filter\s*:/);
    for (const file of ['PassageRail.jsx', 'PassageBoard.jsx']) expect(readFileSync(resolve(__dirname, file), 'utf8')).toMatch(/PassageCoin/);
  });
});

describe('PassageBoard', () => {
  const four = [segment(0, 'gold'), segment(1, 'silver'), segment(2, 'learning', 2), segment(3, 'todo')];
  it('lists every passage with its bars and progress, the count and both goals', () => {
    render(<PassageBoard title="Minuet in G" model={modelOf(four, 'p2')} gemOffered onClose={vi.fn()} />);
    const board = screen.getByRole('dialog', { name: 'Passage board' });
    expect(within(board).getByRole('heading', { name: 'Minuet in G' })).toBeInTheDocument();
    const goals = within(board).getByRole('list', { name: 'Goals for this piece' });
    expect(goals).toHaveTextContent('2/4earn a gem1/4earn a gem');
    expect(within(goals).getByRole('listitem', { name: 'All Silver: 2 of 4, earn a gem' })).toBeInTheDocument();
    expect(board.querySelector('p')).toBeNull();
    const partway = within(board).getByRole('button', { name: 'Bars 9–12, Partway, 2 of 4 steps' });
    expect(partway).toHaveTextContent('Bars 9–12');
    expect(partway.querySelector('.flower-icon')).not.toBeNull();
    expect(partway.querySelectorAll('i[data-done="true"]')).toHaveLength(2);
    expect(partway.querySelectorAll('i')).toHaveLength(4);
    expect(partway).toHaveAttribute('aria-current', 'step');
    expect(within(board).getByRole('button', { name: 'Bars 1–4, Gold' }).querySelector('.coin-icon[data-metal="gold"]')).not.toBeNull();
    expect(within(board).getByRole('button', { name: 'Bars 13–16, Not started' }).querySelector('.tomato-icon')).not.toBeNull();
    expect(within(board).getByRole('button', { name: 'Bars 13–16, Not started' }).querySelectorAll('i')).toHaveLength(0);
    expect(within(board).getByRole('list', { name: 'Goals for this piece' }).querySelectorAll('.coin-icon')).toHaveLength(2);
    expect(within(board).queryByRole('button', { name: 'Review a passage' })).not.toBeInTheDocument();
  });

  it('shares its cards evenly between the rows', () => {
    const twelve = Array.from({ length: 12 }, (_, index) => segment(index, 'todo'));
    render(<PassageBoard title="T" model={modelOf(twelve, null)} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Passage board' }).querySelector('.piano-passage-board__cards').style.gridTemplateColumns).toBe('repeat(6, minmax(0, 1fr))');
  });

  it('promises a gem only when one is on offer, and marks a reached goal done', () => {
    const silver = [segment(0, 'silver'), segment(1, 'silver')];
    const { rerender } = render(<PassageBoard title="T" model={modelOf(silver, null)} onClose={vi.fn()} />);
    expect(screen.getByRole('list', { name: 'Goals for this piece' })).toHaveTextContent('2/20/2');
    expect(screen.getByRole('listitem', { name: 'All Silver: done' })).toHaveAttribute('data-reached', 'true');
    expect(screen.queryByText(/gem/)).not.toBeInTheDocument();
    rerender(<PassageBoard title="T" model={modelOf(silver, null)} gemOffered onClose={vi.fn()} />);
    expect(screen.getByRole('list', { name: 'Goals for this piece' })).toHaveTextContent('2/20/2earn a gem');
  });

  it('shows the piece\'s Polish gem beside the counters, and the diamond in its place once earned', () => {
    const gold = [segment(0, 'gold'), segment(1, 'gold')];
    const { rerender } = render(<PassageBoard title="T" model={modelOf(gold, null)} onClose={vi.fn()} />);
    const goals = () => screen.getByRole('list', { name: 'Goals for this piece' });
    expect(goals().querySelector('[data-level="polish"]')).toBeNull();
    rerender(<PassageBoard title="T" model={modelOf(gold, null)} polish={{ gem: false, diamond: false }} onClose={vi.fn()} />);
    expect(goals().querySelector('[data-level="polish"]')).toBeNull();
    rerender(<PassageBoard title="T" model={modelOf(gold, null)} polish={{ gem: true, diamond: false }} onClose={vi.fn()} />);
    const gem = within(goals()).getByRole('listitem', { name: 'Polish gem: earned' });
    expect(gem).toHaveAttribute('data-stone', 'gem');
    expect(gem.querySelector('svg.gem-icon')).not.toBeNull();
    expect(goals().lastElementChild).toBe(gem);
    rerender(<PassageBoard title="T" model={modelOf(gold, null)} polish={{ gem: true, diamond: true }} onClose={vi.fn()} />);
    expect(within(goals()).getByRole('listitem', { name: 'Polish diamond: earned' })).toHaveAttribute('data-stone', 'diamond');
    expect(goals().querySelectorAll('[data-level="polish"]')).toHaveLength(1);
  });

  it('selects from a card, reviews, and closes only by its control or Escape', () => {
    const onSelect = vi.fn(); const onClose = vi.fn(); const onReview = vi.fn();
    render(<PassageBoard title="T" model={modelOf(four, 'p2')} review onReview={onReview} onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bars 13–16, Not started' }));
    expect(onSelect).toHaveBeenCalledWith('p3');
    fireEvent.click(screen.getByRole('button', { name: 'Review a passage' }));
    expect(onReview).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('usePieceGemOffer', () => {
  const board = { mode: 'live', learners: [{ learnerId: 'kid' }], categories: [{ id: 'piano', parts: [{ ruleId: 'piano-piece', activity: 'piano-piece' }] }],
    cells: { piano: { kid: { state: 'none', parts: [{ ruleId: 'piano-piece', state: 'none' }] } } } };
  it('asks once the board opens and fails closed', async () => {
    api.call.mockResolvedValueOnce(board);
    const hook = renderHook((props) => usePieceGemOffer(props), { initialProps: { userId: 'kid', enabled: false } });
    expect(api.call).not.toHaveBeenCalled();
    hook.rerender({ userId: 'kid', enabled: true });
    await act(async () => {});
    expect(api.call).toHaveBeenCalledWith('api/v1/earnings/gems');
    expect(hook.result.current).toBe(true);
    api.call.mockRejectedValueOnce(new Error('down'));
    hook.rerender({ userId: 'other', enabled: true });
    expect(hook.result.current).toBe(false);
    await act(async () => {});
    expect(hook.result.current).toBe(false);
    hook.rerender({ userId: 'guest', enabled: true });
    expect(api.call).toHaveBeenCalledTimes(2);
  });
});
