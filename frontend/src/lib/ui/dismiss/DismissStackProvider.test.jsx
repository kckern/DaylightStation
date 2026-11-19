import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DismissStackProvider } from './DismissStackProvider.jsx';
import { useDismissLayer } from './useDismissLayer.js';

function Layer({ open = true, onDismiss, managed = false, isActive, children }) {
  useDismissLayer(open, onDismiss, { managed, isActive });
  return children ?? null;
}

const afterNativeEventDispatch = () => new Promise(resolve => setTimeout(resolve, 0));

describe('DismissStackProvider', () => {
  it('keeps an open lower layer in place when its dismissal callback changes', async () => {
    const initialLower = vi.fn();
    const updatedLower = vi.fn();
    const upper = vi.fn();
    const stack = (lower, topOpen) => (
      <DismissStackProvider>
        <Layer onDismiss={lower} />
        <Layer open={topOpen} onDismiss={upper} />
      </DismissStackProvider>
    );
    const { rerender } = render(stack(initialLower, false));
    rerender(stack(initialLower, true));
    rerender(stack(updatedLower, true));

    fireEvent.keyDown(document, { key: 'Escape' });
    await afterNativeEventDispatch();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(updatedLower).not.toHaveBeenCalled();

    rerender(stack(updatedLower, false));
    fireEvent.keyDown(document, { key: 'Escape' });
    await afterNativeEventDispatch();
    expect(updatedLower).toHaveBeenCalledTimes(1);
    expect(initialLower).not.toHaveBeenCalled();
  });

  it('does not pass queued Escape to a layer reopened before dismissal', async () => {
    const onDismiss = vi.fn();
    const onBaseDismiss = vi.fn();
    const stack = open => (
      <DismissStackProvider onBaseDismiss={onBaseDismiss}>
        <Layer open={open} onDismiss={onDismiss} />
      </DismissStackProvider>
    );
    const { rerender } = render(stack(true));

    fireEvent.keyDown(document, { key: 'Escape' });
    rerender(stack(false));
    rerender(stack(true));
    await afterNativeEventDispatch();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onBaseDismiss).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    await afterNativeEventDispatch();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

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
    await afterNativeEventDispatch();
    expect(active).toBe(false);
    expect(onBaseDismiss).not.toHaveBeenCalled();
    expect(dismissLayer).not.toHaveBeenCalled();

    fireEvent.keyDown(target, { key: 'Escape', code: 'Escape' });
    await afterNativeEventDispatch();
    expect(onBaseDismiss).toHaveBeenCalledTimes(1);
  });

  it('defers unmanaged dismissal until all synchronous Escape handlers finish', async () => {
    const dismissLayer = vi.fn();
    const onBaseDismiss = vi.fn();
    render(<DismissStackProvider onBaseDismiss={onBaseDismiss}><Layer onDismiss={dismissLayer} /></DismissStackProvider>);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dismissLayer).not.toHaveBeenCalled();
    await afterNativeEventDispatch();
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
    await afterNativeEventDispatch();
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
    await afterNativeEventDispatch();
    expect(dismissLayer).not.toHaveBeenCalled();
    expect(onBaseDismiss).not.toHaveBeenCalled();
  });

  it('cancels a queued Back when the provider unmounts during the event', async () => {
    const onBaseDismiss = vi.fn();
    const view = render(<DismissStackProvider onBaseDismiss={onBaseDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    view.unmount();
    await afterNativeEventDispatch();
    expect(onBaseDismiss).not.toHaveBeenCalled();
  });

  it('dismisses a non-managed overlay before delegating Escape to route Back', async () => {
    const dismissLayer = vi.fn();
    const onBaseDismiss = vi.fn();
    const view = render(<DismissStackProvider onBaseDismiss={onBaseDismiss}><Layer onDismiss={dismissLayer} /></DismissStackProvider>);

    fireEvent.keyDown(document, { key: 'Escape' });
    await afterNativeEventDispatch();
    expect(dismissLayer).toHaveBeenCalledTimes(1);
    expect(onBaseDismiss).not.toHaveBeenCalled();

    // The overlay unregisters when it closes; the next Escape is route Back.
    view.rerender(<DismissStackProvider onBaseDismiss={onBaseDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    await afterNativeEventDispatch();
    expect(onBaseDismiss).toHaveBeenCalledTimes(1);
  });
});
