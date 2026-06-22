// frontend/src/screen-framework/publishers/useScreenPresencePublisher.playing.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../services/WebSocketService.js', () => ({ wsService: { send: vi.fn() } }));
const { wsService } = await import('../../services/WebSocketService.js');
const { useScreenPresencePublisher } = await import('./useScreenPresencePublisher.js');

function Harness({ active, playing }) {
  useScreenPresencePublisher({ deviceId: 'livingroom-tv', active, playing });
  return null;
}

describe('useScreenPresencePublisher playing flag', () => {
  beforeEach(() => { wsService.send.mockClear(); });

  it('includes playing:true in the message when a video is up', () => {
    render(<Harness active playing />);
    expect(wsService.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'screen.presence', deviceId: 'livingroom-tv', active: true, playing: true }),
    );
  });

  it('includes playing:false for an active-but-art scene', () => {
    render(<Harness active playing={false} />);
    expect(wsService.send).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, playing: false }),
    );
  });

  it('defaults playing to false when omitted', () => {
    render(<Harness active />);
    expect(wsService.send).toHaveBeenCalledWith(expect.objectContaining({ playing: false }));
  });
});
