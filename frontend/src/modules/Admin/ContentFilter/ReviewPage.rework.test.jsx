import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const calls = [];
let failWith = null;
const row = (id, kind, members, verdict) => ({ id, peekId: members[0] || id.split(':')[1], members, kind, group: 'profanity', label: id, modality: 'said', in: 10, out: 11, effect: 'mute', card: null, handFixed: false, unsure: [], reviewed: null, ...(verdict ? { verdict } : {}) });
const redo = (reason) => ({ verdict: 'redo', ...(reason ? { reason } : {}) });
let payload;
vi.mock('../../../lib/hooks/useApiResource.js', () => ({ useApiResource: () => ({ data: payload, loading: false, error: null, reload: () => {} }) }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: async (path, body, method) => { calls.push({ path, body, method }); if (failWith) throw new Error(failWith); return {}; } }));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div /> }));
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');
const show = () => render(<MantineProvider><MemoryRouter initialEntries={['/f/77']}><Routes><Route path="/f/:ratingKey" element={<ContentFilterReview />} /></Routes></MemoryRouter></MantineProvider>);
const base = (rows, extra = {}) => ({ title: 'F', certification: { level: 'machine' }, audit: { ok: true, fresh: true, running: false }, wordRulings: {},
  rows, reviewed: 0, total: rows.length, job: null, signOff: { ready: false, missing: [], parent: null }, ...extra });

beforeEach(() => { calls.length = 0; failWith = null; });

describe('rework flagged', () => {
  it('sends the redo rows member cues with their reasons', async () => {
    payload = base([row('cue:a', 'words', ['a'], redo('edges')), row('subject:s', 'pictures', ['b', 'c'], redo()), row('cue:z', 'words', ['z'], { verdict: 'approve' })]);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Rework 2 flagged' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/jobs', body: { kind: 'send-back', cues: ['a', 'b', 'c'], reasons: { 'cue:a': 'edges' } }, method: 'POST' });
  });
  it('Shift+D arms, then a second press triggers the same rework', async () => {
    payload = base([row('cue:a', 'words', ['a'], redo('timing'))]);
    show();
    fireEvent.keyDown(document.body, { key: 'D', shiftKey: true });
    expect(await screen.findByText('Shift+D again to send 1 for rework')).toBeTruthy();
    expect(calls).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: 'D', shiftKey: true });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ kind: 'send-back', cues: ['a'], reasons: { 'cue:a': 'timing' } });
  });
  it('scene-only redo rows enqueue the scenes stage', async () => {
    payload = base([row('scene:x', 'scenes', [], redo('category'))]);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Rework 1 flagged' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ kind: 'stage', stage: 'scenes', reasons: { 'scene:x': 'category' } });
  });
  it('shows a run already open (409) as a notice', async () => {
    payload = base([row('cue:a', 'words', ['a'], redo())]);
    failWith = 'A run is already open for this film';
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Rework 1 flagged' }));
    expect(await screen.findByText('A run is already open for this film')).toBeTruthy();
  });
  it('is disabled while a run is running', () => {
    payload = base([row('cue:a', 'words', ['a'], redo())], { job: { kind: 'make', status: 'running', step: 'refine' } });
    show();
    expect(screen.getByRole('button', { name: 'Rework 1 flagged' }).disabled).toBe(true);
  });
  it('has no button when nothing is flagged', () => {
    payload = base([row('cue:a', 'words', ['a'])]);
    show();
    expect(screen.queryByRole('button', { name: /Rework/ })).toBeNull();
  });
});
