import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import useDebugVoiceMemo from './useDebugVoiceMemo.js';

vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({
    ok: true,
    filename: '2026-04-23T15-22-09-123Z.webm',
    path: 'data/_debug/voice_memos/2026-04-23T15-22-09-123Z.webm',
    size: 5,
    savedAt: 1714000000000
  }))
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
  stop() { this.state = 'inactive'; }
  fireStop() {
    this.ondataavailable?.({ data: new Blob(['chunk'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}
MockMediaRecorder.instances = [];

function Host({ apiRef }) {
  const api = useDebugVoiceMemo();
  apiRef.current = api;
  return null;
}

describe('useDebugVoiceMemo', () => {
  beforeEach(() => {
    MockMediaRecorder.instances = [];
    global.MediaRecorder = MockMediaRecorder;
    global.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }]
      })
    };
    global.FileReader = class {
      constructor() { this.result = null; this.onloadend = null; this.onerror = null; }
      readAsDataURL(blob) {
        this.result = `data:${blob.type};base64,Y2h1bms=`;
        queueMicrotask(() => this.onloadend?.());
      }
    };
  });

  it('posts base64 audio to the debug endpoint after stopRecording', async () => {
    const { DaylightAPI } = await import('@/lib/api.mjs');
    DaylightAPI.mockClear();

    const apiRef = { current: null };
    render(React.createElement(Host, { apiRef }));

    await act(async () => { await apiRef.current.startRecording(); });
    expect(MockMediaRecorder.instances.length).toBe(1);
    const recorder = MockMediaRecorder.instances[0];

    act(() => { apiRef.current.stopRecording(); });

    await act(async () => {
      recorder.fireStop();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    const [pathArg, payloadArg, methodArg] = DaylightAPI.mock.calls[0];
    expect(pathArg).toBe('api/v1/fitness/debug/voice-memo');
    expect(methodArg).toBe('POST');
    expect(payloadArg).toHaveProperty('audioBase64');
    expect(payloadArg).toHaveProperty('mimeType', 'audio/webm');
    // Scope guarantee: no session metadata / context attached.
    expect(payloadArg).not.toHaveProperty('sessionId');
    expect(payloadArg).not.toHaveProperty('context');
    expect(payloadArg).not.toHaveProperty('startedAt');
    expect(payloadArg).not.toHaveProperty('endedAt');
  });

  it('exposes isRecording state that flips true during recording and false after stop', async () => {
    const apiRef = { current: null };
    render(React.createElement(Host, { apiRef }));

    expect(apiRef.current.isRecording).toBe(false);
    await act(async () => { await apiRef.current.startRecording(); });
    expect(apiRef.current.isRecording).toBe(true);
    act(() => { apiRef.current.stopRecording(); });
    expect(apiRef.current.isRecording).toBe(false);
  });
});
