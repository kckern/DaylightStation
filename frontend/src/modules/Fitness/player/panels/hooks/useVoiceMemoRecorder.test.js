import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import useVoiceMemoRecorder from './useVoiceMemoRecorder.js';

vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({ ok: true, memo: { memoId: 'test-memo' } }))
}));

vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitness: () => ({ currentMedia: null, recentlyPlayed: [], fitnessSessionInstance: null, householdId: 'hh' })
}));

vi.mock('@/modules/Player/lib/playbackLogger.js', () => ({
  playbackLog: vi.fn()
}));

class MockMediaRecorder {
  constructor(stream) {
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.stream = stream;
    MockMediaRecorder.instances.push(this);
  }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    // Per-spec, MediaRecorder fires ondataavailable + onstop asynchronously.
    // We do NOT fire them here — the test fires them explicitly, exercising the
    // race where cleanup runs before onstop arrives.
  }
  fireStop() {
    this.ondataavailable?.({ data: new Blob(['chunk'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
  addEventListener(evt, cb) { this['on' + evt] = cb; }
}
MockMediaRecorder.instances = [];

// Capture the hook's API from a test host component so we can poke it from tests.
function Host({ apiRef }) {
  const api = useVoiceMemoRecorder({ sessionId: 'sess-1', onMemoCaptured: () => {} });
  apiRef.current = api;
  return null;
}

describe('useVoiceMemoRecorder cancel flow (race with overlay unmount)', () => {
  beforeEach(() => {
    MockMediaRecorder.instances = [];
    global.MediaRecorder = MockMediaRecorder;
    global.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }]
      })
    };
    global.AudioContext = class {
      createAnalyser() { return { fftSize: 0, frequencyBinCount: 0, getByteTimeDomainData: () => {}, connect: () => {} }; }
      createMediaStreamSource() { return { connect: () => {} }; }
      close() {}
    };
    // happy-dom's FileReader does not reliably fire onloadend for Blobs;
    // provide a minimal synchronous stub so blobToBase64 resolves.
    global.FileReader = class {
      constructor() { this.result = null; this.onloadend = null; this.onerror = null; }
      readAsDataURL(blob) {
        this.result = `data:${blob.type};base64,Y2h1bms=`;
        queueMicrotask(() => this.onloadend?.());
      }
    };
  });

  it('does NOT upload audio when user cancels and overlay unmounts before onstop fires', async () => {
    const { DaylightAPI } = await import('@/lib/api.mjs');
    DaylightAPI.mockClear();

    const apiRef = { current: null };
    const { unmount } = render(React.createElement(Host, { apiRef }));

    // 1. Start recording — createsMediaRecorder mock
    await act(async () => { await apiRef.current.startRecording(); });
    expect(MockMediaRecorder.instances.length).toBe(1);
    const recorder = MockMediaRecorder.instances[0];

    // 2. User clicks X: overlay calls cancelUpload, then stopRecording, then onClose.
    //    We simulate the first two here; onClose → unmount is next.
    act(() => { apiRef.current.cancelUpload(); });
    act(() => { apiRef.current.stopRecording(); });

    // 3. Overlay's onClose fires → component unmounts → cleanup effect runs.
    unmount();

    // 4. NOW the MediaRecorder finally dispatches its queued onstop event (real-world async).
    await act(async () => {
      recorder.fireStop();
      // Let any microtasks settle
      await Promise.resolve();
    });

    // 5. The upload must NOT have happened. The cancelledRef must survive the unmount cleanup.
    expect(DaylightAPI).not.toHaveBeenCalled();
  });
  it('records again after closing a failed upload without inheriting cancellation', async () => {
    const { DaylightAPI } = await import('@/lib/api.mjs');
    DaylightAPI.mockReset().mockRejectedValueOnce(new Error('HTTP 429')).mockResolvedValue({ ok: true, memo: { memoId: 'recovered' } });
    const apiRef = { current: null };
    render(React.createElement(Host, { apiRef }));
    await act(async () => { await apiRef.current.startRecording(); });
    act(() => apiRef.current.stopRecording());
    await act(async () => MockMediaRecorder.instances[0].fireStop());
    await waitFor(() => expect(apiRef.current.hasAudioBlob).toBe(true));
    act(() => apiRef.current.cancelUpload());
    await act(async () => { await apiRef.current.startRecording(); });
    act(() => apiRef.current.stopRecording());
    await act(async () => MockMediaRecorder.instances[1].fireStop());
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(2));
  });

  it('ignores an old cancelled recorder when its stop arrives during a new recording', async () => {
    const { DaylightAPI } = await import('@/lib/api.mjs');
    DaylightAPI.mockReset().mockResolvedValue({ ok: true, memo: { memoId: 'fresh' } });
    const apiRef = { current: null };
    render(React.createElement(Host, { apiRef }));
    await act(async () => { await apiRef.current.startRecording(); });
    const old = MockMediaRecorder.instances[0];
    act(() => { apiRef.current.cancelUpload(); apiRef.current.stopRecording(); });
    await act(async () => { await apiRef.current.startRecording(); });
    await act(async () => old.fireStop());
    expect(DaylightAPI).not.toHaveBeenCalled();
    act(() => apiRef.current.stopRecording());
    await act(async () => MockMediaRecorder.instances[1].fireStop());
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(1));
  });

  // The backend stores the capture before it calls the provider, so a 502 from
  // the voice-memo route means "transcription failed", not "your memo is gone".
  // The hook has to carry that distinction to the UI, and the only place the
  // artifact lives is the error body DaylightAPI folds into its message.
  it('surfaces the durable artifact behind a failed transcription', async () => {
    const { DaylightAPI } = await import('@/lib/api.mjs');
    const body = JSON.stringify({
      ok: false,
      error: 'Transcription failed; the recording is saved and will be retried',
      artifact: { ref: 'vm_abcdefghijklmnop', state: 'retryable', audioAvailable: true },
    });
    const failure = Object.assign(new Error(`HTTP 502: Bad Gateway - ${body}`), { status: 502 });
    DaylightAPI.mockReset().mockRejectedValue(failure);

    const apiRef = { current: null };
    render(React.createElement(Host, { apiRef }));
    await act(async () => { await apiRef.current.startRecording(); });
    act(() => apiRef.current.stopRecording());
    await act(async () => MockMediaRecorder.instances[0].fireStop());

    await waitFor(() => expect(apiRef.current.savedArtifact).not.toBeNull());
    expect(apiRef.current.savedArtifact.ref).toBe('vm_abcdefghijklmnop');
    expect(apiRef.current.error.artifact.state).toBe('retryable');
    // The message the person reads must not imply the recording was lost.
    expect(apiRef.current.error.message).toMatch(/saved/i);
    expect(apiRef.current.error.retryable).toBe(true);
  });

  it('forgets a previous artifact when a new recording starts', async () => {
    const { DaylightAPI } = await import('@/lib/api.mjs');
    const body = JSON.stringify({ ok: false, artifact: { ref: 'vm_abcdefghijklmnop', state: 'retryable' } });
    DaylightAPI.mockReset().mockRejectedValue(Object.assign(new Error(`HTTP 502: Bad Gateway - ${body}`), { status: 502 }));

    const apiRef = { current: null };
    render(React.createElement(Host, { apiRef }));
    await act(async () => { await apiRef.current.startRecording(); });
    act(() => apiRef.current.stopRecording());
    await act(async () => MockMediaRecorder.instances[0].fireStop());
    await waitFor(() => expect(apiRef.current.savedArtifact).not.toBeNull());

    await act(async () => { await apiRef.current.startRecording(); });
    expect(apiRef.current.savedArtifact).toBeNull();
  });

  it('reports a plain network failure without inventing a saved recording', async () => {
    const { DaylightAPI } = await import('@/lib/api.mjs');
    DaylightAPI.mockReset().mockRejectedValue(new Error('Failed to fetch'));

    const apiRef = { current: null };
    render(React.createElement(Host, { apiRef }));
    await act(async () => { await apiRef.current.startRecording(); });
    act(() => apiRef.current.stopRecording());
    await act(async () => MockMediaRecorder.instances[0].fireStop());

    await waitFor(() => expect(apiRef.current.error).not.toBeNull());
    expect(apiRef.current.savedArtifact).toBeNull();
    expect(apiRef.current.error.artifact).toBeNull();
  });

  it('ignores cancelled recorder events while the next microphone request is pending', async () => {
    const { DaylightAPI } = await import('@/lib/api.mjs');
    DaylightAPI.mockReset().mockResolvedValue({ ok: true, memo: { memoId: 'fresh' } });
    const apiRef = { current: null };
    render(React.createElement(Host, { apiRef }));
    await act(async () => { await apiRef.current.startRecording(); });
    const old = MockMediaRecorder.instances[0];
    act(() => { apiRef.current.cancelUpload(); apiRef.current.stopRecording(); });
    let resolveMicrophone;
    navigator.mediaDevices.getUserMedia.mockImplementationOnce(() => new Promise(resolve => { resolveMicrophone = resolve; }));
    let nextStart;
    act(() => { nextStart = apiRef.current.startRecording(); });
    await act(async () => old.fireStop());
    expect(DaylightAPI).not.toHaveBeenCalled();
    await act(async () => { resolveMicrophone({ getTracks: () => [{ stop: vi.fn() }] }); await nextStart; });
    act(() => apiRef.current.stopRecording());
    await act(async () => MockMediaRecorder.instances[1].fireStop());
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(1));
  });

});
