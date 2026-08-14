// frontend/src/modules/Fitness/player/SessionCameraCapture.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const webcamSpy = vi.fn();
vi.mock('@/modules/Fitness/components/FitnessWebcam.jsx', () => ({
  Webcam: (props) => { webcamSpy(props); return <div data-testid="webcam" />; }
}));
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() }) })
}));

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
});
