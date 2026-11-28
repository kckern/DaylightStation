import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { useNoSoftKeyboard } from './useNoSoftKeyboard.js';

function Page({ enabled }) {
  useNoSoftKeyboard(enabled);
  return (
    <div>
      <input aria-label="title" />
      <input aria-label="search" type="search" />
      <input aria-label="toggle" type="checkbox" />
      <input aria-label="pin" type="password" data-soft-keyboard="allow" />
      <textarea aria-label="notes" />
    </div>
  );
}

afterEach(cleanup);

describe('useNoSoftKeyboard', () => {
  it('marks every text field inputmode=none on the kiosk', () => {
    const { getByLabelText } = render(<Page enabled />);
    expect(getByLabelText('title').getAttribute('inputmode')).toBe('none');
    expect(getByLabelText('search').getAttribute('inputmode')).toBe('none');
    expect(getByLabelText('notes').getAttribute('inputmode')).toBe('none');
  });

  it('leaves non-text inputs and opted-in fields alone', () => {
    const { getByLabelText } = render(<Page enabled />);
    expect(getByLabelText('toggle').hasAttribute('inputmode')).toBe(false);
    expect(getByLabelText('pin').hasAttribute('inputmode')).toBe(false);
  });

  it('marks a field that appears later before the tap focuses it', () => {
    const { container } = render(<Page enabled />);
    const late = document.createElement('input');
    container.appendChild(late);
    expect(late.hasAttribute('inputmode')).toBe(false);
    fireEvent.pointerDown(late);
    expect(late.getAttribute('inputmode')).toBe('none');
  });

  it('does nothing off the kiosk', () => {
    const { getByLabelText } = render(<Page enabled={false} />);
    const title = getByLabelText('title');
    fireEvent.pointerDown(title);
    fireEvent.focus(title);
    expect(title.hasAttribute('inputmode')).toBe(false);
  });
});
