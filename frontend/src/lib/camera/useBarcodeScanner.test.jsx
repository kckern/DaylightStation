import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { useBarcodeScanner, RETAIL_BARCODE_FORMATS } from './useBarcodeScanner.js';

const zxing = vi.hoisted(() => ({ decodeFromVideoElement: vi.fn(), stop: vi.fn() }));
vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    decodeFromVideoElement(video, callback) { return zxing.decodeFromVideoElement(video, callback); }
  },
}));

function Probe({ active = true, onDecode, restartKey = 0 }) {
  const videoRef = useRef(null);
  const { cameraState } = useBarcodeScanner({ active, videoRef, onDecode, restartKey });
  return <><video ref={videoRef} /><output data-testid="state">{cameraState}</output></>;
}

let tracks;
const setCamera = (value) => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value });

beforeEach(() => {
  tracks = [{ stop: vi.fn() }];
  setCamera({ getUserMedia: vi.fn(async () => ({ getTracks: () => tracks })) });
  window.HTMLMediaElement.prototype.play = vi.fn(async () => {});
  // happy-dom's setter only takes its own MediaStream; the fake stream is a plain object.
  Object.defineProperty(window.HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get() { return this.__stream ?? null; },
    set(value) { this.__stream = value; },
  });
  delete window.BarcodeDetector;
  zxing.decodeFromVideoElement.mockReset();
  zxing.stop.mockReset();
});
afterEach(() => { cleanup(); delete window.BarcodeDetector; });

describe('useBarcodeScanner', () => {
  it('reads with the native BarcodeDetector, reports one decode, and releases the camera', async () => {
    const detect = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([{ rawValue: '9780000000002' }]);
    const made = vi.fn();
    window.BarcodeDetector = class { constructor(options) { made(options); } detect(video) { return detect(video); } };
    const onDecode = vi.fn();
    render(<Probe onDecode={onDecode} />);
    await waitFor(() => expect(onDecode).toHaveBeenCalledWith('9780000000002'));
    expect(onDecode).toHaveBeenCalledTimes(1);
    expect(made).toHaveBeenCalledWith({ formats: [...RETAIL_BARCODE_FORMATS] });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' } });
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(zxing.decodeFromVideoElement).not.toHaveBeenCalled();
  });

  it('falls back to the lazily loaded zxing reader where there is no native detector', async () => {
    zxing.decodeFromVideoElement.mockImplementation(async (_video, callback) => {
      setTimeout(() => callback({ getText: () => '9780000000002' }), 0);
      return { stop: zxing.stop };
    });
    const onDecode = vi.fn();
    render(<Probe onDecode={onDecode} />);
    await waitFor(() => expect(onDecode).toHaveBeenCalledWith('9780000000002'));
    expect(zxing.stop).toHaveBeenCalled();
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it('reports denied when the camera is refused', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(new Error('NotAllowedError'));
    render(<Probe onDecode={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('denied'));
  });

  it('reports denied where the browser has no camera API at all', async () => {
    setCamera(undefined);
    render(<Probe onDecode={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('denied'));
  });

  it('opens nothing while inactive, and releases the camera when it goes inactive', async () => {
    const { rerender } = render(<Probe active={false} onDecode={vi.fn()} />);
    expect(screen.getByTestId('state').textContent).toBe('idle');
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    window.BarcodeDetector = class { detect() { return Promise.resolve([]); } };
    rerender(<Probe active onDecode={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('live'));
    rerender(<Probe active={false} onDecode={vi.fn()} />);
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(screen.getByTestId('state').textContent).toBe('idle');
  });

  it('scans again when the restart key changes', async () => {
    window.BarcodeDetector = class { detect() { return Promise.resolve([{ rawValue: '012345678905' }]); } };
    const onDecode = vi.fn();
    const { rerender } = render(<Probe onDecode={onDecode} restartKey={0} />);
    await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(1));
    rerender(<Probe onDecode={onDecode} restartKey={1} />);
    await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(2));
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  });
});
