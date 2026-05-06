import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { AskBar } from './index.jsx';

function r(ui) { return render(<MantineProvider defaultColorScheme="dark">{ui}</MantineProvider>); }

describe('AskBar', () => {
  it('renders placeholder + ⌘K hint', () => {
    r(<AskBar onActivate={vi.fn()} />);
    expect(screen.getByText(/Ask your coach/)).toBeInTheDocument();
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });

  it('invokes onActivate on click', () => {
    const onActivate = vi.fn();
    r(<AskBar onActivate={onActivate} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onActivate).toHaveBeenCalled();
  });

  it('invokes onActivate on Enter keypress', () => {
    const onActivate = vi.fn();
    r(<AskBar onActivate={onActivate} />);
    const btn = screen.getByRole('button');
    btn.focus();
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalled();
  });
});
