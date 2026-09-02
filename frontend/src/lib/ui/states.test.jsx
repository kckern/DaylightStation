import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { LoadingState, ErrorState, EmptyState } from './states.jsx';

const wrapper = ({ children }) => <MantineProvider>{children}</MantineProvider>;

describe('state triad', () => {
  it('LoadingState is aria-busy and decorative', () => {
    const { container } = render(<LoadingState label="log" />, { wrapper });
    expect(container.querySelector('.ds-state--loading').getAttribute('aria-busy')).toBe('true');
  });

  it('ErrorState shows the message and wires retry', () => {
    const retry = vi.fn();
    render(<ErrorState error={new Error('boom')} onRetry={retry} />, { wrapper });
    expect(screen.getByText(/boom/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalled();
  });

  it('ErrorState without onRetry throws (no dead ends)', () => {
    expect(() => render(<ErrorState error={new Error('x')} />, { wrapper })).toThrow(/onRetry/);
  });

  it('EmptyState renders title, hint, and action', () => {
    const act = vi.fn();
    render(<EmptyState title="Nothing yet" hint="Log something" action={{ label: 'Add', onClick: act }} />, { wrapper });
    expect(screen.getByText('Nothing yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(act).toHaveBeenCalled();
  });
});
