import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useReviewKeys } from './useReviewKeys.js';

const handlers = () => ({ next: vi.fn(), prev: vi.fn(), replay: vi.fn(), verdict: vi.fn(), undo: vi.fn(), cycleKind: vi.fn(), effect: vi.fn(), widen: vi.fn(), help: vi.fn(), escape: vi.fn(() => false) });
function Host({ h }) {
  const { redoOpen } = useReviewKeys(h);
  return (<div><input data-testid="text" /><input type="radio" data-testid="radio" /><video data-testid="video" tabIndex={0} />{redoOpen ? <span>redo-open</span> : null}</div>);
}
const press = (key, init = {}, target = document.body) => fireEvent.keyDown(target, { key, ...init });
afterEach(() => { document.body.innerHTML = ''; });

describe('useReviewKeys', () => {
  it('maps the keymap to handlers', () => {
    const h = handlers(); render(<Host h={h} />);
    press('ArrowRight'); press('Tab'); expect(h.next).toHaveBeenCalledTimes(2);
    press('ArrowLeft'); press('Tab', { shiftKey: true }); expect(h.prev).toHaveBeenCalledTimes(2);
    press(' '); expect(h.replay).toHaveBeenCalled();
    press('a'); press('r'); press('i');
    expect(h.verdict.mock.calls.map((c) => c[0])).toEqual(['approve', 'remove', 'ignore']);
    press('u'); expect(h.undo).toHaveBeenCalled();
    press('f'); expect(h.cycleKind).toHaveBeenCalled();
    press('m'); press('p'); press('b'); press('k');
    expect(h.effect.mock.calls.map((c) => c[0])).toEqual(['m', 'p', 'b', 'k']);
    press('w'); expect(h.widen).toHaveBeenCalled();
    press('?', { shiftKey: true }); expect(h.help).toHaveBeenCalled();
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
    for (const k of ['a', 'r', 'w', 'm', 'ArrowRight', ' ']) press(k);
    expect(h.verdict).not.toHaveBeenCalled(); expect(h.widen).not.toHaveBeenCalled(); expect(h.effect).not.toHaveBeenCalled();
    expect(h.next).not.toHaveBeenCalled(); expect(h.replay).not.toHaveBeenCalled();
    press('?', { shiftKey: true }); expect(h.help).toHaveBeenCalled();
  });
});
