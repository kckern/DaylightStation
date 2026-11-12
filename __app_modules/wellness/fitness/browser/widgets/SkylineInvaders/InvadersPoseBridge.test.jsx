import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const poseApi = vi.hoisted(() => ({ value: null }));
const video = vi.hoisted(() => ({ el: { tagName: 'VIDEO' } }));
vi.mock('../../hooks/usePoseProvider.js', () => ({ usePoseProvider: () => poseApi.value }));
vi.mock('../../components/FitnessWebcam.jsx', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    Webcam: forwardRef(({ onStreamReady, onError }, ref) => {
      useImperativeHandle(ref, () => ({ getVideoElement: () => video.el }));
      return <button data-testid="cam" onClick={() => onStreamReady()} onDoubleClick={() => onError(new Error('denied'))} />;
    }),
  };
});
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), sampled: vi.fn() }) }) }));
import InvadersPoseBridge from './InvadersPoseBridge.jsx';

const api = (over = {}) => ({ isLoading: false, isDetecting: false, error: null, fps: 0, latency: 0, backend: 'wasm', modelType: 'full', start: vi.fn(), stop: vi.fn(), setVideoSource: vi.fn(), registerMoveDetector: vi.fn(), unregisterMoveDetector: vi.fn(), ...over });

describe('InvadersPoseBridge', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('registers the tracker as a move detector and removes it on unmount', () => {
    poseApi.value = api();
    const tracker = { processPoses: vi.fn() };
    const view = render(<InvadersPoseBridge tracker={tracker} enabled onStatus={vi.fn()} />);
    expect(poseApi.value.registerMoveDetector).toHaveBeenCalledWith(expect.objectContaining({ id: 'skyline-invaders-aim', processPoses: tracker.processPoses }));
    view.unmount();
    expect(poseApi.value.unregisterMoveDetector).toHaveBeenCalledWith('skyline-invaders-aim');
  });
  it('reports loading, then detecting, and only on a state change', () => {
    const onStatus = vi.fn();
    poseApi.value = api({ isLoading: true });
    const view = render(<InvadersPoseBridge tracker={{ processPoses() {} }} enabled onStatus={onStatus} />);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'loading' }));
    poseApi.value = api({ isDetecting: true, fps: 24 });
    view.rerender(<InvadersPoseBridge tracker={{ processPoses() {} }} enabled onStatus={onStatus} />);
    view.rerender(<InvadersPoseBridge tracker={{ processPoses() {} }} enabled onStatus={onStatus} />);
    expect(onStatus.mock.calls.filter(([s]) => s.state === 'detecting')).toHaveLength(1);
  });
  it('repeats the metrics while detecting, no more than once per five seconds', () => {
    const onStatus = vi.fn();
    poseApi.value = api({ isDetecting: true, fps: 13 });
    const view = render(<InvadersPoseBridge tracker={{ processPoses() {} }} enabled onStatus={onStatus} />);
    vi.advanceTimersByTime(4000);
    view.rerender(<InvadersPoseBridge tracker={{ processPoses() {} }} enabled onStatus={onStatus} />);
    expect(onStatus).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    poseApi.value = api({ isDetecting: true, fps: 12 });
    view.rerender(<InvadersPoseBridge tracker={{ processPoses() {} }} enabled onStatus={onStatus} />);
    expect(onStatus).toHaveBeenCalledTimes(2);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'detecting', fps: 12 }));
  });
  it('hands the video to the detector and starts once the stream is ready', () => {
    poseApi.value = api();
    const view = render(<InvadersPoseBridge tracker={{ processPoses() {} }} enabled onStatus={vi.fn()} />);
    fireEvent.click(view.getByTestId('cam'));
    expect(poseApi.value.setVideoSource).toHaveBeenCalledWith(video.el);
    act(() => { vi.advanceTimersByTime(250); });
    expect(poseApi.value.start).toHaveBeenCalledTimes(1);
  });
  it('does not start after it has unmounted', () => {
    poseApi.value = api();
    const view = render(<InvadersPoseBridge tracker={{ processPoses() {} }} enabled onStatus={vi.fn()} />);
    fireEvent.click(view.getByTestId('cam'));
    view.unmount();
    vi.advanceTimersByTime(250);
    expect(poseApi.value.start).not.toHaveBeenCalled();
  });
  it('reports a denied camera instead of throwing', () => {
    const onStatus = vi.fn();
    poseApi.value = api();
    const view = render(<InvadersPoseBridge tracker={{ processPoses() {} }} enabled onStatus={onStatus} />);
    fireEvent.doubleClick(view.getByTestId('cam'));
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'camera-denied' }));
  });
  it('reports a detector error with its message, whatever shape the error has', () => {
    const onStatus = vi.fn();
    poseApi.value = api({ error: 'model failed to load' });
    render(<InvadersPoseBridge tracker={{ processPoses() {} }} enabled onStatus={onStatus} />);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'error', error: 'model failed to load' }));
  });
  it('stops detection when disabled', () => {
    poseApi.value = api({ isDetecting: true });
    render(<InvadersPoseBridge tracker={{ processPoses() {} }} enabled={false} onStatus={vi.fn()} />);
    expect(poseApi.value.stop).toHaveBeenCalled();
  });
  it('starts again when re-enabled after the stream was already ready', () => {
    const shared = api();
    poseApi.value = shared;
    const tracker = { processPoses() {} };
    const view = render(<InvadersPoseBridge tracker={tracker} enabled onStatus={vi.fn()} />);
    fireEvent.click(view.getByTestId('cam'));
    act(() => { vi.advanceTimersByTime(250); });
    view.rerender(<InvadersPoseBridge tracker={tracker} enabled={false} onStatus={vi.fn()} />);
    expect(shared.stop).toHaveBeenCalledTimes(1);
    view.rerender(<InvadersPoseBridge tracker={tracker} enabled onStatus={vi.fn()} />);
    expect(shared.start).toHaveBeenCalledTimes(2);
  });
});
