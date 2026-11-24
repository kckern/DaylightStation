// frontend/src/lib/ui/dismiss/useOverlayFocusReturn.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createRef } from 'react';
import { useOverlayFocusReturn } from './useOverlayFocusReturn.js';

function Overlay({ open, returnRef, fallback, label = 'overlay', autoFocus = false }) {
  useOverlayFocusReturn(open, returnRef, fallback);
  return open ? <button autoFocus={autoFocus}>{label}</button> : null;
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('useOverlayFocusReturn', () => {
  it('returns focus to the element that was focused when it opened', async () => {
    const App = ({ open }) => <><button>opener</button><Overlay open={open} /></>;
    const { rerender } = render(<App open={false} />);
    screen.getByText('opener').focus();
    rerender(<App open />);
    screen.getByText('overlay').focus();
    rerender(<App open={false} />);
    await flush();
    expect(document.activeElement).toBe(screen.getByText('opener'));
  });

  it('prefers the live returnFocusRef element over the remembered opener', async () => {
    const ref = createRef();
    const App = ({ open }) => <><button>opener</button><button ref={ref}>target</button><Overlay open={open} returnRef={ref} /></>;
    const { rerender } = render(<App open={false} />);
    screen.getByText('opener').focus();
    rerender(<App open />);
    rerender(<App open={false} />);
    await flush();
    expect(document.activeElement).toBe(screen.getByText('target'));
  });

  it('follows a trigger that was recreated in the same commit that closed the overlay', async () => {
    const ref = createRef();
    const App = ({ open, k }) => <><button key={k} ref={ref}>trigger</button><Overlay open={open} returnRef={ref} /></>;
    const { rerender } = render(<App open={false} k="a" />);
    const old = screen.getByText('trigger');
    old.focus();
    rerender(<App open k="a" />);
    rerender(<App open={false} k="b" />);
    await flush();
    expect(old.isConnected).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('trigger'));
  });

  it('uses the fallback target when the opener is gone and nothing else holds focus', async () => {
    const App = ({ open, showOpener, showFallback }) => (
      <>
        {showOpener && <button>opener</button>}
        {showFallback && <button>fallback</button>}
        <Overlay open={open} fallback={() => screen.queryByText('fallback')} />
      </>
    );
    const { rerender } = render(<App open={false} showOpener showFallback={false} />);
    screen.getByText('opener').focus();
    rerender(<App open showOpener showFallback={false} />);
    rerender(<App open={false} showOpener={false} showFallback />);
    await flush();
    expect(document.activeElement).toBe(screen.getByText('fallback'));
  });

  it('does not steal focus for the fallback when the next view already took it', async () => {
    const App = ({ open, next, opener }) => (
      <>
        {opener && <button>opener</button>}
        {next && <button autoFocus>next</button>}
        <button>fallback</button>
        <Overlay open={open} fallback={() => screen.getByText('fallback')} />
      </>
    );
    const { rerender } = render(<App open={false} opener />);
    screen.getByText('opener').focus();
    rerender(<App open opener />);
    rerender(<App open={false} next />);
    await flush();
    expect(document.activeElement).toBe(screen.getByText('next'));
  });

  it('a replacement overlay opened in the same commit inherits the original return target', async () => {
    const App = ({ which }) => (
      <>
        <button>opener</button>
        <Overlay open={which === 'a'} label="A" />
        <Overlay open={which === 'b'} label="B" autoFocus />
      </>
    );
    const { rerender } = render(<App which="none" />);
    screen.getByText('opener').focus();
    rerender(<App which="a" />);
    screen.getByText('A').focus();
    // A closes and B opens together. B sees A's pending return, not the focused "A" button.
    rerender(<App which="b" />);
    await flush();
    // A's pending return was taken over by B, so it must not pull focus off B.
    expect(document.activeElement).toBe(screen.getByText('B'));
    rerender(<App which="none" />);
    await flush();
    expect(document.activeElement).toBe(screen.getByText('opener'));
  });

  it('does nothing while closed', async () => {
    const App = ({ open }) => <><button>opener</button><Overlay open={open} /></>;
    const { rerender } = render(<App open={false} />);
    screen.getByText('opener').focus();
    rerender(<App open={false} />);
    await flush();
    expect(document.activeElement).toBe(screen.getByText('opener'));
  });
});
