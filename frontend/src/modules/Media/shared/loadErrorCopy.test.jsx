import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MantineProvider } from '@mantine/core';
import { loadErrorMessage } from './loadErrorCopy.js';
import { LoadErrorLine } from './LoadErrorLine.jsx';

const RAW = 'HTTP 403: Forbidden - Acceptance blocks upstream API command or unlisted read';

describe('load error copy', () => {
  it('never carries HTTP codes or server text', () => {
    for (const kind of ['suggestions', 'recent', 'section', 'item', 'search', 'bogus']) {
      const msg = loadErrorMessage(kind, { message: RAW, kind: 'connection' });
      expect(msg).not.toMatch(/HTTP|403|Forbidden|Acceptance/);
      expect(msg.endsWith('.')).toBe(true);
    }
  });
  it('renders one quiet line and a Try again button, never the raw error', () => {
    const onRetry = vi.fn();
    render(<MantineProvider><LoadErrorLine kind="suggestions" error={new Error(RAW)} onRetry={onRetry} /></MantineProvider>);
    expect(screen.getByText("Couldn't load suggestions.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/HTTP|403|Forbidden/);
    expect(document.body.textContent).not.toMatch(/failed to load/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
