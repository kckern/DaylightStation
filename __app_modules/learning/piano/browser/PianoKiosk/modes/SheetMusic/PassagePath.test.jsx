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

import PassagePath from './PassagePath.jsx';
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
const tokensOf = () => within(screen.getByRole('navigation', { name: 'Passages in this piece' })).getAllByRole('listitem').filter((item) => item.closest('ol'))
  .map((item) => within(item).getByRole('button'));
afterEach(() => { vi.restoreAllMocks(); api.call.mockReset(); });

describe('PassagePath', () => {
  const four = [segment(0, 'gold'), segment(1, 'silver'), segment(2, 'learning', 2), segment(3, 'todo')];

  it('draws every passage as a lettered token in its state, names the task, and shows the goal', () => {
    widthOf(900);
    render(<PassagePath model={modelOf(four, 'p2')} />);
    const tokens = tokensOf();
    expect(tokens.map((token) => [token.textContent, token.dataset.state])).toEqual([['A', 'gold'], ['B', 'silver'], ['Cbars 9–12', 'learning'], ['D', 'todo']]);
    // No tomato on the path: a plain disc is a passage not started; Bronze is the bronze coin.
    expect(tokens.map((token) => token.querySelector('svg.piano-letter-coin').dataset.state)).toEqual(['gold', 'silver', 'learning', 'todo']);
    expect(screen.getByRole('navigation').querySelector('.tomato-icon')).toBeNull();
    expect(tokens[2]).toHaveAttribute('aria-current', 'step');
    expect(tokens[2]).toHaveAttribute('data-next', 'true');
    expect(tokens[2].querySelector('.piano-passage-path__play')).not.toBeNull();
    expect(tokens[2]).toHaveAccessibleName('Learn C, bars 9–12');
    expect(screen.getByText('Learn C')).toBeInTheDocument();
    // The goal is one level ladder: the Bronze lap and its count, the later levels to come.
    expect(screen.getByRole('group', { name: 'Levels for this piece: Bronze · 2 of 4' })).toHaveTextContent('Bronze · 2 of 4');
    expect([...document.querySelectorAll('.piano-level-ladder__rungs li')].map((item) => item.dataset.state)).toEqual(['current', 'later', 'later']);
    expect(screen.queryByRole('button', { name: /^Practice/ })).toBeNull();
  });

  it('selects on a tap, opens on a tap of the selected or the next token, and All opens the board', () => {
    widthOf(900);
    const onSelect = vi.fn(); const onOpen = vi.fn(); const onOpenBoard = vi.fn();
    const { rerender } = render(<PassagePath model={modelOf(four, 'p2')} onSelect={onSelect} onOpen={onOpen} onOpenBoard={onOpenBoard} />);
    fireEvent.click(screen.getByRole('button', { name: 'D, bars 13–16, Not started' }));
    expect(onSelect).toHaveBeenCalledWith('p3');
    expect(onOpen).not.toHaveBeenCalled();
    // The host selects it: the play disc moves to D, and D's next tap opens it.
    rerender(<PassagePath model={modelOf(four, 'p2', 'p3')} onSelect={onSelect} onOpen={onOpen} onOpenBoard={onOpenBoard} />);
    const selected = screen.getByRole('button', { name: 'Learn D, bars 13–16' });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(selected.querySelector('.piano-passage-path__play')).not.toBeNull();
    fireEvent.click(selected);
    expect(onOpen).toHaveBeenLastCalledWith('p3');
    // The next token still opens on one tap, and stays the larger one.
    fireEvent.click(screen.getByRole('button', { name: 'C, bars 9–12, Partway, 2 of 4 steps' }));
    expect(onOpen).toHaveBeenLastCalledWith('p2');
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /^All passages/ }));
    expect(onOpenBoard).toHaveBeenCalledWith(null);
  });

  it('shows the next join as a socket between its halves, and an earned join as one silver coin', () => {
    widthOf(900);
    const a = segment(0, 'silver'); const b = segment(1, 'silver'); const c = segment(2, 'todo');
    const join = { id: 'join:p0:p1', kind: 'join', final: false, inMeasure: 0, outMeasure: 7, barLabel: 'Bars 1–8', members: ['p0', 'p1'], memberPassages: ['p0', 'p1'],
      certification: { silver: null, gold: null }, skills: [] };
    const onOpen = vi.fn();
    const { rerender } = render(<PassagePath model={railModel({ segments: [a, b, join, c], projection: projectionOf([a, b, join, c], 'join:p0:p1') })} onOpen={onOpen} />);
    expect(tokensOf().map((token) => token.dataset.kind)).toEqual(['passage', 'socket', 'passage', 'passage']);
    fireEvent.click(screen.getByRole('button', { name: 'Play A and B together, bars 1–8' }));
    expect(onOpen).toHaveBeenCalledWith('join:p0:p1');
    expect(screen.getByText('Play A and B together')).toBeInTheDocument();
    const earned = { ...join, certification: { silver: { at: 'x' }, gold: null } };
    rerender(<PassagePath model={railModel({ segments: [a, b, earned, c], projection: projectionOf([a, b, earned, c], 'p2') })} onOpen={onOpen} />);
    expect(tokensOf().map((token) => token.textContent.replace(/bars.*/, ''))).toEqual(['A–B', 'C']);
    expect(screen.getByRole('button', { name: 'A–B, bars 1–8, Silver' }).querySelector('svg').dataset.state).toBe('joined');
  });

  it('turns a long piece into a lettered strip whose taps open the board at that passage', () => {
    widthOf(840);
    const long = Array.from({ length: 24 }, (_, index) => segment(index, index < 3 ? 'silver' : 'todo'));
    const onSelect = vi.fn(); const onOpenBoard = vi.fn();
    render(<PassagePath model={modelOf(long, 'p3')} onSelect={onSelect} onOpenBoard={onOpenBoard} />);
    const list = screen.getByRole('navigation').querySelector('ol');
    expect(list).toHaveAttribute('data-compact', 'true');
    expect(within(list).getAllByRole('button')).toHaveLength(24);
    expect(within(list).getAllByRole('button').map((button) => button.textContent).slice(0, 3)).toEqual(['A', 'B', 'C']);
    fireEvent.click(screen.getByRole('button', { name: 'J, bars 37–40, Not started. Open the passage board' }));
    expect(onOpenBoard).toHaveBeenCalledWith('p9');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('turns the tokens that were just earned, held until the ceremony announces them', () => {
    widthOf(900);
    const done = [segment(0, 'silver'), segment(1, 'todo')];
    render(<PassagePath model={modelOf(done, 'p1')} flips={{ p0: 'silver' }} flipDelayMs={1200} />);
    const earned = screen.getByRole('button', { name: 'A, bars 1–4, Bronze' });
    expect(earned).toHaveAttribute('data-flip', 'silver');
    expect(earned.style.getPropertyValue('--turn-delay')).toBe('1200ms');
    const turn = earned.querySelector('.piano-passage-turn');
    expect([...turn.children].map((icon) => icon.dataset.state)).toEqual(['learning', 'silver']);
    expect(screen.getByRole('button', { name: 'Learn B, bars 5–8' }).querySelector('.piano-passage-turn')).toBeNull();
  });

  it('turns a finished piece as a wave, with no banner and no sentence', () => {
    widthOf(900);
    const done = [segment(0, 'gold'), segment(1, 'gold'), segment(2, 'gold')];
    render(<PassagePath model={modelOf(done, null)} flips={{ p0: 'gold', p1: 'gold', p2: 'gold' }} flipDelayMs={1000} wave />);
    const delays = tokensOf().map((token) => parseInt(token.style.getPropertyValue('--turn-delay'), 10));
    expect(delays).toEqual([1000, 1045, 1090]);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/whole piece/i)).toBeNull();
  });

  it('passes the tomato to the passages not yet started, and only to them; none without a learner', () => {
    const { container, unmount } = render(<PassagePath model={modelOf(four, 'p2')} tomatoes />);
    const tomatoes = [...container.querySelectorAll('.piano-letter-coin__tomato')];
    expect(tomatoes).toHaveLength(1);
    expect(tomatoes[0].closest('.piano-letter-coin').getAttribute('data-state')).toBe('todo');
    unmount();
    expect(render(<PassagePath model={modelOf(four, 'p2')} />).container.querySelector('.piano-letter-coin__tomato')).toBeNull();
  });

  it('writes the turn delay into the animation itself, so a later rule cannot reset it', () => {
    const source = readFileSync(resolve(__dirname, 'PassageCoin.scss'), 'utf8');
    expect(source.match(/animation: piano-passage-turn-(out|in) [^;]*var\(--turn-delay, 0ms\)[^;]*;/g)).toHaveLength(2);
    expect(source).not.toMatch(/animation-delay/);
  });

  it('carries state without opacity, and draws it with the one passage mark', () => {
    for (const file of ['PassagePath.scss', 'PassageCoin.scss']) {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      expect(source).not.toMatch(/opacity\s*:/);
      expect(source).not.toMatch(/transparent|rgba\(|filter\s*:/);
    }
    for (const file of ['PassagePath.jsx', 'PassageBoard.jsx']) expect(readFileSync(resolve(__dirname, file), 'utf8')).toMatch(/PassageCoin/);
  });
});

