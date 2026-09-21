import React, { useContext, useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DismissContext, DismissStackProvider } from './DismissStackProvider.jsx';

function Layer({ onDismiss, managed = false, isActive = () => true, children }) {
  const register = useContext(DismissContext);
  useEffect(() => register('search-results', onDismiss, managed, isActive), [onDismiss, managed, isActive, register]);
  return children ?? null;
}

describe('DismissStackProvider', () => {
  it.each([false, true])('consumes the Escape that closes an active layer before document bubble (managed=%s)', async (managed) => {
    let active = true;
    const dismissLayer = vi.fn();
    const onBaseDismiss = vi.fn();
    render(<DismissStackProvider onBaseDismiss={onBaseDismiss}>
      <Layer onDismiss={dismissLayer} managed={managed} isActive={() => active}>
        <button onKeyDown={event => { if (event.key === 'Escape') active = false; }}>Search action</button>
      </Layer>
    </DismissStackProvider>);
    const target = screen.getByRole('button', { name: 'Search action' });

    // Target-phase overlay handling closes it before the document bubble
    // listener runs, just as Mantine can do during a real browser keydown.
    fireEvent.keyDown(target, { key: 'Escape', code: 'Escape' });
    await Promise.resolve();
    expect(active).toBe(false);
    expect(onBaseDismiss).not.toHaveBeenCalled();
    expect(dismissLayer).not.toHaveBeenCalled();

    fireEvent.keyDown(target, { key: 'Escape', code: 'Escape' });
    await Promise.resolve();
    expect(onBaseDismiss).toHaveBeenCalledTimes(1);
  });

  it('defers unmanaged dismissal until all synchronous Escape handlers finish', async () => {
    const dismissLayer = vi.fn();
    const onBaseDismiss = vi.fn();
    render(<DismissStackProvider onBaseDismiss={onBaseDismiss}><Layer onDismiss={dismissLayer} /></DismissStackProvider>);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dismissLayer).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(dismissLayer).toHaveBeenCalledTimes(1);
    expect(onBaseDismiss).not.toHaveBeenCalled();
  });

  it('keeps nested Escape event ownership independent', async () => {
    let active = true;
    const dismissLayer = vi.fn();
    const onBaseDismiss = vi.fn();
    render(<DismissStackProvider onBaseDismiss={onBaseDismiss}>
      <Layer onDismiss={dismissLayer} isActive={() => active}>
        <button onKeyDown={event => {
          if (event.key !== 'Escape' || !active) return;
          active = false;
          event.currentTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        }}>Search action</button>
      </Layer>
    </DismissStackProvider>);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Search action' }), { key: 'Escape' });
    expect(onBaseDismiss).not.toHaveBeenCalled();
    await Promise.resolve();
    // Only the nested event began without a layer. The original Escape
    // remains owned by search even though nested dispatch changed the stack.
    expect(onBaseDismiss).toHaveBeenCalledTimes(1);
    expect(dismissLayer).not.toHaveBeenCalled();
  });

  it('honors preventDefault from a later target handler', async () => {
    const dismissLayer = vi.fn();
    const onBaseDismiss = vi.fn();
    render(<DismissStackProvider onBaseDismiss={onBaseDismiss}>
      <Layer onDismiss={dismissLayer}>
        <button onKeyDown={event => event.preventDefault()}>Managed menu action</button>
      </Layer>
    </DismissStackProvider>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Managed menu action' }), { key: 'Escape' });
    await Promise.resolve();
    expect(dismissLayer).not.toHaveBeenCalled();
    expect(onBaseDismiss).not.toHaveBeenCalled();
  });

  it('cancels a queued Back when the provider unmounts during the event', async () => {
    const onBaseDismiss = vi.fn();
    const view = render(<DismissStackProvider onBaseDismiss={onBaseDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    view.unmount();
    await Promise.resolve();
    expect(onBaseDismiss).not.toHaveBeenCalled();
  });

  it('dismisses a non-managed overlay before delegating Escape to route Back', async () => {
    const dismissLayer = vi.fn();
    const onBaseDismiss = vi.fn();
    const view = render(<DismissStackProvider onBaseDismiss={onBaseDismiss}><Layer onDismiss={dismissLayer} /></DismissStackProvider>);

    fireEvent.keyDown(document, { key: 'Escape' });
    await Promise.resolve();
    expect(dismissLayer).toHaveBeenCalledTimes(1);
    expect(onBaseDismiss).not.toHaveBeenCalled();

    // The overlay unregisters when it closes; the next Escape is route Back.
    view.rerender(<DismissStackProvider onBaseDismiss={onBaseDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    await Promise.resolve();
    expect(onBaseDismiss).toHaveBeenCalledTimes(1);
  });
});
