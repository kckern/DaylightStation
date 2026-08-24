import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PianoSheet from './PianoSheet.jsx';

vi.mock('../ui/icons/Icon.jsx', () => ({ default: () => <span aria-hidden /> }));

function Harness({ onClose = vi.fn() }) {
  return <><button type="button">Opener</button><PianoSheet open title="Sound" onClose={onClose}><button type="button">First action</button><button type="button">Last action</button></PianoSheet></>;
}

describe('PianoSheet', () => {
  it('names a modal dialog and moves focus to its 48px close control', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: 'Sound' })).toHaveAttribute('aria-modal', 'true');
    const close = screen.getByRole('button', { name: 'Close Sound' });
    expect(document.activeElement).toBe(close);
    expect(close).toHaveClass('piano-sheet__close');
  });

  it('contains forward and reverse Tab navigation', () => {
    render(<Harness />);
    const close = screen.getByRole('button', { name: 'Close Sound' });
    const last = screen.getByRole('button', { name: 'Last action' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape and restores focus to the opener on unmount', () => {
    const onClose = vi.fn();
    const { rerender } = render(<><button type="button">Opener</button></>);
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    rerender(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<button type="button">Opener</button>);
    expect(document.activeElement?.textContent).toBe('Opener');
  });
});
