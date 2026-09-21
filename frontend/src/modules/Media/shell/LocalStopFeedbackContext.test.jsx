import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';
import { MiniPlayer } from './MiniPlayer.jsx';
import { LocalStopFeedbackProvider, useLocalStopFeedbackCount } from './LocalStopFeedbackContext.jsx';

const nav = { push: vi.fn(), view: 'home' };
vi.mock('./NavProvider.jsx', () => ({ useNav: () => nav }));
vi.mock('../session/usePlayerHost.js', () => ({ usePlayerHost: () => {} }));

function QueueKeptNotice() {
  const count = useLocalStopFeedbackCount();
  return count == null ? null : <div data-testid="np-queue-kept">Queue kept: {count} item{count === 1 ? '' : 's'}</div>;
}

function StopFeedbackHarness({ controller }) {
  const [showMini, setShowMini] = useState(true);
  return (
    <LocalSessionContext.Provider value={{ controller }}>
      <LocalStopFeedbackProvider>
        {showMini && <MiniPlayer />}
        <QueueKeptNotice />
        <button type="button" onClick={() => setShowMini(false)}>Back</button>
        <button type="button" onClick={() => setShowMini(true)}>Reopen</button>
      </LocalStopFeedbackProvider>
    </LocalSessionContext.Provider>
  );
}

describe('LocalStopFeedbackProvider', () => {
  it('keeps a real Mini Stop receipt visible through Back and reopen, but not a held Add', () => {
    const controller = createLocalSessionController({
      clientId: 'shell-stop-receipt',
      randomUuid: () => 'shell-stop-receipt-session',
    });
    controller.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
    controller.queue.add({ contentId: 'plex:arrival', title: 'Arrival', format: 'video' });
    controller.transport.play();

    render(<StopFeedbackHarness controller={controller} />);
    expect(screen.queryByTestId('np-queue-kept')).toBeNull();

    fireEvent.click(screen.getByTestId('mini-stop'));
    expect(screen.getByTestId('np-queue-kept')).toHaveTextContent('Queue kept: 1 item');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByTestId('media-mini-player')).toBeNull();
    expect(screen.getByTestId('np-queue-kept')).toHaveTextContent('Queue kept: 1 item');

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(screen.getByTestId('media-mini-player')).toBeInTheDocument();
    expect(screen.getByTestId('np-queue-kept')).toHaveTextContent('Queue kept: 1 item');
  });

  it('does not fabricate a receipt for a held queue', () => {
    const controller = createLocalSessionController({
      clientId: 'shell-held-queue',
      randomUuid: () => 'shell-held-queue-session',
    });
    controller.queue.add({ contentId: 'plex:held', title: 'Held', format: 'video' });

    render(<StopFeedbackHarness controller={controller} />);
    expect(screen.queryByTestId('np-queue-kept')).toBeNull();
  });

  it('invalidates a Stop receipt when queue A is replaced by B at the same count', async () => {
    const controller = createLocalSessionController({
      clientId: 'shell-queue-aba',
      randomUuid: () => 'shell-queue-aba-session',
    });
    controller.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
    controller.queue.add({ contentId: 'plex:a', title: 'A', format: 'video' });
    controller.transport.play();
    const queueA = controller.getSnapshot().queue.items[0].queueItemId;

    render(<StopFeedbackHarness controller={controller} />);
    fireEvent.click(screen.getByTestId('mini-stop'));
    expect(screen.getByTestId('np-queue-kept')).toHaveTextContent('Queue kept: 1 item');

    await act(async () => {
      controller.queue.remove(queueA);
      controller.queue.add({ contentId: 'plex:b', title: 'B', format: 'video' });
    });

    expect(controller.getSnapshot().queue.items).toHaveLength(1);
    expect(controller.getSnapshot().queue.items[0]).toEqual(expect.objectContaining({ contentId: 'plex:b' }));
    expect(screen.queryByTestId('np-queue-kept')).toBeNull();
  });
});
