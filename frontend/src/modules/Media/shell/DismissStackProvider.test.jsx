import React, { useContext, useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { DismissContext, DismissStackProvider } from './DismissStackProvider.jsx';

function Layer({ onDismiss }) {
  const register = useContext(DismissContext);
  useEffect(() => register('search-results', onDismiss, false, () => true), [onDismiss, register]);
  return null;
}

describe('DismissStackProvider', () => {
  it('dismisses a non-managed overlay before delegating Escape to route Back', () => {
    const dismissLayer = vi.fn();
    const onBaseDismiss = vi.fn();
    const view = render(<DismissStackProvider onBaseDismiss={onBaseDismiss}><Layer onDismiss={dismissLayer} /></DismissStackProvider>);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dismissLayer).toHaveBeenCalledTimes(1);
    expect(onBaseDismiss).not.toHaveBeenCalled();

    // The overlay unregisters when it closes; the next Escape is route Back.
    view.rerender(<DismissStackProvider onBaseDismiss={onBaseDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onBaseDismiss).toHaveBeenCalledTimes(1);
  });
});
