import { render, fireEvent, screen } from '@testing-library/react';
import TransportSheet from './TransportSheet.jsx';

describe('TransportSheet', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<TransportSheet open={false} title="Key" onClose={() => {}}>x</TransportSheet>);
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog with title, children, and closes via the close button', () => {
    const onClose = vi.fn();
    render(<TransportSheet open title="Key" onClose={onClose}><p>body</p></TransportSheet>);
    const dialog = screen.getByRole('dialog', { name: 'Key' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Key' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close Key' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on scrim tap', () => {
    const onClose = vi.fn();
    const { container } = render(<TransportSheet open title="Tempo" onClose={onClose}>x</TransportSheet>);
    fireEvent.click(container.querySelector('.piano-tsheet__scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('labels the dialog by its heading and puts initial focus on the first content control, not Close', () => {
    render(<><button type="button">Opener</button><TransportSheet open title="Sound" onClose={vi.fn()}><button type="button">First action</button><button type="button">Last action</button></TransportSheet></>);
    const dialog = screen.getByRole('dialog', { name: 'Sound' });
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First action' }));
  });

  it('falls back to Close for initial focus when the body has nothing focusable', () => {
    render(<TransportSheet open title="Sound" onClose={vi.fn()}><p>text only</p></TransportSheet>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close Sound' }));
  });

  it('traps Tab in both directions between Close and the last control', () => {
    render(<TransportSheet open title="Sound" onClose={vi.fn()}><button type="button">First action</button><button type="button">Last action</button></TransportSheet>);
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
    screen.getByRole('button', { name: 'Opener' }).focus();
    rerender(<><button type="button">Opener</button><TransportSheet open title="Sound" onClose={onClose}><button type="button">A</button></TransportSheet></>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<button type="button">Opener</button>);
    expect(document.activeElement?.textContent).toBe('Opener');
  });

  it('adds the canvas modifier for size="canvas"', () => {
    const { container } = render(<TransportSheet open title="Sound" size="canvas" onClose={vi.fn()}>x</TransportSheet>);
    expect(container.querySelector('.piano-tsheet')).toHaveClass('piano-tsheet--canvas');
  });
});
