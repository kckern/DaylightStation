// frontend/src/modules/Fitness/player/SessionCameraCapture.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const webcamSpy = vi.fn();
vi.mock('@/modules/Fitness/components/FitnessWebcam.jsx', () => ({
  Webcam: (props) => { webcamSpy(props); return <div data-testid="webcam" />; }
}));
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({})) }));
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() }) })
}));

const { DaylightAPI } = await import('@/lib/api.mjs');
const SessionCameraCapture = (await import('./SessionCameraCapture.jsx')).default;

describe('SessionCameraCapture', () => {
  it('mounts the webcam when enabled', () => {
    const { queryByTestId } = render(<SessionCameraCapture sessionId="s1" enabled />);
    expect(queryByTestId('webcam')).not.toBeNull();
  });

  it('never mounts the webcam when disabled — getUserMedia is never reached', () => {
    webcamSpy.mockClear();
    const { queryByTestId } = render(<SessionCameraCapture sessionId="s1" enabled={false} />);
    expect(queryByTestId('webcam')).toBeNull();
    expect(webcamSpy).not.toHaveBeenCalled();
  });

  // Regression: the capture effect re-runs whenever `enabled` toggles mid-session.
  // It used to reset the frame index to 0 there, so the restarted run replayed
  // 0,1,2… and the server overwrote the earlier frames — session 20260831132151
  // lost its first 13.8 minutes that way. The index may only reset on a NEW session.
  it('does not restart the frame index when capture is toggled mid-session', async () => {
    webcamSpy.mockClear();
    DaylightAPI.mockClear();
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const snapshot = async () => {
      const { onSnapshot } = webcamSpy.mock.calls[webcamSpy.mock.calls.length - 1][0];
      await onSnapshot({ takenAt: Date.now() }, blob);
    };

    const { rerender } = render(<SessionCameraCapture sessionId="s1" enabled />);
    await snapshot();
    rerender(<SessionCameraCapture sessionId="s1" enabled={false} />);
    rerender(<SessionCameraCapture sessionId="s1" enabled />);
    await snapshot();

    const indices = DaylightAPI.mock.calls.map(([, body]) => body.index);
    expect(indices).toEqual([0, 1]);
  });

  it('does restart the frame index for a genuinely new session', async () => {
    webcamSpy.mockClear();
    DaylightAPI.mockClear();
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const snapshot = async () => {
      const { onSnapshot } = webcamSpy.mock.calls[webcamSpy.mock.calls.length - 1][0];
      await onSnapshot({ takenAt: Date.now() }, blob);
    };

    const { rerender } = render(<SessionCameraCapture sessionId="s1" enabled />);
    await snapshot();
    rerender(<SessionCameraCapture sessionId="s2" enabled />);
    await snapshot();

    expect(DaylightAPI.mock.calls.map(([, body]) => body.index)).toEqual([0, 0]);
    expect(DaylightAPI.mock.calls.map(([, body]) => body.sessionId)).toEqual(['s1', 's2']);
  });
});
