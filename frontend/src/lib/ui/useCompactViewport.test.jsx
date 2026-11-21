import React from 'react';
import { cleanup, render, screen, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { COMPACT_VIEWPORT_QUERY, useCompactViewport } from './useCompactViewport.js';

function CompactViewportProbe() {
  return <output>{useCompactViewport() ? 'compact' : 'wide'}</output>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('uses the shared 768px boundary and updates when the viewport crosses it', () => {
  expect(COMPACT_VIEWPORT_QUERY).toBe('(max-width: 767px)');
  let matches = true;
  const listeners = new Set();
  vi.stubGlobal('matchMedia', vi.fn(query => ({
    media: query,
    get matches() { return matches; },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  })));

  render(<CompactViewportProbe />);
  expect(screen.getByText('compact')).toBeInTheDocument();

  act(() => {
    matches = false;
    listeners.forEach(listener => listener({ matches }));
  });
  expect(screen.getByText('wide')).toBeInTheDocument();
});
