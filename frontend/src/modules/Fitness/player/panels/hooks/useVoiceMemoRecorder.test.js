import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
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
});
