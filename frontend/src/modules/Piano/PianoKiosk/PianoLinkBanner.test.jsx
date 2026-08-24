import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repairConnection = vi.hoisted(() => vi.fn());
const connection = vi.hoisted(() => ({
  health: { state: 'ready', everReady: true },
  repair: { state: 'idle', message: null },
  repairConnection,
}));
vi.mock('./PianoConnectionContext.jsx', () => ({ usePianoConnection: () => connection }));

import PianoLinkBanner from './PianoLinkBanner.jsx';

describe('PianoLinkBanner', () => {
  beforeEach(() => {
    repairConnection.mockClear();
    Object.assign(connection.health, { state: 'ready', everReady: true });
    Object.assign(connection.repair, { state: 'idle', message: null });
  });

  it('stays out of the way while ready or making the initial connection', () => {
    const { container, rerender } = render(<PianoLinkBanner />);
    expect(container).toBeEmptyDOMElement();
    Object.assign(connection.health, { state: 'connecting', everReady: false });
    rerender(<PianoLinkBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the one player-facing loss message and central Reconnect action', () => {
    connection.health.state = 'input-only';
    render(<PianoLinkBanner />);
    expect(screen.getByRole('alert')).toHaveTextContent('Piano connection lost. Your sound changes are saved.');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(repairConnection).toHaveBeenCalledTimes(1);
  });

  it('uses shared repair progress, failure, and recovered messages', () => {
    connection.health.state = 'offline';
    connection.repair = { state: 'working', message: 'Repairing connection…' };
    const { rerender } = render(<PianoLinkBanner />);
    expect(screen.getByRole('button', { name: 'Reconnecting…' })).toBeDisabled();
    connection.repair = { state: 'failed', message: 'Piano did not reconnect in time.' };
    rerender(<PianoLinkBanner />);
    expect(screen.getByRole('alert')).toHaveTextContent('Piano did not reconnect in time.');
    connection.repair = { state: 'success', message: 'Piano reconnected — settings restored.' };
    rerender(<PianoLinkBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Piano reconnected — settings restored.');
  });
});
