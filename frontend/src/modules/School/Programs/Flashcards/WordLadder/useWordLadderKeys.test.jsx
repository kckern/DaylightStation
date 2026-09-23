import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWordLadderKeys } from './useWordLadderKeys.js';

function Harness({ map, enabled = true }) {
  useWordLadderKeys(map, { enabled });
  return <input aria-label="field" />;
}

describe('useWordLadderKeys', () => {
  it('matches letters by physical key: H on a Korean layout reports key ㅗ', () => {
    const h = vi.fn();
    render(<Harness map={{ h }} />);
    fireEvent.keyDown(window, { key: 'ㅗ', code: 'KeyH' });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('matches U and Q by code as well', () => {
    const u = vi.fn(); const q = vi.fn();
    render(<Harness map={{ u, q }} />);
    fireEvent.keyDown(window, { key: 'ㅕ', code: 'KeyU' });
    fireEvent.keyDown(window, { key: 'ㅂ', code: 'KeyQ' });
    expect(u).toHaveBeenCalledTimes(1);
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('matches digits, Space, Enter and NumpadEnter by code', () => {
    const map = { 0: vi.fn(), 4: vi.fn(), ' ': vi.fn(), enter: vi.fn() };
    render(<Harness map={map} />);
    fireEvent.keyDown(window, { key: '0', code: 'Digit0' });
    fireEvent.keyDown(window, { key: '$', code: 'Digit4' });
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter', code: 'NumpadEnter' });
    expect(map[0]).toHaveBeenCalledTimes(1);
    expect(map[4]).toHaveBeenCalledTimes(1);
    expect(map[' ']).toHaveBeenCalledTimes(1);
    expect(map.enter).toHaveBeenCalledTimes(2);
  });

  it('falls back to key when there is no code', () => {
    const h = vi.fn();
    render(<Harness map={{ h }} />);
    fireEvent.keyDown(window, { key: 'H' });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('ignores keys typed into a field', () => {
    const h = vi.fn();
    const { getByLabelText } = render(<Harness map={{ h }} />);
    fireEvent.keyDown(getByLabelText('field'), { key: 'ㅗ', code: 'KeyH' });
    expect(h).not.toHaveBeenCalled();
  });

  it('matches Tab, Backslash and ArrowLeft by code, preventing the default (focus never moves)', () => {
    const map = { tab: vi.fn(), '\\': vi.fn(), arrowleft: vi.fn() };
    render(<Harness map={map} />);
    expect(fireEvent.keyDown(window, { key: 'Tab', code: 'Tab' })).toBe(false);
    // A Korean or other layout may report something else for the backslash key: code wins.
    fireEvent.keyDown(window, { key: '₩', code: 'Backslash' });
    fireEvent.keyDown(window, { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(map.tab).toHaveBeenCalledTimes(1);
    expect(map['\\']).toHaveBeenCalledTimes(1);
    expect(map.arrowleft).toHaveBeenCalledTimes(1);
  });

  it('Tab still reaches the map from inside a typing field; nothing else does', () => {
    const map = { tab: vi.fn(), '\\': vi.fn(), ' ': vi.fn() };
    const { getByLabelText } = render(<Harness map={map} />);
    const field = getByLabelText('field');
    expect(fireEvent.keyDown(field, { key: 'Tab', code: 'Tab' })).toBe(false);
    fireEvent.keyDown(field, { key: '\\', code: 'Backslash' });
    fireEvent.keyDown(field, { key: ' ', code: 'Space' });
    expect(map.tab).toHaveBeenCalledTimes(1);
    expect(map['\\']).not.toHaveBeenCalled();
    expect(map[' ']).not.toHaveBeenCalled();
  });

  it('leaves Tab alone when the map has no hear-it action (the browser keeps it)', () => {
    render(<Harness map={{ ' ': vi.fn() }} />);
    expect(fireEvent.keyDown(window, { key: 'Tab', code: 'Tab' })).toBe(true);
  });

  it('ignores Ctrl/Alt/Meta chords, Tab included', () => {
    const tab = vi.fn();
    render(<Harness map={{ tab }} />);
    fireEvent.keyDown(window, { key: 'Tab', code: 'Tab', altKey: true });
    fireEvent.keyDown(window, { key: 'Tab', code: 'Tab', ctrlKey: true });
    expect(tab).not.toHaveBeenCalled();
  });
});

describe('useWordLadderKeys — records the key it acted on (spec §8 input)', () => {
  it('a mapped key is noted as key:<Name> before its action runs', async () => {
    const { currentInput, resetInput } = await import('./inputVia.js');
    resetInput();
    let seen = null;
    render(<Harness map={{ '\\': () => { seen = currentInput(); } }} />);
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash' });
    expect(seen).toBe('key:Backslash');
  });

  it('an unmapped key is not noted', async () => {
    const { currentInput, resetInput } = await import('./inputVia.js');
    resetInput();
    render(<Harness map={{ h: () => {} }} />);
    fireEvent.keyDown(window, { key: 'q', code: 'KeyQ' });
    expect(currentInput()).toBeNull();
  });
});
