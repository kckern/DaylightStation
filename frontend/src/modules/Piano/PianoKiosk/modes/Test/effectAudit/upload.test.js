// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadClip, uploadManifest, API_BASE } from './upload.js';

beforeEach(() => { global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })); });

describe('uploadClip', () => {
  it('POSTs the blob to the clip endpoint with audio/webm', async () => {
    const blob = { size: 10 };
    await uploadClip('run1', '00-control', blob);
    expect(global.fetch).toHaveBeenCalledWith(
      `${API_BASE}/effect-audit/run1/clip/00-control`,
      expect.objectContaining({ method: 'POST', body: blob }),
    );
    expect(global.fetch.mock.calls[0][1].headers['Content-Type']).toBe('audio/webm');
  });
  it('throws on a non-ok response', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
    await expect(uploadClip('run1', 'x', {})).rejects.toThrow(/500/);
  });
});

describe('uploadManifest', () => {
  it('POSTs JSON to the manifest endpoint', async () => {
    await uploadManifest('run1', { clips: [] });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/effect-audit/run1/manifest`);
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ clips: [] });
  });
});
