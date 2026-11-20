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
import { scoreViewPath } from "../PianoKiosk/modes/SheetMusic/sheetMusicModel.js";

const DEFAULT_ID = 'files:docs/sheet-music/classical/fur-elise.musicxml';
let ID = DEFAULT_ID;
const q = () => `?id=${encodeURIComponent(ID)}`;
const learnUrl = () => `api/v1/admin/sheet-music/learn${q()}`;

const learnFile = (over = {}) => ({
  version: 1, scoreId: ID, contentSha256: null, segments: [], approved: null, draft: null,
  currentSha256: 'sha-now', stale: false, draftRevision: null, ...over,
});

let learn;
let pianoConfig;
function route(path, data, method) {
  if (path === learnUrl() && (method === undefined || method === 'GET')) return Promise.resolve(learn);
  if (path === 'api/v1/admin/apps/piano/config') return Promise.resolve({ parsed: pianoConfig });
  if (path === learnUrl() && method === 'PUT' && data.action === 'draft') {
    learn = learnFile({ ...learn, draft: { segments: data.segments, proposal: data.proposal }, draftRevision: 'rev-new' });
    return Promise.resolve({ ...learn });
  }
  if (path === `api/v1/admin/sheet-music/learn/draft-impact${q()}`) return Promise.resolve({ draftRevision: learn.draftRevision, impact: [] });
  return Promise.reject(new Error(`unexpected ${method || 'GET'} ${path}`));
}

const renderPage = () => render(
  <MantineProvider>
    <MemoryRouter initialEntries={[`/admin/content/sheet-music/${scoreViewPath(ID)}`]}>
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
  ID = DEFAULT_ID;
  learn = learnFile();
  pianoConfig = {};
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
    expect(path).toBe(learnUrl());
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

  it('approve on an unchanged stored draft reviews it without saving again', async () => {
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 7, parts: ['rh', 'lh'] }] }, draftRevision: 'rev-old' });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText('No learner has progress on this score.')).toBeTruthy());
    expect(putCalls()).toEqual([]);
  });

  it('approve re-saves an unchanged draft whose stored parts no longer match the score', async () => {
    // Written elsewhere (or against older XML): segment b claims only the right hand.
    learn = learnFile({
      draft: { segments: [{ id: 'a', start: 0, end: 3, parts: ['rh'] }, { id: 'b', start: 4, end: 7, parts: ['rh'] }] },
      draftRevision: 'rev-old',
    });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText('No learner has progress on this score.')).toBeTruthy());
    expect(putCalls()).toHaveLength(1);
    expect(putCalls()[0][1].segments).toEqual([
      { id: 'a', start: 0, end: 3, parts: ['rh'] },
      { id: 'b', start: 4, end: 7, parts: ['rh', 'lh'] },
    ]);
  });

  it('approve re-saves an unchanged draft that has no parts at all', async () => {
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 7 }] }, draftRevision: 'rev-old' });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText('No learner has progress on this score.')).toBeTruthy());
    expect(putCalls()[0][1].segments).toEqual([{ id: 'a', start: 0, end: 7, parts: ['rh', 'lh'] }]);
  });

  it('approve after an edit saves the draft first, then reviews its impact', async () => {
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 7 }] }, draftRevision: 'rev-old' });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Split after bar 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText('No learner has progress on this score.')).toBeTruthy());
    expect(putCalls()[0][1].segments).toEqual([
      { id: 'a', start: 0, end: 3, parts: ['rh'] },
      { id: 'b', start: 4, end: 7, parts: ['rh', 'lh'] },
    ]);
  });

  it('re-ids generated segments a, b, c when editing starts from them', async () => {
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(putCalls().length).toBe(1));
    const ids = putCalls()[0][1].segments.map((seg) => seg.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(ids.map((_, i) => String.fromCharCode(97 + i)));
  });

  it('shows validation errors live and disables Save and Approve', async () => {
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 4, end: 7 }] }, draftRevision: 'r' });
    renderPage();
    await engravedReady();
    const errors = await screen.findByTestId('segment-errors');
    expect(within(errors).getByText('Segment 2 overlaps another segment.')).toBeTruthy();
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

  it('reloads and says so when approval finds the draft changed in another tab', async () => {
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 7, parts: ['rh', 'lh'] }] }, draftRevision: 'rev-seen' });
    api.mockImplementation((path, data, method) => {
      if (method === 'PUT' && data.action === 'approve') {
        return Promise.reject(Object.assign(new Error('HTTP 409'), { status: 409, body: { error: 'draft-changed', draftRevision: 'rev-other' } }));
      }
      return route(path, data, method);
    });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('No learner has progress on this score.')).toBeTruthy());
    const learnReads = () => api.mock.calls.filter(([path, , method]) => path === learnUrl() && method === undefined).length;
    const readsBefore = learnReads();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/The draft changed in another tab/)).toBeTruthy();
    expect(putCalls().map(([, body]) => body)).toEqual([{ action: 'approve', measureCount: 8, expectedDraftRevision: 'rev-seen' }]);
    await waitFor(() => expect(learnReads()).toBeGreaterThan(readsBefore));
  });

  it('maps layout positions to engraved bars through measures[i].index', async () => {
    // Source bar 2 is all rests (no onsets, so no layout position) and bar 1 repeats:
    // layout positions 0..3 are source bars 0, 1, 3, 1.
    const steps = [0, 0, 1, 1, 3, 3, 1, 1].map((measure, i) => ({ measure, number: measure + 1, onsetQuarter: i, notes: [{ midi: 60, staff: 0 }] }));
    osmdRender.mockResolvedValue({ steps, osmd: {}, tempoEntries: [], width: 400, height: 200 });
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 3 }] }, draftRevision: 'r' });
    renderPage();
    await engravedReady();
    await screen.findByTestId('measure-strip-draft');
    const lefts = [...screen.getByTestId('score-overlay').querySelectorAll('.sm-score__box--draft')].map((el) => el.style.left);
    expect(lefts).toEqual(['0px', '50px', '150px', '50px']);
    const cells = [...document.querySelectorAll('[data-measure-cell]')].map((el) => el.textContent);
    expect(cells).toEqual(['1', '2', '4', '2']);
  });

  it('opens a score whose id holds #, ? and %', async () => {
    ID = 'files:docs/sheet-music/classical/odd #1 ?50%.musicxml';
    renderPage();
    await engravedReady();
    expect(apiText).toHaveBeenCalledWith(`api/v1/proxy/media/stream/${encodeURIComponent('docs/sheet-music/classical/odd #1 ?50%.musicxml')}`);
    expect(api).toHaveBeenCalledWith(`api/v1/admin/sheet-music/learn?id=${encodeURIComponent(ID)}`);
    expect(await screen.findByTestId('measure-strip-generated')).toBeTruthy();
  });

  it('warns when household config sets this piece\'s segments', async () => {
    pianoConfig = { sheetmusic: { learn: { pieces: { [DEFAULT_ID]: { segments: [{ id: 'x', start: 0, end: 7 }] } } } } };
    renderPage();
    expect(await screen.findByTestId('piece-override')).toBeTruthy();
  });

  it('reads sheetmusic.learn the way the kiosk resolves a single configured piano', async () => {
    pianoConfig = {
      sheetmusic: { learn: {} },
      pianos: { 'piano-one': { sheetmusic: { learn: { pieces: { [DEFAULT_ID]: { segments: [{ id: 'x', start: 0, end: 7 }] } } } } } },
    };
    renderPage();
    expect(await screen.findByTestId('piece-override')).toBeTruthy();
  });
});
