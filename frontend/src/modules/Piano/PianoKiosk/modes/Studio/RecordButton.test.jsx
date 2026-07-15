import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Stub the icon so the stop glyph is identifiable without pulling in real assets.
vi.mock('../../icons/Icon.jsx', () => ({
  default: ({ name }) => <span data-testid="icon" data-name={name} />,
}));

import RecordButton from './RecordButton.jsx';

describe('RecordButton', () => {
  it('idle: shows "Record", not recording, aria-pressed=false, no stop glyph', () => {
    const { container, getByText, queryByTestId } = render(
      <RecordButton recording={false} elapsedMs={0} onToggle={vi.fn()} />,
    );
    const btn = container.querySelector('.piano-studio__record');
    expect(btn).toBeTruthy();
    expect(btn.classList.contains('is-recording')).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(getByText('Record')).toBeTruthy();
    expect(queryByTestId('icon')).toBeNull();
  });

  it('recording: shows the MM:SS timer, is-recording, aria-pressed=true, stop glyph', () => {
    const { container, getByText, getByTestId } = render(
      <RecordButton recording={true} elapsedMs={65000} onToggle={vi.fn()} />,
    );
    const btn = container.querySelector('.piano-studio__record');
    expect(btn.classList.contains('is-recording')).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(getByText('1:05')).toBeTruthy();
    expect(getByTestId('icon').getAttribute('data-name')).toBe('stop');
  });

  it('clicking calls onToggle', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <RecordButton recording={false} elapsedMs={0} onToggle={onToggle} />,
    );
    fireEvent.click(container.querySelector('.piano-studio__record'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
