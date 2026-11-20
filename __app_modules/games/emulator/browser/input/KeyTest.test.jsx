import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { KeyTest } from './KeyTest.jsx';
import { gameKeySet, normalizeKey, padChanges, testVerdict } from './keyTestModel.js';

const KEYMAP = { up: 'ArrowUp', start: 'Enter', select: 'Space', a: 'x' };

describe('keyTestModel', () => {
  it('normalizes keys the way input.yml names them', () => {
    expect([' ', 'X', 'ArrowUp', 'AudioVolumeUp'].map(normalizeKey)).toEqual(['Space', 'x', 'ArrowUp', 'AudioVolumeUp']);
    expect([...gameKeySet(KEYMAP)].sort()).toEqual(['ArrowUp', 'Enter', 'Space', 'x']);
  });
  it('padChanges: first sight is not a press; then button and stick edges', () => {
    const pad = (pressed, x) => ({ index: 0, id: 'Pad', buttons: [{ pressed }], axes: [x] });
    const a = padChanges(null, [pad(true, 0)]);
    expect(a.events).toEqual([]);
    const b = padChanges(a.snapshot, [pad(false, 0)]);
    const c = padChanges(b.snapshot, [pad(true, -0.9)]);
    expect(c.events).toEqual([{ padId: 'Pad', input: 'A' }, { padId: 'Pad', input: 'Stick left' }]);
  });
  it('verdict', () => {
    const keys = gameKeySet(KEYMAP);
    expect(testVerdict({ padInputs: 1, keys: [], gameKeys: keys }).id).toBe('controller');
    expect(testVerdict({ keys: ['AudioVolumeUp', 'x'], gameKeys: keys }).text).toBe('Games can use these keys: X.');
    expect(testVerdict({ keys: ['AudioVolumeUp'], gameKeys: keys }).text).toBe("Games can't use these keys yet.");
    expect(testVerdict({ keys: [], gameKeys: keys }).id).toBe('nothing');
  });
});

describe('KeyTest', () => {
  afterEach(() => vi.useRealTimers());
  const renderTest = (over = {}) => {
    const onDone = vi.fn();
    render(<KeyTest name="R1" kind="keyboard" keyboardMap={KEYMAP} getGamepads={() => []} onDone={onDone} {...over} />);
    return onDone;
  };

  it('shows each key, media keys included, and whether games can use them', () => {
    renderTest();
    expect(screen.getByText('Press a button on R1')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'AudioVolumeUp' });
    expect(screen.getByText('Volume up')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe("Games can't use these keys yet.");
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(screen.getByRole('status').textContent).toBe('Games can use these keys: Up arrow.');
  });

  it('arrows and Enter are shown, not acted on; Escape finishes with the result', () => {
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    const onDone = renderTest();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    window.removeEventListener('keydown', behind);
    expect(behind).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({ keys: ['Enter', 'ArrowDown'], padInputs: 0, verdict: 'game-keys' });
  });

  it('finishes by itself after 20 s with no presses', () => {
    vi.useFakeTimers();
    const onDone = renderTest();
    act(() => { vi.advanceTimersByTime(20000); });
    expect(onDone).toHaveBeenCalledWith({ keys: [], padInputs: 0, verdict: 'nothing' });
  });

  it('holding B for 1.5 s finishes; a pad press counts for a controller', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] });
    let pads = [{ index: 0, id: 'Pad', buttons: [{ pressed: false }, { pressed: false }], axes: [] }];
    const onDone = renderTest({ kind: 'gamepad', getGamepads: () => pads });
    act(() => { vi.advanceTimersByTime(50); });
    pads = [{ ...pads[0], buttons: [{ pressed: true }, { pressed: false }] }];
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByText('A (Pad)')).toBeTruthy();
    pads = [{ ...pads[0], buttons: [{ pressed: false }, { pressed: true }] }];
    act(() => { vi.advanceTimersByTime(1600); });
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'controller' }));
  });

  it('lands focus on Done when it opens, so focus never sits on the page', () => {
    renderTest();
    expect(document.activeElement?.textContent).toBe('Done');
  });

  it('logs nothing raw: a key with no name shows its code', () => {
    renderTest();
    fireEvent.keyDown(document.body, { key: 'Unidentified', code: 'KeyQ' });
    expect(screen.getByText('Key KeyQ')).toBeTruthy();
  });

  it('a held Escape (key repeat) is shown nowhere and does not finish twice; the first Escape finishes', () => {
    const onDone = renderTest();
    fireEvent.keyDown(document.body, { key: 'Escape', repeat: true });
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('holding Enter (or a remote play/pause) for 1.5 s finishes; a short press is only shown', () => {
    vi.useFakeTimers();
    const onDone = renderTest();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.keyUp(document.body, { key: 'Enter' });
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'MediaPlayPause' });
    act(() => { vi.advanceTimersByTime(800); });
    fireEvent.keyDown(document.body, { key: 'MediaPlayPause', repeat: true });
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(800); });
    fireEvent.keyDown(document.body, { key: 'MediaPlayPause', repeat: true });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('holding Start for 1.5 s finishes too', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] });
    let pads = [{ index: 0, id: 'Pad', buttons: Array.from({ length: 10 }, () => ({ pressed: false })), axes: [] }];
    const onDone = renderTest({ kind: 'gamepad', getGamepads: () => pads });
    act(() => { vi.advanceTimersByTime(50); });
    pads = [{ ...pads[0], buttons: pads[0].buttons.map((b, i) => ({ pressed: i === 9 })) }];
    act(() => { vi.advanceTimersByTime(1600); });
    expect(onDone).toHaveBeenCalled();
  });

  it('says how to finish in plain words, with the real idle time; Done is for touch and shows no focus ring', () => {
    renderTest({ idleMs: 30000 });
    expect(screen.getByText('Press Escape, or hold the back or Start button, to finish. It also finishes after 30 seconds with no presses.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' }).className).toContain('bts-test-done');
  });

  it('shows a short pad name', () => {
    expect(padChanges(new Map([['0', { buttons: [false], axes: [] }]]), [{ index: 0, id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', buttons: [{ pressed: true }], axes: [] }]).events)
      .toEqual([{ padId: 'Wireless Controller', input: 'A' }]);
  });
});
