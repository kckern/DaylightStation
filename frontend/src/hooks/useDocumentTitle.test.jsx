import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import useDocumentTitle from './useDocumentTitle.js';

function Host({ name }) {
  useDocumentTitle(name);
  return null;
}

describe('useDocumentTitle', () => {
  beforeEach(() => {
    document.title = 'Daylight Station';
  });

  it('sets "<name> | Daylight Station" on mount', () => {
    render(<Host name="Media" />);
    expect(document.title).toBe('Media | Daylight Station');
  });

  it('falls back to plain suffix when name is falsy', () => {
    render(<Host name="" />);
    expect(document.title).toBe('Daylight Station');
  });

  it('updates the title when name changes', () => {
    const { rerender } = render(<Host name="Media" />);
    expect(document.title).toBe('Media | Daylight Station');
    rerender(<Host name="Feed" />);
    expect(document.title).toBe('Feed | Daylight Station');
  });

  it('restores the previous title on unmount', () => {
    document.title = 'Previous';
    const { unmount } = render(<Host name="Media" />);
    expect(document.title).toBe('Media | Daylight Station');
    unmount();
    expect(document.title).toBe('Previous');
  });
});
