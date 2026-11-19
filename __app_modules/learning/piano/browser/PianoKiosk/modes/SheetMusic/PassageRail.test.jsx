import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: () => logger };
  return { default: () => logger, getLogger: () => logger };
});
const chime = vi.hoisted(() => ({ play: vi.fn(() => true) }));
vi.mock('./passageChime.js', () => ({ playPassageChime: chime.play, default: chime.play }));
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: api.call }));

import PassageRail from './PassageRail.jsx';
import PassageBoard from './PassageBoard.jsx';
import usePassageCelebration from './usePassageCelebration.js';
import usePieceGemOffer from './usePieceGemOffer.js';
import { railModel } from './passageRail.js';

const segment = (index, state, done = 0) => ({ id: `p${index}`, inMeasure: index * 4, outMeasure: index * 4 + 3, barLabel: `Bars ${index * 4 + 1}–${index * 4 + 4}`,
  printedMeasures: [index * 4 + 1, index * 4 + 4],
  certification: { silver: state === 'silver' || state === 'gold' ? { at: 'x' } : null, gold: state === 'gold' ? { at: 'x' } : null },
  skills: Array.from({ length: 4 }, (_, step) => ({ track: 'silver', ready: state === 'silver' || state === 'gold' || step < done, successes: 0 })) });
const projectionOf = (segments, recommended) => ({ segments, recommended: recommended ? { passageId: recommended } : null,
  piece: { total: segments.length, silver: segments.filter((item) => item.certification.silver).length, gold: segments.filter((item) => item.certification.gold).length,
    nextGoldPassageId: segments.find((item) => !item.certification.gold)?.id ?? null } });
const modelOf = (segments, recommended, selectedId = null) => railModel({ segments, projection: projectionOf(segments, recommended), selectedId });
const widthOf = (px) => vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(px);
afterEach(() => { vi.restoreAllMocks(); chime.play.mockClear(); api.call.mockReset(); });

