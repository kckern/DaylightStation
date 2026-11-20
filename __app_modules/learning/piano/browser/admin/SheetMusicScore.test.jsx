import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const api = vi.fn();
const apiText = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({
  DaylightAPI: (...a) => api(...a),
  DaylightAPIText: (...a) => apiText(...a),
}));
const logged = [];
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const rec = (level) => (event, data) => logged.push({ level, event, data });
  return { default: () => ({ child: () => ({ info: rec('info'), debug: rec('debug'), warn: rec('warn'), error: rec('error') }) }) };
});

// Eight bars, two onsets each; the left hand (staff 1) only plays in bars 5-8.
const STEPS = Array.from({ length: 16 }, (_, i) => {
  const measure = Math.floor(i / 2);
  const notes = [{ midi: 60 + measure, staff: 0 }];
  if (measure >= 4) notes.push({ midi: 48, staff: 1 });
  return { measure, number: measure + 1, onsetQuarter: i * 2, notes };
});
const osmdRender = vi.fn();
vi.mock("../../../../../__capabilities/music-notation/browser/renderers/osmdRender.js", async () => {
  const actual = await vi.importActual("../../../../../__capabilities/music-notation/browser/renderers/osmdRender.js");
  return {
    osmdRender: (...a) => osmdRender(...a),
    buildMeasures: actual.buildMeasures,
    extractMeasureBounds: () => Array.from({ length: 8 }, (_, i) => ({ left: i * 50, right: i * 50 + 50, top: 0, bottom: 40 })),
  };
});
vi.mock("../../../../../__capabilities/music-notation/browser/parseMusicXml.js", () => ({
  parseMusicXml: () => ({ sections: [], tempo: 96 }),
}));

import { SheetMusicScore } from "./index.js";

const ID = 'files:docs/sheet-music/classical/fur-elise.musicxml';
const Q = `?id=${encodeURIComponent(ID)}`;
const LEARN_URL = `api/v1/admin/sheet-music/learn${Q}`;

const learnFile = (over = {}) => ({
  version: 1, scoreId: ID, contentSha256: null, segments: [], approved: null, draft: null,
  currentSha256: 'sha-now', stale: false, draftRevision: null, ...over,
});

let learn;
function route(path, data, method) {
  if (path === LEARN_URL && (method === undefined || method === 'GET')) return Promise.resolve(learn);
  if (path === 'api/v1/admin/apps/piano/config') return Promise.resolve({ parsed: {} });
  if (path === LEARN_URL && method === 'PUT' && data.action === 'draft') {
    learn = learnFile({ ...learn, draft: { segments: data.segments, proposal: data.proposal }, draftRevision: 'rev-new' });
    return Promise.resolve({ ...learn });
  }
  if (path === `api/v1/admin/sheet-music/learn/draft-impact${Q}`) return Promise.resolve({ draftRevision: 'rev-new', impact: [] });
  return Promise.reject(new Error(`unexpected ${method || 'GET'} ${path}`));
}

const renderPage = () => render(
  <MantineProvider>
    <MemoryRouter initialEntries={[`/admin/content/sheet-music/view/${ID}`]}>
      <Routes>
        <Route path="/admin/content/sheet-music/view/*" element={<SheetMusicScore />} />
      </Routes>
    </MemoryRouter>
  </MantineProvider>,
);

const engravedReady = () => waitFor(() => expect(screen.queryByTestId('score-loading')).toBeNull());
const putCalls = () => api.mock.calls.filter(([, , method]) => method === 'PUT');

beforeEach(() => {
  api.mockReset(); apiText.mockReset(); osmdRender.mockReset(); logged.length = 0;
  learn = learnFile();
  api.mockImplementation(route);
  apiText.mockResolvedValue('<score-partwise/>');
  osmdRender.mockResolvedValue({ steps: STEPS, osmd: {}, tempoEntries: [{ onsetQuarter: 0, bpm: 96 }], width: 400, height: 200 });
});
afterEach(cleanup);

describe('SheetMusicScore', () => {
  it('engraves the kiosk way and shows the generated plan when nothing is saved', async () => {
    renderPage();
    await engravedReady();
    expect(apiText).toHaveBeenCalledWith(`api/v1/proxy/media/stream/${encodeURIComponent('docs/sheet-music/classical/fur-elise.musicxml')}`);
    expect(osmdRender.mock.calls[0][2]).toMatchObject({ flow: 'wrapped', scale: 0.8 });
    const strip = await screen.findByTestId('measure-strip-generated');
    expect(within(strip).getByText('Generated segments (what the kiosk plays now)')).toBeTruthy();
    expect(within(strip).getAllByRole('img').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Revert to generated' })).toBeNull();
    expect(logged.find((l) => l.event === 'admin.sheetmusic.engraved')?.data).toMatchObject({ measures: 8 });
    expect(logged.some((l) => l.event === 'admin.sheetmusic.score-mounted')).toBe(true);
  });

  it('fills each segment\'s parts from the kiosk plan before saving', async () => {
    learn = learnFile({ segments: [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7, name: 'Second' }], approved: { at: 't' }, contentSha256: 'sha-now' });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'Revert to generated' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(putCalls().length).toBe(1));
    const [path, body] = putCalls()[0];
    expect(path).toBe(LEARN_URL);
    expect(body).toMatchObject({
      action: 'draft',
      measureCount: 8,
      segments: [
        { id: 'a', start: 0, end: 3, parts: ['rh'] },
        { id: 'b', start: 4, end: 7, name: 'Second', parts: ['rh', 'lh'] },
      ],
      proposal: { scorer: 'manual' },
    });
    await waitFor(() => expect(logged.some((l) => l.event === 'admin.sheetmusic.draft-saved')).toBe(true));
  });

  it('approve saves the draft first, then reviews its impact', async () => {
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 7 }] }, draftRevision: 'rev-old' });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText('No learner has progress on this score.')).toBeTruthy());
    expect(putCalls()[0][1].segments).toEqual([{ id: 'a', start: 0, end: 7, parts: ['rh', 'lh'] }]);
  });

  it('shows validation errors live and disables Save and Approve', async () => {
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 4, end: 7 }] }, draftRevision: 'r' });
    renderPage();
    await engravedReady();
    const errors = await screen.findByTestId('segment-errors');
    expect(within(errors).getByText('Segment b overlaps another segment.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save draft' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Approve' }).disabled).toBe(true);
  });

  it('shows a whole-form error for an empty draft', async () => {
    learn = learnFile({ draft: { segments: [] }, draftRevision: 'r' });
    renderPage();
    await engravedReady();
    expect(within(await screen.findByTestId('form-errors')).getByText('Add at least one segment before saving.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save draft' }).disabled).toBe(true);
  });

  it('shows the stale banner', async () => {
    learn = learnFile({ segments: [{ id: 'a', start: 0, end: 7 }], approved: { at: 't' }, contentSha256: 'sha-old', stale: true });
    renderPage();
    expect(await screen.findByTestId('stale-banner')).toBeTruthy();
  });

  it('reloads and says so when the server reports the draft changed', async () => {
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 7 }] }, draftRevision: 'r' });
    api.mockImplementation((path, data, method) => {
      if (method === 'PUT') return Promise.reject(Object.assign(new Error('HTTP 409'), { status: 409, body: { error: 'draft-changed' } }));
      return route(path, data, method);
    });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/The draft changed in another tab/)).toBeTruthy();
    expect(logged.find((l) => l.event === 'admin.sheetmusic.save-failed')?.data).toMatchObject({ code: 'draft-changed' });
  });
});
