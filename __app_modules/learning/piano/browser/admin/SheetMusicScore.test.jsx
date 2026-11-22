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
    extractMeasureMap: () => Array.from({ length: 8 }, (_, index) => ({ index, onsetQuarter: index * 4, durationQuarters: 4 })),
    extractPerStaffGeometry: () => [0, 1, 2].map((system) => ({ system, staff: 0, top: system * 100, left: 0, right: 400, lineSpacing: 5 })),
  };
});
const jevRequest = vi.fn();
const renderCrops = vi.fn();
vi.mock("./jevCrops.js", async () => {
  const actual = await vi.importActual("./jevCrops.js");
  return { ...actual, renderCrops: (...a) => renderCrops(...a), requestJevProposal: (...a) => jevRequest(...a) };
});
const uploadPoster = vi.fn();
vi.mock("./posterJob.js", async () => {
  const actual = await vi.importActual("./posterJob.js");
  return { ...actual, uploadPoster: (...a) => uploadPoster(...a) };
});
/** What OSMD leaves in the host: one staffline group per system. */
const ENGRAVED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 500 375">${
  [0, 1, 2].map((i) => `<g class="staffline"><path d="M0 ${i * 125}L500 ${i * 125}"/></g>`).join('')}</svg>`;
vi.mock("../../../../../__capabilities/music-notation/browser/parseMusicXml.js", () => ({
  parseMusicXml: () => ({ sections: [], tempo: 96 }),
}));

import { SheetMusicScore } from "./index.js";
import { seamBarlines } from "./SheetMusicScore.jsx";
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
  api.mockReset(); apiText.mockReset(); osmdRender.mockReset(); uploadPoster.mockReset(); logged.length = 0;
  jevRequest.mockReset(); renderCrops.mockReset();
  renderCrops.mockImplementation(async (svg, boxes) => new Map([...boxes.keys()].map((k) => [k, new Blob(['png'])])));
  ID = DEFAULT_ID;
  learn = learnFile();
  pianoConfig = {};
  api.mockImplementation(route);
  apiText.mockResolvedValue('<score-partwise/>');
  osmdRender.mockImplementation(async (host) => {
    host.innerHTML = ENGRAVED_SVG;
    return { steps: STEPS, osmd: {}, tempoEntries: [{ onsetQuarter: 0, bpm: 96 }], width: 400, height: 200 };
  });
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

  it('keeps local cuts and does not open approval when that save conflicts with a newer draft', async () => {
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 7 }] }, draftRevision: 'rev-seen' });
    api.mockImplementation((path, data, method) => {
      if (path === learnUrl() && method === 'PUT' && data.action === 'draft') {
        learn = learnFile({
          draft: { segments: [{ id: 'a', start: 0, end: 5 }, { id: 'b', start: 6, end: 7 }] },
          draftRevision: 'rev-other',
        });
        return Promise.reject(Object.assign(new Error('HTTP 409'), {
          status: 409, body: { error: 'draft-changed', draftRevision: 'rev-other' },
        }));
      }
      return route(path, data, method);
    });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Split after bar 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText(/another tab saved a newer draft/i)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Segment 1, Bars 1-4' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Segment 2, Bars 5-8' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load saved draft' })).toBeTruthy();
    expect(putCalls()[0][1]).toMatchObject({ action: 'draft', expectedDraftRevision: 'rev-seen' });
    expect(api.mock.calls.filter(([path]) => path === `api/v1/admin/sheet-music/learn/draft-impact${q()}`)).toHaveLength(0);
    expect(api.mock.calls.filter(([path, , method]) => path === learnUrl() && method === undefined)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Load saved draft' }));
    expect(await screen.findByRole('button', { name: 'Segment 1, Bars 1-6' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Segment 2, Bars 7-8' })).toBeTruthy();
  });

  it('locks segment editing until the saved draft has reloaded', async () => {
    let finishSave;
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 7 }] }, draftRevision: 'rev-old' });
    api.mockImplementation((path, data, method) => {
      if (path === learnUrl() && method === 'PUT' && data.action === 'draft') {
        return new Promise((resolve) => {
          finishSave = () => {
            learn = learnFile({ ...learn, draft: { segments: data.segments, proposal: data.proposal }, draftRevision: 'rev-new' });
            resolve({ ...learn });
          };
        });
      }
      return route(path, data, method);
    });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Split after bar 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(putCalls()).toHaveLength(1));

    expect(screen.queryByRole('button', { name: 'Split after bar 2' })).toBeNull();
    finishSave();
    await screen.findByText(/Draft saved/);

    expect(await screen.findByRole('button', { name: 'Split after bar 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move boundary after bar 4' })).toBeTruthy();
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

  it('proposes phrase segments into the draft and saves the proposal only on Save draft', async () => {
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Propose segments' }));
    const strip = await screen.findByTestId('measure-strip-draft');
    expect(strip.querySelectorAll('[data-boundary]')).toHaveLength(7);
    expect(putCalls()).toEqual([]);
    const proposed = logged.find((l) => l.event === 'admin.sheetmusic.propose');
    expect(proposed?.data).toMatchObject({ id: DEFAULT_ID, scorer: 'heuristic' });
    expect(proposed.data.segments).toBeGreaterThan(0);
    expect(typeof proposed.data.ms).toBe('number');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(putCalls().length).toBe(1));
    const body = putCalls()[0][1];
    expect(body.segments.map((seg) => seg.id)).toEqual(body.segments.map((_, i) => String.fromCharCode(97 + i)));
    expect(body.segments[0].start).toBe(0);
    expect(body.segments[body.segments.length - 1].end).toBe(7);
    expect(body.segments.every((seg) => Array.isArray(seg.parts) && seg.parts.length)).toBe(true);
    expect(body.proposal).toMatchObject({ scorer: 'heuristic', model: null });
    expect(Object.keys(body.proposal.boundaries)).toHaveLength(7);
    expect(body.proposal.features).toHaveLength(7);
    expect(body.proposal.edited).toBeUndefined();
  });

  const proposeNow = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Propose segments' }));
    return screen.findByTestId('measure-strip-draft');
  };
  const mergeFirst = (strip) => {
    fireEvent.click(within(strip).getAllByRole('button', { name: /^Segment 1, / })[0]);
    fireEvent.click(within(strip).getByRole('button', { name: /^Merge with / }));
  };

  it('a rename does not mark a proposal edited; changing its cuts does', async () => {
    renderPage();
    await engravedReady();
    let strip = await proposeNow();
    fireEvent.click(within(strip).getAllByRole('button', { name: /^Segment 1, / })[0]);
    const name = within(strip).getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Opening' } });
    fireEvent.blur(name);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(putCalls().length).toBe(1));
    expect(putCalls()[0][1].proposal.edited).toBeUndefined();
    expect(putCalls()[0][1].proposal.scorer).toBe('heuristic');

    cleanup();
    api.mockClear();
    learn = learnFile();
    renderPage();
    await engravedReady();
    strip = await proposeNow();
    mergeFirst(strip);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(putCalls().length).toBe(1));
    expect(putCalls()[0][1].proposal).toMatchObject({ scorer: 'heuristic', edited: true });
  });

  it('editing a saved proposal keeps its scorer, features and boundaries, marked edited', async () => {
    renderPage();
    await engravedReady();
    await proposeNow();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(putCalls().length).toBe(1));
    await screen.findByText(/Draft saved/);
    const saved = putCalls()[0][1].proposal;
    mergeFirst(await screen.findByTestId('measure-strip-draft'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(putCalls().length).toBe(2));
    const second = putCalls()[1][1].proposal;
    expect(second).toMatchObject({ scorer: 'heuristic', edited: true, at: saved.at });
    expect(second.features).toEqual(saved.features);
    expect(second.boundaries).toEqual(saved.boundaries);
  });

  it('asks before a proposal replaces unsaved edits', async () => {
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 7 }] }, draftRevision: 'r' });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Split after bar 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Propose segments' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Replace your current segments with a proposal?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep my segments' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const bands = () => within(screen.getByTestId('measure-strip-draft')).getAllByRole('button', { name: /^Segment \d+, / }).map((b) => b.getAttribute('aria-label'));
    expect(bands()[0]).toBe('Segment 1, Bars 1-2');
    expect(logged.some((l) => l.event === 'admin.sheetmusic.propose')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Propose segments' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(logged.find((l) => l.event === 'admin.sheetmusic.propose')?.data).toMatchObject({ replacedEdits: true }));
    expect(bands()[0]).not.toBe('Segment 1, Bars 1-2');
  });

  it('proposes without asking when nothing would be lost', async () => {
    renderPage();
    await engravedReady();
    await proposeNow();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(logged.find((l) => l.event === 'admin.sheetmusic.propose')?.data).toMatchObject({ replacedEdits: false });
  });

  it('approve after a proposal saves it first, even when its cuts match the draft', async () => {
    renderPage();
    await engravedReady();
    await proposeNow();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(putCalls().length).toBe(1));
    await screen.findByText(/Draft saved/);
    const cuts = putCalls()[0][1].segments.map(({ start, end }) => [start, end]);
    // Same cuts again, now as a fresh unsaved proposal.
    fireEvent.click(screen.getByRole('button', { name: 'Propose segments' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(putCalls().length).toBe(2));
    expect(putCalls()[1][1].segments.map(({ start, end }) => [start, end])).toEqual(cuts);
    expect(putCalls()[1][1].action).toBe('draft');
  });

  it('stamps a proposal with the score version, and hides stored boundaries from another version', async () => {
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Propose segments' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(putCalls().length).toBe(1));
    expect(putCalls()[0][1].proposal.contentSha256).toBe('sha-now');

    cleanup();
    learn = learnFile({
      draft: { segments: [{ id: 'a', start: 0, end: 7 }], proposal: { scorer: 'heuristic', contentSha256: 'sha-old', boundaries: { 3: 0.9 } } },
      draftRevision: 'r',
    });
    renderPage();
    await engravedReady();
    expect((await screen.findByTestId('measure-strip-draft')).querySelectorAll('[data-boundary]')).toHaveLength(0);
  });

  it('hides a stored proposal\'s boundaries when the score has changed', async () => {
    learn = learnFile({
      segments: [{ id: 'a', start: 0, end: 7 }], approved: { at: 't' }, contentSha256: 'sha-old', stale: true,
      draft: { segments: [{ id: 'a', start: 0, end: 7 }], proposal: { scorer: 'heuristic', boundaries: { 3: 0.9 } } },
      draftRevision: 'r',
    });
    renderPage();
    await engravedReady();
    const strip = await screen.findByTestId('measure-strip-draft');
    expect(strip.querySelectorAll('[data-boundary]')).toHaveLength(0);
  });

  it('generating a poster keeps unsaved segment edits', async () => {
    uploadPoster.mockResolvedValue({ ok: true, result: { poster: 'generated' } });
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 7 }] }, draftRevision: 'r' });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Split after bar 2' }));
    fireEvent.click(screen.getByTestId('generate-poster'));
    await screen.findByText(/Poster saved/);
    expect(within(screen.getByTestId('measure-strip-draft')).getByRole('button', { name: 'Segment 1, Bars 1-2' })).toBeTruthy();
  });

  it('shows a saved proposal\'s boundaries on the draft strip', async () => {
    learn = learnFile({
      draft: { segments: [{ id: 'a', start: 0, end: 7 }], proposal: { scorer: 'heuristic', boundaries: { 3: 0.9, 4: 0.2 } } },
      draftRevision: 'r',
    });
    renderPage();
    await engravedReady();
    const strip = await screen.findByTestId('measure-strip-draft');
    expect([...strip.querySelectorAll('[data-boundary]')].map((el) => el.getAttribute('data-boundary'))).toEqual(['3', '4']);
  });

  it('a hand-made draft carries the score\'s features for calibration', async () => {
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 7 }] }, draftRevision: 'r' });
    renderPage();
    await engravedReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Split after bar 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(putCalls().length).toBe(1));
    const { proposal } = putCalls()[0][1];
    expect(proposal).toMatchObject({ scorer: 'manual', beatsPerMeasure: 4, contentSha256: 'sha-now', seams: [] });
    expect(proposal.features).toHaveLength(7);
    expect(proposal.featureKeys.length).toBe(proposal.features[0].length);
  });

  describe('Jev proposals', () => {
    it('offers Jev only when the household enables it', async () => {
      renderPage();
      await engravedReady();
      await screen.findByRole('button', { name: 'Propose segments' });
      expect(screen.queryByRole('radio', { name: 'Jev' })).toBeNull();
    });

    it('sends features and crops, applies Jev\'s cuts and shows the comparison', async () => {
      learn = learnFile({ boundaryScorer: 'jev', jevOffered: true });
      jevRequest.mockResolvedValue({
        ok: true,
        result: {
          segments: [{ start: 0, end: 3 }, { start: 4, end: 7 }],
          proposal: { scorer: 'jev', model: 'jev-1', boundaries: { 3: 0.9 } },
          comparison: { jev: { precision: 1, recall: 0.5 }, heuristic: { precision: 0.5, recall: 0.5 } },
        },
      });
      renderPage();
      await engravedReady();
      fireEvent.click(await screen.findByRole('radio', { name: 'Jev' }));
      fireEvent.click(screen.getByRole('button', { name: 'Propose segments' }));
      await waitFor(() => expect(jevRequest).toHaveBeenCalledTimes(1));
      const [req] = jevRequest.mock.calls[0];
      expect(req).toMatchObject({ id: DEFAULT_ID, measureCount: 8, targetLen: 4, seams: [] });
      expect(req.features).toHaveLength(7);
      expect([...req.crops.keys()]).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect([...renderCrops.mock.calls[0][1].values()][0]).toMatchObject({ marker: { x: 50 } });
      expect(await screen.findByText(/Jev precision 100%, recall 50%; heuristic precision 50%/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() => expect(putCalls().length).toBe(1));
      expect(putCalls()[0][1].segments.map(({ id, start, end }) => [id, start, end])).toEqual([['a', 0, 3], ['b', 4, 7]]);
      expect(putCalls()[0][1].proposal).toMatchObject({ scorer: 'jev', model: 'jev-1', contentSha256: 'sha-now' });
      expect(logged.find((l) => l.event === 'admin.sheetmusic.propose')?.data).toMatchObject({ scorer: 'jev', segments: 2 });
    });

    it('in calibrate mode compares with Jev and never applies its cuts', async () => {
      learn = learnFile({ boundaryScorer: 'calibrate', jevOffered: true, draft: { segments: [{ id: 'a', start: 0, end: 7 }] }, draftRevision: 'r' });
      jevRequest.mockResolvedValue({
        ok: true,
        result: {
          mode: 'calibrate',
          segments: [{ start: 0, end: 3 }, { start: 4, end: 7 }],
          proposal: { scorer: 'jev', model: 'jev-1' },
          comparison: {
            jev: { precision: 1, recall: 1, tolerant: { precision: 1, recall: 1 } },
            heuristic: { precision: 0, recall: 0, tolerant: { precision: 0.5, recall: 0.5 } },
            seams: { jev: { precision: 1, recall: 1 }, heuristic: { precision: 0, recall: 0 } },
            interior: { jev: { precision: 1, recall: 1 }, heuristic: { precision: null, recall: 0 } },
          },
        },
      });
      renderPage();
      await engravedReady();
      expect(screen.queryByRole('radio', { name: 'Jev' })).toBeNull();
      fireEvent.click(await screen.findByRole('button', { name: 'Compare with Jev' }));
      expect(await screen.findByText(/Jev precision 100%, recall 100% \(within a bar: 100% \/ 100%\); heuristic precision 0%.*At system breaks: Jev precision 100%.*Elsewhere: Jev precision 100%, recall 100%, heuristic precision n\/a/)).toBeTruthy();
      expect(within(screen.getByTestId('measure-strip-draft')).getByRole('button', { name: 'Segment 1, Bars 1-8' })).toBeTruthy();
      expect(screen.queryByText('unsaved changes')).toBeNull();
      expect(logged.find((l) => l.event === 'admin.sheetmusic.propose-compared')?.data).toMatchObject({ jevRecall: 1, heuristicRecall: 0 });
      expect(logged.some((l) => l.event === 'admin.sheetmusic.propose')).toBe(false);
    });

    it('offers nothing Jev when the piece is not eligible', async () => {
      learn = learnFile({ boundaryScorer: 'calibrate', jevOffered: false });
      renderPage();
      await engravedReady();
      await screen.findByRole('button', { name: 'Propose segments' });
      expect(screen.queryByRole('button', { name: 'Compare with Jev' })).toBeNull();
    });

    it('says why when Jev fails, and leaves the segments alone', async () => {
      learn = learnFile({ boundaryScorer: 'jev', jevOffered: true, draft: { segments: [{ id: 'a', start: 0, end: 7 }] }, draftRevision: 'r' });
      jevRequest.mockResolvedValue({ ok: false, code: 'proposal-failed', status: 502 });
      renderPage();
      await engravedReady();
      fireEvent.click(await screen.findByRole('radio', { name: 'Jev' }));
      fireEvent.click(screen.getByRole('button', { name: 'Propose segments' }));
      expect(await screen.findByText(/Jev could not judge enough of the barlines/)).toBeTruthy();
      expect(within(screen.getByTestId('measure-strip-draft')).getByRole('button', { name: 'Segment 1, Bars 1-8' })).toBeTruthy();
      expect(logged.find((l) => l.event === 'admin.sheetmusic.propose-failed')?.data).toMatchObject({ code: 'proposal-failed' });
    });
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

  it('reloads a newer draft before approval when it changed before the impact check', async () => {
    learn = learnFile({ draft: { segments: [{ id: 'a', start: 0, end: 7, parts: ['rh', 'lh'] }] }, draftRevision: 'rev-seen' });
    const changed = learnFile({
      draft: { segments: [{ id: 'a', start: 0, end: 3, parts: ['rh'] }, { id: 'b', start: 4, end: 7, parts: ['rh', 'lh'] }] },
      draftRevision: 'rev-other',
    });
    const approved = [];
    let impactReads = 0;
    api.mockImplementation((path, data, method) => {
      if (path === `api/v1/admin/sheet-music/learn/draft-impact${q()}`) {
        impactReads += 1;
        if (impactReads === 1) {
          learn = changed;
          return Promise.resolve({ draftRevision: changed.draftRevision, impact: [] });
        }
        return Promise.resolve({ draftRevision: learn.draftRevision, impact: [] });
      }
      if (path === learnUrl() && method === 'PUT' && data.action === 'approve') {
        approved.push(data);
        return Promise.resolve({ file: learn, impact: [] });
      }
      return route(path, data, method);
    });
    renderPage();
    await engravedReady();
    await screen.findByRole('button', { name: 'Approve' });
    expect(screen.getByRole('button', { name: 'Segment 1, Bars 1-8' })).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/The draft changed in another tab/)).toBeTruthy();
    expect(approved).toEqual([]);
    expect(await screen.findByRole('button', { name: 'Segment 1, Bars 1-4' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Segment 2, Bars 5-8' })).toBeTruthy();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('No learner has progress on this score.')).toBeTruthy());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approved).toHaveLength(1));
    expect(approved[0]).toMatchObject({ action: 'approve', expectedDraftRevision: 'rev-other' });
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

  describe('Generate poster', () => {
    it('cuts the first two systems from the engraving on screen and uploads them', async () => {
      uploadPoster.mockResolvedValue({ ok: true, result: { poster: 'generated' } });
      renderPage();
      await engravedReady();
      const button = await screen.findByTestId('generate-poster');
      expect(button.textContent).toBe('Generate poster');
      fireEvent.click(button);
      await waitFor(() => expect(uploadPoster).toHaveBeenCalledTimes(1));
      const [id, text] = uploadPoster.mock.calls[0];
      expect(id).toBe(ID);
      expect(text).toContain('data-daylight-poster="generated"');
      expect((text.match(/<path/g) || []).length).toBe(2);
      // system 1 bottom 100+20=120, system 2 top 200 → cut at 160 px = 200 units
      expect(text).toContain('viewBox="0 0 500 200"');
      expect(await screen.findByText(/Poster saved/)).toBeTruthy();
      expect(screen.getByTestId('generate-poster').textContent).toBe('Regenerate poster');
      expect(logged.some((l) => l.event === 'admin.sheetmusic.poster-generated')).toBe(true);
    });

    it('is disabled when a scan exists, since the kiosk would never show it', async () => {
      learn = learnFile({ poster: 'scan' });
      renderPage();
      await engravedReady();
      const button = await screen.findByTestId('generate-poster');
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(uploadPoster).not.toHaveBeenCalled();
    });

    it('says why the server refused', async () => {
      uploadPoster.mockResolvedValue({ ok: false, code: 'poster-exists', status: 409 });
      renderPage();
      await engravedReady();
      fireEvent.click(await screen.findByTestId('generate-poster'));
      expect(await screen.findByText(/hand-made SVG poster/)).toBeTruthy();
      expect(logged.find((l) => l.event === 'admin.sheetmusic.poster-failed')?.data).toMatchObject({ code: 'poster-exists' });
    });
  });
});

describe('seamBarlines', () => {
  it('names the barlines whose Jev crop is two strips', () => {
    // Bars 0-2 on one system, 3-4 on the next.
    const bounds = [0, 1, 2, 3, 4].map((i) => (i < 3
      ? { left: i * 100, right: i * 100 + 100, top: 0, bottom: 60 }
      : { left: (i - 3) * 100, right: (i - 3) * 100 + 100, top: 200, bottom: 260 }));
    expect(seamBarlines([0, 1, 2, 3, 4].map((index) => ({ index })), bounds)).toEqual([2]);
    expect(seamBarlines([0, 1, 3, 4].map((index) => ({ index })), bounds)).toEqual([1]);
  });
});
