import { describe, it, expect, vi } from 'vitest';
import { transcriptRecorder } from './TranscriptRecorder.mjs';

function makeTool(execImpl) {
  return {
    name: 'foo',
    description: 'd',
    parameters: { type: 'object' },
    execute: vi.fn(execImpl ?? (async () => ({ ok: true }))),
  };
}

function makeFakeTranscript() {
  return {
    calls: [],
    recordTool(entry) { this.calls.push(entry); },
  };
}

describe('transcriptRecorder decorator', () => {
  it('records a tool call on success', async () => {
    const transcript = makeFakeTranscript();
    const wrapped = transcriptRecorder(makeTool(), { transcript });
    await wrapped.execute({ x: 1 });
    expect(transcript.calls).toHaveLength(1);
    expect(transcript.calls[0]).toMatchObject({
      name: 'foo',
      args: { x: 1 },
      ok: true,
    });
    expect(transcript.calls[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records ok=false when result has an "error" key', async () => {
    const transcript = makeFakeTranscript();
    const wrapped = transcriptRecorder(makeTool(async () => ({ error: 'oops' })), { transcript });
    await wrapped.execute({});
    expect(transcript.calls[0].ok).toBe(false);
  });

  it('records and returns error envelope when execute throws', async () => {
    const transcript = makeFakeTranscript();
    const tool = makeTool(async () => { throw new Error('boom'); });
    const wrapped = transcriptRecorder(tool, { transcript });
    const result = await wrapped.execute({ x: 1 });
    expect(result).toEqual({ error: 'boom' });
    expect(transcript.calls).toHaveLength(1);
    expect(transcript.calls[0].ok).toBe(false);
    expect(transcript.calls[0].result).toEqual({ error: 'boom' });
  });

  it('is a no-op when transcript is null', async () => {
    const wrapped = transcriptRecorder(makeTool(), { transcript: null });
    const r = await wrapped.execute({});
    expect(r.ok).toBe(true);
  });

  it('is a no-op when transcript is undefined', async () => {
    const wrapped = transcriptRecorder(makeTool(), {});
    const r = await wrapped.execute({});
    expect(r.ok).toBe(true);
  });

  it('passes through context to the underlying tool', async () => {
    const tool = makeTool();
    const transcript = makeFakeTranscript();
    const wrapped = transcriptRecorder(tool, { transcript, userId: 'kc' });
    await wrapped.execute({}, { foo: 'bar' });
    expect(tool.execute).toHaveBeenCalledWith({}, { foo: 'bar' });
  });
});
