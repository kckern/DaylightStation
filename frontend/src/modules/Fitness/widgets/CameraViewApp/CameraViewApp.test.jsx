import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// ── mocks ────────────────────────────────────────────────────────────────
// Specifiers below are copied verbatim from CameraViewApp.jsx's own imports —
// a vi.mock of a path the component does not import silently does nothing.

const webcamSpy = vi.fn();
vi.mock('@/modules/Fitness/components/FitnessWebcam.jsx', () => ({
  Webcam: (props) => { webcamSpy(props); return <div data-testid="webcam" />; }
}));

vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() }) })
}));

// CameraViewApp.jsx imports both `useFitnessContext` (for timelapse config) and
// `useFitness` (for captureDisabled) from this module — both must resolve here.
let mockCtx = { captureDisabled: false };
vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitness: () => mockCtx,
  useFitnessContext: () => mockCtx
}));

// Real specifier is '@/modules/Fitness/player/useFitnessModule' (default export),
// NOT '@/modules/Fitness/hooks/useFitnessModule.js' — corrected from the brief's
// starting-point mock, which targeted a hooks/ path that CameraViewApp does not
// import (that mock would have silently no-op'd, leaving the real hook to run and
// throw outside a FitnessProvider).
vi.mock('@/modules/Fitness/player/useFitnessModule', () => ({
  default: () => ({
    sessionId: 's1',
    sessionInstance: null,
    registerSessionScreenshot: vi.fn(),
    configureSessionScreenshotPlan: vi.fn(),
    registerLifecycle: vi.fn()
  })
}));

const CameraViewApp = (await import('./CameraViewApp.jsx')).default;

describe('CameraViewApp capture gate', () => {
  it('renders the webcam normally', () => {
    mockCtx = { captureDisabled: false };
    webcamSpy.mockClear();
    const { queryByTestId } = render(<CameraViewApp />);
    expect(queryByTestId('webcam')).not.toBeNull();
  });

  it('tears down the stream and shows a disabled notice when capture is disabled', () => {
    mockCtx = { captureDisabled: true };
    webcamSpy.mockClear();
    const { queryByTestId, getByText } = render(<CameraViewApp />);
    expect(queryByTestId('webcam')).toBeNull();
    expect(webcamSpy).not.toHaveBeenCalled();
    expect(getByText(/camera is off/i)).toBeTruthy();
  });
});
