import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLoopLibrary } from './useLoopLibrary.js';

const attrs = '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const brickXml = `<x><measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></x>`;

describe('useLoopLibrary', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      if (url.includes('/loop-manifest')) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ bricks: [{ path: 'chords/a.musicxml', type: 'chord-progression', tags: ['lofi'] }] })), json: () => Promise.resolve({ bricks: [{ path: 'chords/a.musicxml', type: 'chord-progression', tags: ['lofi'] }] }) });
      }
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), text: () => Promise.resolve(brickXml) });
    });
  });

  it('loads the manifest bricks as loops', async () => {
    const { result } = renderHook(() => useLoopLibrary());
    await waitFor(() => expect(result.current.loops).not.toBeNull());
    expect(result.current.loops).toHaveLength(1);
    expect(result.current.loops[0].path).toBe('chords/a.musicxml');
  });

  it('loadNotes fetches the .musicxml and parses it', async () => {
    const { result } = renderHook(() => useLoopLibrary());
    await waitFor(() => expect(result.current.loops).not.toBeNull());
    const parsed = await result.current.loadNotes({ path: 'chords/a.musicxml' });
    expect(parsed.ppq).toBe(4);
    expect(parsed.notes[0].midi).toBe(60);
    // second call is served from cache (no extra note fetch)
    const before = global.fetch.mock.calls.length;
    await result.current.loadNotes({ path: 'chords/a.musicxml' });
    expect(global.fetch.mock.calls.length).toBe(before);
  });

  it('encodes # (and other special chars) per path segment, not as a URI fragment', async () => {
    const { result } = renderHook(() => useLoopLibrary());
    await waitFor(() => expect(result.current.loops).not.toBeNull());
    await result.current.loadNotes({ path: 'chords/x-#iv.musicxml' });
    const noteFetchUrl = global.fetch.mock.calls
      .map(([url]) => url)
      .find((url) => url.includes('/local/stream/'));
    expect(noteFetchUrl).toBeDefined();
    expect(noteFetchUrl).toContain('%23');
    expect(noteFetchUrl).not.toContain('#');
  });
});
