import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useReviewKeys } from './useReviewKeys.js';

const handlers = () => ({ next: vi.fn(), prev: vi.fn(), replay: vi.fn(), togglePlay: vi.fn(), playWithout: vi.fn(), refine: vi.fn(), refineAll: vi.fn(), rework: vi.fn(), bleepLevel: vi.fn(), verdict: vi.fn(), undo: vi.fn(), effect: vi.fn(), help: vi.fn(), escape: vi.fn(() => false) });
function Host({ h }) {
  const { redoOpen } = useReviewKeys(h);
  return (<div><input data-testid="text" /><input type="radio" data-testid="radio" /><video data-testid="video" tabIndex={0} />{redoOpen ? <span>redo-open</span> : null}</div>);
}
const press = (key, init = {}, target = document.body) => fireEvent.keyDown(target, { key, ...init });
afterEach(() => { document.body.innerHTML = ''; });

describe('useReviewKeys', () => {
  it('maps the keymap to handlers (design cf-journey, 2026-11-21)', () => {
    const h = handlers(); render(<Host h={h} />);
    press('ArrowRight'); expect(h.next).toHaveBeenCalledTimes(1);
    press('ArrowLeft'); expect(h.prev).toHaveBeenCalledTimes(1);
    press('Tab'); press('Tab', { shiftKey: true });
    expect(h.next).toHaveBeenCalledTimes(1); expect(h.prev).toHaveBeenCalledTimes(1); // Tab is the browser's again
    press(' '); expect(h.togglePlay).toHaveBeenCalledTimes(1); expect(h.replay).not.toHaveBeenCalled();
    press('Enter'); expect(h.replay).toHaveBeenCalledTimes(1);
    press('w'); expect(h.playWithout).toHaveBeenCalledTimes(1);
    press('a'); press('x');
    expect(h.verdict.mock.calls.map((c) => c[0])).toEqual(['approve', 'remove']);
    press('i'); press('f'); expect(h.verdict).toHaveBeenCalledTimes(2);
    press('r'); expect(h.refine).toHaveBeenCalledTimes(1);
    press('R', { shiftKey: true }); expect(h.refineAll).toHaveBeenCalledTimes(1); expect(h.refine).toHaveBeenCalledTimes(1);
    press('u'); expect(h.undo).toHaveBeenCalled();
    press('m'); press('p'); press('b'); press('k'); press('o');
    expect(h.effect.mock.calls.map((c) => c[0])).toEqual(['m', 'p', 'b', 'k', 'o']);
    press('['); press(']'); expect(h.bleepLevel.mock.calls.map((c) => c[0])).toEqual([-0.05, 0.05]);
    press('D', { shiftKey: true }); expect(h.rework).toHaveBeenCalledTimes(1);
    press('?', { shiftKey: true }); expect(h.help).toHaveBeenCalled();
  });
  it('Space is play/pause even with a button focused, and blurs the button (no page outline)', () => {
    const h = handlers();
    render(<><Host h={h} /><button type="button" data-testid="btn">b</button></>);
    const btn = screen.getByTestId('btn'); btn.focus();
    const notPrevented = fireEvent.keyDown(btn, { key: ' ' });
    expect(notPrevented).toBe(false);
    expect(h.togglePlay).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(btn);
  });
  it('a focused button keeps Enter for itself', () => {
    const h = handlers();
    render(<><Host h={h} /><button type="button" data-testid="btn">b</button></>);
    screen.getByTestId('btn').focus();
    expect(fireEvent.keyDown(screen.getByTestId('btn'), { key: 'Enter' })).toBe(true);
    expect(h.replay).not.toHaveBeenCalled();
  });
  it('D opens the reason picker: 1-4 pick a reason, Enter none, Escape cancels', () => {
    const h = handlers(); render(<Host h={h} />);
    press('d'); expect(screen.getByText('redo-open')).toBeTruthy();
    press('3'); expect(h.verdict).toHaveBeenLastCalledWith('redo', 'action');
    expect(screen.queryByText('redo-open')).toBeNull();
    press('d'); press('Enter'); expect(h.verdict).toHaveBeenLastCalledWith('redo', undefined);
    press('d'); press('Escape'); expect(screen.queryByText('redo-open')).toBeNull();
    expect(h.verdict).toHaveBeenCalledTimes(2);
    press('d'); press('1'); press('d'); press('2'); press('d'); press('4');
    expect(h.verdict.mock.calls.slice(2).map((c) => c[1])).toEqual(['edges', 'category', 'timing']);
  });
  it('keys still drive review when the video element has focus (Review Focus 1)', () => {
    const h = handlers(); render(<Host h={h} />);
    const video = screen.getByTestId('video'); video.focus();
    expect(document.activeElement).toBe(video);
    const notPrevented = fireEvent.keyDown(video, { key: 'a' });
    expect(h.verdict).toHaveBeenCalledWith('approve', undefined);
    expect(notPrevented).toBe(false); // default prevented: the video does not also react
    fireEvent.keyDown(video, { key: 'ArrowRight' }); expect(h.next).toHaveBeenCalled();
  });
  it('does not fire inside a text input, but does with a radio focused', () => {
    const h = handlers(); render(<Host h={h} />);
    screen.getByTestId('text').focus(); press('a', {}, screen.getByTestId('text'));
    expect(h.verdict).not.toHaveBeenCalled();
    screen.getByTestId('radio').focus(); press('a', {}, screen.getByTestId('radio'));
    expect(h.verdict).toHaveBeenCalledTimes(1);
  });
  it('ignores held-key repeats for verdicts and modified keys', () => {
    const h = handlers(); render(<Host h={h} />);
    press('a', { repeat: true }); press('a', { ctrlKey: true }); press('a', { metaKey: true });
    expect(h.verdict).not.toHaveBeenCalled();
    press('ArrowRight', { repeat: true }); expect(h.next).toHaveBeenCalled();
  });
  it('has a named no-op hook for the bleep level keys', () => {
    const h = handlers(); render(<Host h={h} />);
    expect(() => { press('['); press(']'); }).not.toThrow();
    document.body.innerHTML = '';
    const lvl = vi.fn(); render(<Host h={{ ...handlers(), bleepLevel: lvl }} />);
    press(']'); press('['); expect(lvl.mock.calls.map((c) => c[0])).toEqual([0.05, -0.05]);
  });
  it('while the help sheet is open, verdict and action keys do nothing; ? still closes it', () => {
    const h = { ...handlers(), helpOpen: true };
    render(<Host h={h} />);
    for (const k of ['a', 'x', 'r', 'w', 'm', 'ArrowRight', ' ', 'Enter']) press(k);
    expect(h.verdict).not.toHaveBeenCalled(); expect(h.refine).not.toHaveBeenCalled(); expect(h.playWithout).not.toHaveBeenCalled(); expect(h.effect).not.toHaveBeenCalled();
    expect(h.next).not.toHaveBeenCalled(); expect(h.replay).not.toHaveBeenCalled(); expect(h.togglePlay).not.toHaveBeenCalled();
    press('?', { shiftKey: true }); expect(h.escape).toHaveBeenCalled();
  });
});