describe('PassageRail', () => {
  const four = [segment(0, 'gold'), segment(1, 'silver'), segment(2, 'learning', 2), segment(3, 'todo')];

  it('shows every passage by starting bar with its state, and never the word Segment', () => {
    widthOf(900);
    render(<PassageRail model={modelOf(four, 'p2')} />);
    const rail = screen.getByRole('navigation', { name: 'Passages in this piece' });
    const tiles = within(rail).getAllByRole('listitem').map((item) => within(item).getByRole('button'));
    expect(tiles.map((tile) => [tile.textContent, tile.dataset.state])).toEqual([['1gold', 'gold'], ['5silver', 'silver'], ['9', 'learning'], ['13', 'todo']]);
    expect(tiles[2].querySelectorAll('i[data-done="true"]')).toHaveLength(2);
    expect(tiles[2].querySelectorAll('i')).toHaveLength(4);
    expect(tiles[2]).toHaveAttribute('aria-current', 'step');
    expect(rail.textContent).not.toMatch(/Segment/);
    expect(screen.getByRole('button', { name: 'Practice bars 9–12' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 of 4 Silver. Open the passage board' })).toHaveTextContent('2/4');
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

  it('flips the tiles that were just earned and shows the whole-piece moment', () => {
    widthOf(900);
    const done = [segment(0, 'silver'), segment(1, 'silver')];
    const onDismissPiece = vi.fn();
    render(<PassageRail model={modelOf(done, null)} flips={{ p0: 'silver', p1: 'silver' }} piece="silver" onDismissPiece={onDismissPiece} />);
    expect(screen.getByRole('button', { name: 'Bars 1–4, Silver' })).toHaveAttribute('data-flip', 'silver');
    expect(screen.getByRole('status')).toHaveTextContent('Your whole piece is Silver!');
    expect(screen.getByRole('button', { name: 'Go for Gold: bars 1–4' })).toHaveAttribute('data-kind', 'gold');
    fireEvent.click(screen.getByRole('status'));
    expect(onDismissPiece).toHaveBeenCalled();
  });

  it('carries state without opacity and never uses the coin icon', () => {
    const source = readFileSync(resolve(__dirname, 'PassageRail.scss'), 'utf8');
    expect(source).not.toMatch(/opacity\s*:/);
    expect(source).not.toMatch(/transparent|rgba\(|filter\s*:/);
    for (const file of ['PassageRail.jsx', 'PassageBoard.jsx']) expect(readFileSync(resolve(__dirname, file), 'utf8')).not.toMatch(/CoinIcon/);
  });
});

describe('PassageBoard', () => {
  const four = [segment(0, 'gold'), segment(1, 'silver'), segment(2, 'learning', 2), segment(3, 'todo')];
  it('lists every passage with its bars and progress, the count and both goals', () => {
    render(<PassageBoard title="Minuet in G" model={modelOf(four, 'p2')} gemOffered onClose={vi.fn()} />);
    const board = screen.getByRole('dialog', { name: 'Passage board' });
    expect(within(board).getByRole('heading', { name: 'Minuet in G' })).toBeInTheDocument();
    expect(within(board).getByText('2 of 4 Silver, 1 Gold')).toBeInTheDocument();
    expect(within(board).getByRole('list', { name: 'Goals for this piece' })).toHaveTextContent('All Silver: earn a gemAll Gold: earn a gem');
    expect(within(board).getByRole('button', { name: 'Bars 9–12, Learning, 2 of 4 steps' })).toHaveTextContent('Bars 9–122 of 4 steps');
    expect(within(board).getByRole('button', { name: 'Bars 9–12, Learning, 2 of 4 steps' })).toHaveAttribute('aria-current', 'step');
    expect(within(board).getByRole('button', { name: 'Bars 1–4, Gold' })).toHaveAttribute('data-state', 'gold');
    expect(within(board).queryByRole('button', { name: 'Review a passage' })).not.toBeInTheDocument();
  });

  it('promises a gem only when one is on offer, and marks a reached goal done', () => {
    const silver = [segment(0, 'silver'), segment(1, 'silver')];
    const { rerender } = render(<PassageBoard title="T" model={modelOf(silver, null)} onClose={vi.fn()} />);
    expect(screen.getByRole('list', { name: 'Goals for this piece' })).toHaveTextContent('All Silver: doneAll Gold');
    expect(screen.queryByText(/gem/)).not.toBeInTheDocument();
    rerender(<PassageBoard title="T" model={modelOf(silver, null)} gemOffered onClose={vi.fn()} />);
    expect(screen.getByRole('list', { name: 'Goals for this piece' })).toHaveTextContent('All Silver: doneAll Gold: earn a gem');
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

describe('usePassageCelebration', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const none = projectionOf([segment(0, 'todo'), segment(1, 'silver')]);
  const all = projectionOf([segment(0, 'silver'), segment(1, 'silver')]);
  const run = (props) => renderHook((current) => usePassageCelebration(current), { initialProps: { scopeKey: 'kid:score:f', ready: true, visible: true, scoreId: 'score', ...props } });

  it('celebrates nothing for a piece that is already finished when it loads', () => {
    const hook = run({ ready: false, projection: projectionOf([]), evidenceId: null });
    hook.rerender({ scopeKey: 'kid:score:f', ready: true, visible: true, projection: all, evidenceId: 'old' });
    expect(hook.result.current).toMatchObject({ flips: {}, piece: null });
    expect(chime.play).not.toHaveBeenCalled();
  });

  it('waits for the rail, then flips the passage and celebrates the piece once', () => {
    const hook = run({ projection: none, evidenceId: 'a' });
    hook.rerender({ scopeKey: 'kid:score:f', ready: true, visible: false, projection: all, evidenceId: 'b' });
    expect(hook.result.current.piece).toBeNull();
    hook.rerender({ scopeKey: 'kid:score:f', ready: true, visible: true, projection: all, evidenceId: 'b' });
    expect(hook.result.current).toMatchObject({ flips: { p0: 'silver', p1: 'silver' }, piece: 'silver' });
    expect(chime.play).toHaveBeenCalledWith({ level: 'silver', piece: true });
    act(() => { vi.advanceTimersByTime(8000); });
    expect(hook.result.current).toMatchObject({ flips: {}, piece: null });
    hook.rerender({ scopeKey: 'kid:score:f', ready: true, visible: true, projection: { ...all }, evidenceId: 'c' });
    expect(hook.result.current.piece).toBeNull();
    expect(chime.play).toHaveBeenCalledTimes(1);
  });

  it('flips one passage without the whole-piece moment', () => {
    const before = projectionOf([segment(0, 'todo'), segment(1, 'todo'), segment(2, 'todo')]);
    const after = projectionOf([segment(0, 'silver'), segment(1, 'todo'), segment(2, 'todo')]);
    const hook = run({ projection: before, evidenceId: null });
    hook.rerender({ scopeKey: 'kid:score:f', ready: true, visible: true, projection: after, evidenceId: 'a' });
    expect(hook.result.current).toMatchObject({ flips: { p0: 'silver' }, piece: null });
    expect(chime.play).toHaveBeenCalledWith({ level: 'silver', piece: false });
  });

  it('ignores a change with no new take, and another player or score', () => {
    const hook = run({ projection: none, evidenceId: 'a' });
    hook.rerender({ scopeKey: 'kid:score:f', ready: true, visible: true, projection: all, evidenceId: 'a' }); // legacy credit arrived late
    expect(hook.result.current.piece).toBeNull();
    hook.rerender({ scopeKey: 'other:score:f', ready: true, visible: true, projection: none, evidenceId: 'z' });
    hook.rerender({ scopeKey: 'kid:score:f', ready: true, visible: true, projection: all, evidenceId: 'b' });
    expect(hook.result.current).toMatchObject({ flips: {}, piece: null });
    expect(chime.play).not.toHaveBeenCalled();
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
