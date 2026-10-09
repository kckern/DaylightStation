import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ViewSheet from './ViewSheet.jsx';

// ViewSheet replaces ViewMenu (wave-2 T8): the "how the score looks" panel
// becomes a centered TransportSheet like Key/Tempo, dropping the metadata
// block (About moved out — a sheet, not an info panel).
const base = {
  open: true, onClose: vi.fn(),
  flow: 'wrapped', onToggleFlow: vi.fn(),
  scale: 1, onScale: vi.fn(),
  keyboardVisible: true, onToggleKeyboard: vi.fn(),
};

describe('ViewSheet', () => {
  it('renders nothing when closed', () => {
    render(<ViewSheet {...base} open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders as a dialog titled View with layout / size / keyboard rows', () => {
    render(<ViewSheet {...base} />);
    expect(screen.getByRole('dialog', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /down the page/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /across/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '150%' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Keyboard' })).toBeInTheDocument();
  });

  it('layout buttons carry icon faces (layout-down / layout-across), not text-only', () => {
    render(<ViewSheet {...base} />);
    const down = screen.getByRole('button', { name: /down the page/i });
    const across = screen.getByRole('button', { name: /across/i });
    expect(down.querySelector('.piano-icon')).not.toBeNull();
    expect(across.querySelector('.piano-icon')).not.toBeNull();
  });

  it('has no metadata block — Title/Composer/About are gone (wave-2 T8)', () => {
    render(<ViewSheet {...base} />);
    expect(screen.queryByText('Title')).toBeNull();
    expect(screen.queryByText('Composer')).toBeNull();
    expect(document.querySelector('.piano-score-view-about')).toBeNull();
  });

  it('layout Across toggles flow only when changing', () => {
    const onToggleFlow = vi.fn();
    render(<ViewSheet {...base} flow="wrapped" onToggleFlow={onToggleFlow} />);
    fireEvent.click(screen.getByRole('button', { name: /across/i }));
    expect(onToggleFlow).toHaveBeenCalledTimes(1);
    onToggleFlow.mockClear();
    // Clicking the already-active layout is a no-op.
    fireEvent.click(screen.getByRole('button', { name: /down the page/i }));
    expect(onToggleFlow).not.toHaveBeenCalled();
  });

  it('size step commits via onScale', () => {
    const onScale = vi.fn();
    render(<ViewSheet {...base} onScale={onScale} />);
    fireEvent.click(screen.getByRole('button', { name: '125%' }));
    expect(onScale).toHaveBeenCalledWith(1.25);
  });

  it('keyboard row is a switch reflecting visibility', () => {
    render(<ViewSheet open onClose={vi.fn()} flow="wrapped" onToggleFlow={vi.fn()} scale={1} onScale={vi.fn()} keyboardVisible onToggleKeyboard={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Keyboard' })).toHaveAttribute('aria-checked', 'true');
  });

  it('tapping the keyboard switch fires the toggle', () => {
    const onToggleKeyboard = vi.fn();
    render(<ViewSheet open onClose={vi.fn()} flow="wrapped" onToggleFlow={vi.fn()} scale={1} onScale={vi.fn()} keyboardVisible={false} onToggleKeyboard={onToggleKeyboard} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Keyboard' }));
    expect(onToggleKeyboard).toHaveBeenCalled();
  });

  it('dismisses via its own scrim, calling onClose', () => {
    const onClose = vi.fn();
    render(<ViewSheet {...base} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss view/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