describe('PassageBoard', () => {
  const four = [segment(0, 'gold'), segment(1, 'silver'), segment(2, 'learning', 2), segment(3, 'todo')];
  it('lists every passage as a lettered card with its bars and progress, the goals, and one next marker', () => {
    render(<PassageBoard title="Minuet in G" model={modelOf(four, 'p2')} gemOffered onClose={vi.fn()} />);
    const board = screen.getByRole('dialog', { name: 'Passage board' });
    expect(within(board).getByRole('heading', { name: 'Minuet in G' })).toBeInTheDocument();
    // One level ladder, the Bronze lap and its count; a Bronze lap pays no gem, so none is promised.
    const ladder = within(board).getByRole('group', { name: 'Levels for this piece: Bronze · 2 of 4' });
    expect(ladder).toHaveTextContent('Bronze · 2 of 4');
    expect(within(board).queryByText(/earn a gem/)).not.toBeInTheDocument();
    const partway = within(board).getByRole('button', { name: 'C, bars 9–12, Partway, 2 of 4 steps' });
    expect(partway).toHaveTextContent('CBars 9–12');
    expect(partway.querySelector('svg.piano-letter-coin[data-state="learning"]')).not.toBeNull();
    expect(partway.querySelectorAll('i[data-done="true"]')).toHaveLength(2);
    expect(partway).toHaveAttribute('aria-current', 'step');
    expect(board.querySelectorAll('.piano-passage-board__play')).toHaveLength(1);
    expect(partway.querySelector('.piano-passage-board__play')).not.toBeNull();
    expect(within(board).getByRole('button', { name: 'A, bars 1–4, Gold' }).querySelector('svg[data-state="gold"]')).not.toBeNull();
    expect(within(board).getByRole('button', { name: 'D, bars 13–16, Not started' }).querySelector('.tomato-icon')).toBeNull();
    expect(within(board).queryByRole('button', { name: 'Review a passage' })).not.toBeInTheDocument();
  });

  it('shows an earned join as a silver card', () => {
    const a = segment(0, 'silver'); const b = segment(1, 'silver');
    const join = { id: 'join:p0:p1', kind: 'join', final: true, inMeasure: 0, outMeasure: 7, barLabel: 'Bars 1–8', members: ['p0', 'p1'], memberPassages: ['p0', 'p1'],
      certification: { silver: { at: 'x' }, gold: null }, skills: [] };
    render(<PassageBoard title="T" model={railModel({ segments: [a, b, join], projection: projectionOf([a, b, join], null) })} onClose={vi.fn()} />);
    const card = screen.getByRole('button', { name: 'A–B, bars 1–8, Silver' });
    expect(card).toHaveAttribute('data-kind', 'join');
    expect(card.querySelector('svg').dataset.state).toBe('joined');
  });

  it('shares its cards evenly between the rows', () => {
    const twelve = Array.from({ length: 12 }, (_, index) => segment(index, 'todo'));
    render(<PassageBoard title="T" model={modelOf(twelve, null)} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Passage board' }).querySelector('.piano-passage-board__cards').style.gridTemplateColumns).toBe('repeat(6, minmax(0, 1fr))');
  });

  it('promises one gem, on the current level, only when one is on offer', () => {
    const silver = [segment(0, 'silver'), segment(1, 'silver')];
    const lap = (segments) => railModel({ segments, projection: { ...projectionOf(segments, null), lap: 'silver', lapProgress: { done: 0, total: 1 },
      piece: { ...projectionOf(segments, null).piece, joins: { total: 1, silver: 0, gold: 0 }, pieceSilver: false } } });
    const { rerender } = render(<PassageBoard title="T" model={lap(silver)} onClose={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Levels for this piece: Silver · 0 of 1' })).toBeInTheDocument();
    expect(screen.queryByText(/gem/)).not.toBeInTheDocument();
    rerender(<PassageBoard title="T" model={lap(silver)} gemOffered onClose={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Levels for this piece: Silver · 0 of 1, earn a gem' })).toBeInTheDocument();
    expect(screen.getAllByText('earn a gem')).toHaveLength(1);
  });

  it('fills the Diamond once it is earned in Polish', () => {
    const gold = [segment(0, 'gold'), segment(1, 'gold')];
    const { rerender } = render(<PassageBoard title="T" model={modelOf(gold, null)} onClose={vi.fn()} />);
    const rungs = () => [...document.querySelectorAll('.piano-level-ladder__rungs li')].map((item) => `${item.dataset.level}:${item.dataset.state}`);
    expect(rungs()).toEqual(['bronze:earned', 'gold:earned', 'diamond:current']);
    expect(document.querySelector('.piano-level-ladder__rungs [data-level="diamond"] .gem-icon')).toBeNull();
    rerender(<PassageBoard title="T" model={railModel({ segments: gold, projection: projectionOf(gold, null), polish: { gem: true, diamond: true } })} onClose={vi.fn()} />);
    expect(rungs()).toEqual(['bronze:earned', 'gold:earned', 'diamond:earned']);
    expect(screen.getByRole('group', { name: 'Levels for this piece: Diamond · earned' })).toBeInTheDocument();
  });

  it('selects from a card, reviews, and closes only by its control or Escape', () => {
    const onSelect = vi.fn(); const onClose = vi.fn(); const onReview = vi.fn();
    render(<PassageBoard title="T" model={modelOf(four, 'p2')} review onReview={onReview} onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'D, bars 13–16, Not started' }));
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
