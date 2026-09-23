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
});
