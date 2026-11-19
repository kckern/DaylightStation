import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CameraFeed from './CameraFeed.jsx';
import CameraRenderer from './CameraRenderer.jsx';

vi.mock('./useSnapshotFetch.js', () => ({ default: () => ({ naturalSize: { w: 0, h: 0 } }) }));
vi.mock('./useHlsStream.js', () => ({ default: () => ({ ready: false, videoSize: { w: 0, h: 0 } }) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('camera state ownership', () => {
  it('shares detection polls between Home and fullscreen, pauses the timer in the background and confirms a command once', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const reads = [];
    const writes = [];
    vi.stubGlobal('fetch', async (url, options) => {
      const { pathname } = new URL(url);
      if (pathname.endsWith('/state')) {
        reads.push(pathname);
        return Response.json({ detections: [{ type: 'vehicle', active: true }] });
      }
      if (options.method === 'POST') {
        writes.push([pathname, JSON.parse(options.body)]);
        return Response.json({ ok: false, error: 'Fixture device unavailable' });
      }
      return Response.json({ controls: [{ id: 'siren', type: 'siren', label: 'Siren' }] });
    });
    const tree = render(<CameraFeed cameraId="porch" renderHeader={open => <button onClick={open}>Open camera</button>} />);
    await act(async () => {});
    expect(screen.getByText('vehicle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getAllByText('vehicle')).toHaveLength(2);
    expect(reads).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Siren' }));
    expect(writes).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Siren' }));
    await act(async () => {});
    expect(writes).toEqual([['/api/v1/camera/porch/controls/siren', { action: 'trigger' }]]);
    expect(screen.getByRole('alert')).toHaveTextContent('Fixture device unavailable');
    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(reads).toHaveLength(2);
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => {});
    expect(reads).toHaveLength(3);
    tree.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(reads).toHaveLength(3);
  });

  it('recovers from a stalled state read without applying its late response', async () => {
    vi.useFakeTimers();
    let release, signal;
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce((url, options) => {
        signal = options.signal;
        return new Promise(resolve => { release = resolve; });
      })
      .mockImplementation(async () => Response.json({ detections: [{ type: 'motion', active: true }] })));
    render(<CameraRenderer cameraId="back" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(signal.aborted).toBe(true);
    expect(screen.getByText('motion')).toBeInTheDocument();
    await act(async () => { release(Response.json({ detections: [{ type: 'vehicle', active: true }] })); });
    expect(screen.queryByText('vehicle')).toBeNull();
  });

  it('keeps detections for a standalone renderer and ignores a superseded camera response', async () => {
    let finishOld;
    vi.stubGlobal('fetch', url => url.includes('/front/')
      ? new Promise(resolve => { finishOld = resolve; })
      : Promise.resolve(Response.json({ detections: [{ type: 'motion', active: true }] })));
    const tree = render(<CameraRenderer cameraId="front" />);
    tree.rerender(<CameraRenderer cameraId="back" />);
    await screen.findByText('motion');
    await act(async () => { finishOld(Response.json({ detections: [{ type: 'person', active: true }] })); });
    expect(screen.queryByText('person')).toBeNull();
    expect(screen.getByText('motion')).toBeInTheDocument();
  });
});
