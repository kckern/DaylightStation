import { describe, it, expect, vi } from 'vitest';

vi.mock("../../../../../__capabilities/music-notation/browser/renderers/osmdRender.js", () => ({
  extractPerStaffGeometry: () => [0, 1].map((system) => ({ system, staff: 0, top: system * 100, left: 0, right: 400, lineSpacing: 5 })),
}));
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ buildHeaders: () => ({ 'X-Test': 'h' }) }));

import { generateMissingPosters, uploadPoster } from './posterJob.js';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">${
  [0, 1].map((i) => `<g class="staffline"><path d="M0 ${i * 100}L400 ${i * 100}"/></g>`).join('')}</svg>`;

/** An engrave that paints SVG into the host and records how many run at once. */
function fakeEngrave({ failFor = [] } = {}) {
  const state = { active: 0, maxActive: 0, calls: [] };
  const engrave = vi.fn(async (host, xml, opts) => {
    state.calls.push({ xml, opts });
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    await new Promise((r) => setTimeout(r, 1));
    state.active -= 1;
    if (failFor.includes(xml)) throw new Error('vexflow exploded');
    if (opts.shouldAbort()) return null;
    host.innerHTML = SVG;
    return { osmd: {} };
  });
  return { engrave, state };
}

const rows = ['a', 'b', 'c'].map((n) => ({ id: `files:docs/sheet-music/x/${n}.musicxml` }));
const xmlFor = (id) => `xml:${id}`;

describe('generateMissingPosters', () => {
  it('engraves and uploads one score at a time, never two at once', async () => {
    const host = document.createElement('div');
    const { engrave, state } = fakeEngrave();
    const upload = vi.fn(async () => ({ ok: true, result: {} }));
    const progress = [];
    const result = await generateMissingPosters({
      rows, host, fetchXml: async (id) => xmlFor(id), engrave, upload, onProgress: (p) => progress.push(p.index),
    });
    expect(result).toEqual({ saved: rows.map((r) => r.id), failed: [], cancelled: false });
    expect(state.maxActive).toBe(1);
    expect(upload.mock.calls.map(([id]) => id)).toEqual(rows.map((r) => r.id));
    expect(upload.mock.calls[0][1]).toContain('data-daylight-poster="generated"');
    expect(state.calls[0].opts).toMatchObject({ flow: 'wrapped', width: 1000, scale: 0.8 });
    expect(progress).toEqual([0, 1, 2, 3]);
    expect(host.innerHTML).toBe('');
  });

  it('records each failure and carries on', async () => {
    const host = document.createElement('div');
    const { engrave } = fakeEngrave({ failFor: [xmlFor(rows[0].id)] });
    const upload = vi.fn(async (id) => (id === rows[2].id ? { ok: false, code: 'has-scan', status: 409 } : { ok: true }));
    const fetchXml = async (id) => {
      if (id === rows[1].id) throw new Error('HTTP 404');
      return xmlFor(id);
    };
    const result = await generateMissingPosters({ rows, host, fetchXml, engrave, upload });
    expect(result.saved).toEqual([]);
    expect(result.failed).toEqual([
      { id: rows[0].id, code: 'engrave-failed' },
      { id: rows[1].id, code: 'no-xml' },
      { id: rows[2].id, code: 'has-scan' },
    ]);
  });

  it('stops between scores when cancelled', async () => {
    const host = document.createElement('div');
    const { engrave } = fakeEngrave();
    let cancelled = false;
    const upload = vi.fn(async () => { cancelled = true; return { ok: true }; });
    const result = await generateMissingPosters({
      rows, host, fetchXml: async (id) => xmlFor(id), engrave, upload, isCancelled: () => cancelled,
    });
    expect(result).toEqual({ saved: [rows[0].id], failed: [], cancelled: true });
    expect(engrave).toHaveBeenCalledTimes(1);
  });
});

describe('uploadPoster', () => {
  it('posts the svg text with the svg content type and maps a refusal', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ error: 'script' }) }));
    const outcome = await uploadPoster('files:docs/sheet-music/x/a b.musicxml', '<svg/>');
    expect(outcome).toEqual({ ok: false, code: 'script', status: 422 });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`/api/v1/admin/sheet-music/poster?id=${encodeURIComponent('files:docs/sheet-music/x/a b.musicxml')}`);
    expect(init).toMatchObject({ method: 'POST', body: '<svg/>', headers: { 'X-Test': 'h', 'Content-Type': 'image/svg+xml' } });
  });

  it('reports a network failure', async () => {
    global.fetch = vi.fn(async () => { throw new Error('offline'); });
    expect(await uploadPoster('files:docs/sheet-music/x/a.musicxml', '<svg/>')).toMatchObject({ ok: false, code: 'network' });
  });
});
