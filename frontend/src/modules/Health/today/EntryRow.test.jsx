import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { EntryRow } from './EntryRow.jsx';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

const baseRow = { uuid: 'row-1', name: 'Apple', calories: 95, amount: 1, unit: 'medium', color: 'green' };

describe('EntryRow', () => {
  beforeEach(() => { apiMock.mockReset(); });

  it('an unsettled row (settled:false) renders the unsettled cue and a confirm button', () => {
    r(<EntryRow row={{ ...baseRow, settled: false }} onTap={() => {}} onConfirm={() => {}} />);
    expect(document.querySelector('.health-row--unsettled')).toBeTruthy();
    // Non-visual signal: real text content, not color alone.
    expect(screen.getByText(/unconfirmed/i)).toBeTruthy();
    const confirmBtn = screen.getByRole('button', { name: /confirm entry/i });
    expect(confirmBtn).toBeTruthy();
  });

  it('a settled row (settled:true) renders neither the cue nor the confirm button', () => {
    r(<EntryRow row={{ ...baseRow, settled: true }} onTap={() => {}} onConfirm={() => {}} />);
    expect(document.querySelector('.health-row--unsettled')).toBeFalsy();
    expect(screen.queryByText(/unconfirmed/i)).toBeFalsy();
    expect(screen.queryByRole('button', { name: /confirm entry/i })).toBeNull();
  });

  it('a row with NO settled key renders neither the cue nor the confirm button (absent = settled)', () => {
    r(<EntryRow row={{ ...baseRow }} onTap={() => {}} onConfirm={() => {}} />);
    expect(document.querySelector('.health-row--unsettled')).toBeFalsy();
    expect(screen.queryByRole('button', { name: /confirm entry/i })).toBeNull();
  });

  it('tapping confirm PUTs settled:true to the row and calls onConfirm', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const onConfirm = vi.fn();
    r(<EntryRow row={{ ...baseRow, settled: false }} onTap={() => {}} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /confirm entry/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith(
      'api/v1/health/nutrilist/row-1',
      { settled: true },
      'PUT',
    );
  });

  it('tapping confirm does not also trigger the row tap (onTap)', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const onTap = vi.fn();
    const onConfirm = vi.fn();
    r(<EntryRow row={{ ...baseRow, settled: false }} onTap={onTap} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /confirm entry/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onTap).not.toHaveBeenCalled();
  });

  it('tapping the row body (not confirm) calls onTap with the row', () => {
    const onTap = vi.fn();
    r(<EntryRow row={{ ...baseRow, settled: false }} onTap={onTap} onConfirm={() => {}} />);
    fireEvent.click(screen.getByText('Apple'));
    expect(onTap).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'row-1' }));
  });
});
