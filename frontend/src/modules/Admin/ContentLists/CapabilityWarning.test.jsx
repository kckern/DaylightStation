// CapabilityWarning.test.jsx — the chip the admin row shows when a row's
// action and its source's capabilities disagree, plus the one-click fixes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const hookMock = vi.fn();
vi.mock('./useActionCapabilityCheck.js', () => ({
  useActionCapabilityCheck: (...args) => hookMock(...args),
}));

import { CapabilityWarning } from './CapabilityWarning.jsx';

function renderWarning(props = {}) {
  return render(
    <MantineProvider>
      <CapabilityWarning
        input="files:art/fhe/esther.jpg"
        action="Display"
        onUpdate={props.onUpdate || vi.fn()}
        {...props}
      />
    </MantineProvider>
  );
}

beforeEach(() => {
  hookMock.mockReset();
  hookMock.mockReturnValue({ mismatch: null, suggestion: null, loading: false });
});

describe('CapabilityWarning', () => {
  // MantineProvider injects its own <style> into the container, so assert on
  // the component's own output rather than an empty container.
  it('renders nothing when there is no mismatch', () => {
    renderWarning();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders nothing while the check is still loading', () => {
    hookMock.mockReturnValue({ mismatch: null, suggestion: null, loading: true });
    renderWarning();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names the action and what the source lacks', () => {
    hookMock.mockReturnValue({
      mismatch: { action: 'Display', accepts: ['displayable'] },
      suggestion: null,
      loading: false,
    });
    renderWarning();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Display/);
    expect(alert.textContent).toMatch(/displayable/);
  });

  it('swaps the input to the suggested id, leaving the action alone', () => {
    const onUpdate = vi.fn();
    hookMock.mockReturnValue({
      mismatch: { action: 'Display', accepts: ['displayable'] },
      suggestion: 'canvas:fhe/esther.jpg',
      loading: false,
    });
    renderWarning({ onUpdate });

    fireEvent.click(screen.getByRole('button', { name: /canvas:fhe\/esther\.jpg/ }));
    expect(onUpdate).toHaveBeenCalledWith({ input: 'canvas:fhe/esther.jpg' });
  });

  it('offers no swap button when nothing else can satisfy the action', () => {
    hookMock.mockReturnValue({
      mismatch: { action: 'Display', accepts: ['displayable'] },
      suggestion: null,
      loading: false,
    });
    renderWarning();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
