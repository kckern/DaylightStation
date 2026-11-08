import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const calls = [];
const row = (id, label, members) => ({ id, peekId: members[0] || id, members, kind: 'words', group: 'profanity', label, modality: 'said', in: 10, out: 11, effect: 'mute', card: null, handFixed: false, unsure: [], reviewed: null });
let payload;
vi.mock('../../../lib/hooks/useApiResource.js', () => ({ useApiResource: () => ({ data: payload, loading: false, error: null, reload: () => {} }) }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: async (path, body, method) => { calls.push({ path, body, method }); return {}; } }));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div /> }));
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');
const show = () => render(<MantineProvider><MemoryRouter initialEntries={['/f/77']}><Routes><Route path="/f/:ratingKey" element={<ContentFilterReview />} /></Routes></MemoryRouter></MantineProvider>);
const base = (extra = {}) => ({ title: 'F', certification: { level: 'machine' }, audit: { ok: true, fresh: true, running: false }, wordRulings: {},
  rows: [row('cue:a', 'damn', ['a']), row('subject:s', 'Billboard', ['b', 'c'])], reviewed: 0, total: 2, job: null, signOff: { ready: false, missing: [], parent: null }, ...extra });

describe('review page send-back', () => {
  it('sends the selected rows back together', async () => {
    payload = base(); calls.length = 0;
    show();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select damn' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Billboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send back 2 selected' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/jobs', body: { kind: 'send-back', cues: ['a', 'b', 'c'] }, method: 'POST' });
  });
  it('labels the rows of a running send-back with its step', () => {
    payload = base({ job: { kind: 'send-back', status: 'running', step: 'refine', cues: ['b'] } });
    show();
    expect(within(screen.getByText('Billboard').closest('[data-row-id]')).getByText('Sent back: refine')).toBeTruthy();
  });
});
