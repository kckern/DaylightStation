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

  describe('group presentation', () => {
    const groupRow = { uuid: 'g1', name: 'Smoothie', calories: 0, kind: 'group' };

    it('shows the rollup kcal (not the group row\'s own zero) and a real expand button with aria-expanded', () => {
      r(<EntryRow row={groupRow} onTap={() => {}} onConfirm={() => {}} isGroup expanded={false} onToggle={() => {}} rollupKcal={225} />);
      expect(screen.getByText('225')).toBeTruthy();
      const btn = screen.getByRole('button', { name: /expand smoothie/i });
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    it('reflects expanded state in aria-expanded AND the accessible name (not chevron glyph alone)', () => {
      r(<EntryRow row={groupRow} onTap={() => {}} onConfirm={() => {}} isGroup expanded onToggle={() => {}} rollupKcal={225} />);
      const btn = screen.getByRole('button', { name: /collapse smoothie/i });
      expect(btn.getAttribute('aria-expanded')).toBe('true');
    });

    it('tapping the expand control toggles without also firing onTap (row tap)', () => {
      const onTap = vi.fn();
      const onToggle = vi.fn();
      r(<EntryRow row={groupRow} onTap={onTap} onConfirm={() => {}} isGroup expanded={false} onToggle={onToggle} rollupKcal={225} />);
      fireEvent.click(screen.getByRole('button', { name: /expand smoothie/i }));
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onTap).not.toHaveBeenCalled();
    });

    it('tapping the group row body still opens the edit sheet, exactly as an item row', () => {
      const onTap = vi.fn();
      r(<EntryRow row={groupRow} onTap={onTap} onConfirm={() => {}} isGroup expanded={false} onToggle={() => {}} rollupKcal={225} />);
      fireEvent.click(screen.getByText('Smoothie'));
      expect(onTap).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'g1' }));
    });

    it('the expand control and the row button are siblings, never nested (no button-in-a-button)', () => {
      r(<EntryRow row={groupRow} onTap={() => {}} onConfirm={() => {}} isGroup expanded={false} onToggle={() => {}} rollupKcal={225} />);
      const expandBtn = screen.getByRole('button', { name: /expand smoothie/i });
      const rowBtn = screen.getByText('Smoothie').closest('button');
      expect(expandBtn.contains(rowBtn)).toBe(false);
      expect(rowBtn.contains(expandBtn)).toBe(false);
    });
  });

  it('an indented child row still carries the unsettled cue and confirm affordance', () => {
    r(<EntryRow row={{ ...baseRow, settled: false }} onTap={() => {}} onConfirm={() => {}} child />);
    expect(document.querySelector('.health-row-line--child')).toBeTruthy();
    expect(screen.getByText(/unconfirmed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /confirm entry/i })).toBeTruthy();
  });
});
