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

  it('stops Escape before it reaches window listeners (the screen framework maps Escape itself)', () => {
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);
    try {
      render(<TransportSheet open title="Sound" onClose={vi.fn()}><button type="button">A</button></TransportSheet>);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(windowSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowSpy);
    }
  });

  it('only the most recently opened sheet handles Escape; the one beneath takes over when it closes', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    const tree = (innerOpen) => (
      <TransportSheet open title="Outer" onClose={outerClose}>
        <button type="button">Outer action</button>
        <TransportSheet open={innerOpen} title="Inner" onClose={innerClose}><button type="button">Inner action</button></TransportSheet>
      </TransportSheet>
    );
    const { rerender } = render(tree(false));
    rerender(tree(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledOnce();
    expect(outerClose).not.toHaveBeenCalled();
    rerender(tree(false));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(outerClose).toHaveBeenCalledOnce();
    expect(innerClose).toHaveBeenCalledOnce();
  });

  it('honours a data-autofocus opt-in for initial focus even when it is not first', () => {
    render(<TransportSheet open title="Sound" onClose={vi.fn()}><button type="button">First</button><button type="button" data-autofocus>Chosen</button></TransportSheet>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Chosen' }));
  });

  it('never wraps onto a control with tabindex="-1"', () => {
    render(<TransportSheet open title="Sound" onClose={vi.fn()}><button type="button">First</button><button type="button" tabIndex={-1}>Hidden</button></TransportSheet>);
    const close = screen.getByRole('button', { name: 'Close Sound' });
    const first = screen.getByRole('button', { name: 'First' });
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(first);
  });

  it('picks the innermost sheet as top by document order when both mount open in one commit', () => {
    // React 18 runs a child's effect before its parent's, so push order alone
    // would crown the OUTER sheet. Top must be decided by document position.
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <TransportSheet open title="Outer" onClose={outerClose}>
        <button type="button">Outer action</button>
        <TransportSheet open title="Inner" onClose={innerClose}><button type="button">Inner action</button></TransportSheet>
      </TransportSheet>
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inner action' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledOnce();
    expect(outerClose).not.toHaveBeenCalled();
  });
});
