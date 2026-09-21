import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CastTargetProvider } from './CastTargetProvider.jsx';
import { DestinationLine } from './DestinationLine.jsx';
import { DismissStackProvider } from '../shell/DismissStackProvider.jsx';

vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ devices: [] }) }));
vi.mock('./DispatchTargetPicker.jsx', () => ({ DispatchTargetPicker: () => <div data-testid="picker-stub" /> }));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (target, key) => (target[key] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

function renderDestination(onBaseDismiss) {
  return render(
    <MantineProvider>
      <DismissStackProvider onBaseDismiss={onBaseDismiss}>
        <CastTargetProvider>
          <div data-testid="search-sentinel">Search stays mounted</div>
          <DestinationLine surface="search-mode" />
        </CastTargetProvider>
      </DismissStackProvider>
    </MantineProvider>
  );
}

beforeEach(() => localStorage.clear());

describe('DestinationLine Escape ownership', () => {
  it('closes only its sheet on first Escape and leaves route Back for the second', async () => {
    const onBaseDismiss = vi.fn();
    renderDestination(onBaseDismiss);
    fireEvent.click(screen.getByTestId('destination-line'));
    await screen.findByTestId('destination-sheet');

    fireEvent.keyDown(screen.getByTestId('destination-sheet'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('destination-sheet')).toBeNull());
    expect(screen.getByTestId('search-sentinel')).toBeVisible();
    expect(onBaseDismiss).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('search-sentinel'), { key: 'Escape' });
    await waitFor(() => expect(onBaseDismiss).toHaveBeenCalledTimes(1));
  });
});
