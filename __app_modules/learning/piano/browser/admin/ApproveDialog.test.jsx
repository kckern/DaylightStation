import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const api = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => api(...a) }));

import ApproveDialog, { KEEP_TEXT } from "./ApproveDialog.jsx";

const ID = 'files:docs/sheet-music/classical/fur-elise.musicxml';
const Q = `?id=${encodeURIComponent(ID)}`;
const MEASURES = Array.from({ length: 8 }, (_, i) => ({ index: i, number: i + 1 }));

const IMPACT = {
  draftRevision: 'rev-1',
  impact: [
    {
      userId: 'learner-a',
      kept: [{ id: 'a', start: 0, end: 3, silver: 't', gold: 't' }],
      orphaned: [{ id: 'b', start: 4, end: 7, silver: 't', gold: 't' }],
      lostSilver: 1, lostGold: 1, wasAllGold: true, allGoldAfter: false,
    },
    {
      userId: 'learner-b',
      kept: [],
      orphaned: [{ id: 'b', start: 4, end: 7, silver: 't', gold: null }],
      lostSilver: 1, lostGold: 0, wasAllGold: false, allGoldAfter: false,
    },
  ],
};

const httpError = (status, body) => Object.assign(new Error(`HTTP ${status}`), { status, body });

function renderDialog(props = {}) {
  const handlers = { onClose: vi.fn(), onDone: vi.fn(), onDraftChanged: vi.fn() };
  render(
    <MantineProvider>
      <ApproveDialog opened scoreId={ID} measures={MEASURES} measureCount={8} {...handlers} {...props} />
    </MantineProvider>,
  );
  return handlers;
}

beforeEach(() => { api.mockReset(); });
afterEach(cleanup);

describe('ApproveDialog', () => {
  it('lists kept and orphaned passages per learner with the Polish line', async () => {
    api.mockResolvedValueOnce(IMPACT);
    renderDialog();
    await waitFor(() => expect(screen.getByTestId('impact-learner-a')).toBeTruthy());
    expect(api).toHaveBeenCalledWith(`api/v1/admin/sheet-music/learn/draft-impact${Q}`);
    const a = within(screen.getByTestId('impact-learner-a'));
    expect(a.getByText('Kept: Bars 1-4')).toBeTruthy();
    expect(a.getByText('Bars 5-8 (Gold lost)')).toBeTruthy();
    expect(a.getByText('learner-a loses Polish eligibility until re-earned.')).toBeTruthy();
    const b = within(screen.getByTestId('impact-learner-b'));
    expect(b.getByText('Bars 5-8 (Silver lost)')).toBeTruthy();
    expect(b.queryByText(/loses Polish eligibility/)).toBeNull();
    expect(screen.getByText(KEEP_TEXT)).toBeTruthy();
  });

  it('approves with the draftRevision the impact was computed against', async () => {
    api.mockResolvedValueOnce(IMPACT).mockResolvedValueOnce({ file: {}, impact: IMPACT.impact });
    const { onDone } = renderDialog();
    await waitFor(() => expect(screen.getByTestId('impact-learner-a')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api).toHaveBeenLastCalledWith(`api/v1/admin/sheet-music/learn${Q}`,
      { action: 'approve', measureCount: 8, expectedDraftRevision: 'rev-1' }, 'PUT');
    expect(onDone).toHaveBeenCalledWith('approve', { file: {}, impact: IMPACT.impact });
  });

  it('hands a 409 draft-changed back to the page', async () => {
    api.mockResolvedValueOnce(IMPACT).mockRejectedValueOnce(httpError(409, { error: 'draft-changed', draftRevision: 'rev-2' }));
    const { onDone, onDraftChanged } = renderDialog();
    await waitFor(() => expect(screen.getByTestId('impact-learner-a')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onDraftChanged).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows other refusals in the dialog', async () => {
    api.mockResolvedValueOnce(IMPACT).mockRejectedValueOnce(httpError(422, { error: 'invalid-segments', errors: [] }));
    renderDialog();
    await waitFor(() => expect(screen.getByTestId('impact-learner-a')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText(/does not fit this score/)).toBeTruthy());
  });

  it('revert computes impact from the generated segments and sends revert', async () => {
    api.mockResolvedValueOnce({ impact: [] }).mockResolvedValueOnce({ file: {}, impact: null, changed: true });
    const generated = [{ id: 'm0-3', start: 0, end: 3, parts: ['rh'] }, { id: 'm4-7', start: 4, end: 7 }];
    const { onDone } = renderDialog({ mode: 'revert', generated });
    await waitFor(() => expect(screen.getByText('No learner has progress on this score.')).toBeTruthy());
    expect(api).toHaveBeenCalledWith(`api/v1/admin/sheet-music/impact${Q}`,
      { segments: [{ id: 'm0-3', start: 0, end: 3 }, { id: 'm4-7', start: 4, end: 7 }] }, 'POST');
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('revert', { file: {}, impact: null, changed: true }));
    expect(api).toHaveBeenLastCalledWith(`api/v1/admin/sheet-music/learn${Q}`, { action: 'revert' }, 'PUT');
  });
});
