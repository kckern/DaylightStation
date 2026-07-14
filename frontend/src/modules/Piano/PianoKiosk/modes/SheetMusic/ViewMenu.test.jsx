import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ViewMenu from './ViewMenu.jsx';

const base = {
  flow: 'wrapped', onToggleFlow: vi.fn(),
  scale: 1, onScale: vi.fn(),
  keyboardVisible: true, onToggleKeyboard: vi.fn(),
  meta: { title: 'Für Elise', composer: 'Beethoven', measures: 32 },
};

describe('ViewMenu', () => {
  it('renders layout / size / keyboard / about rows', () => {
    render(<ViewMenu {...base} />);
    expect(screen.getByRole('dialog', { name: /view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /down the page/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /across/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '150%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /keyboard/i })).toBeInTheDocument();
    expect(screen.getByText(/für elise/i)).toBeInTheDocument();
    expect(screen.getByText(/beethoven/i)).toBeInTheDocument();
  });

  it('layout Across toggles flow only when changing', () => {
    const onToggleFlow = vi.fn();
    render(<ViewMenu {...base} flow="wrapped" onToggleFlow={onToggleFlow} />);
    fireEvent.click(screen.getByRole('button', { name: /across/i }));
    expect(onToggleFlow).toHaveBeenCalledTimes(1);
    onToggleFlow.mockClear();
    // Clicking the already-active layout is a no-op.
    fireEvent.click(screen.getByRole('button', { name: /down the page/i }));
    expect(onToggleFlow).not.toHaveBeenCalled();
  });

  it('size step commits via onScale; keyboard row toggles', () => {
    const onScale = vi.fn();
    const onToggleKeyboard = vi.fn();
    render(<ViewMenu {...base} onScale={onScale} onToggleKeyboard={onToggleKeyboard} />);
    fireEvent.click(screen.getByRole('button', { name: '125%' }));
    expect(onScale).toHaveBeenCalledWith(1.25);
    fireEvent.click(screen.getByRole('button', { name: /keyboard/i }));
    expect(onToggleKeyboard).toHaveBeenCalled();
  });
});
