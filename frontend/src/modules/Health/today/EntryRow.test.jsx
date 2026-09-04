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

  describe('photo thumbnail', () => {
    it('a row with photoRef renders a thumbnail whose src carries size=thumb', () => {
      r(<EntryRow row={{ ...baseRow, photoRef: 'ph_abc123' }} onTap={() => {}} onConfirm={() => {}} />);
      const img = document.querySelector('img.health-row__thumb');
      expect(img).toBeTruthy();
      expect(img.getAttribute('src')).toContain('ph_abc123');
      expect(img.getAttribute('src')).toContain('size=thumb');
      expect(img.getAttribute('loading')).toBe('lazy');
      // Decorative — the row text already names the food.
      expect(img.getAttribute('alt')).toBe('');
    });

    it('a row without photoRef renders no thumbnail', () => {
      r(<EntryRow row={{ ...baseRow }} onTap={() => {}} onConfirm={() => {}} />);
      expect(document.querySelector('img.health-row__thumb')).toBeFalsy();
    });

    it('an onError on the thumbnail hides it without leaving a broken-image glyph', () => {
      r(<EntryRow row={{ ...baseRow, photoRef: 'ph_abc123' }} onTap={() => {}} onConfirm={() => {}} />);
      const img = document.querySelector('img.health-row__thumb');
      expect(img.style.display).not.toBe('none');
      fireEvent.error(img);
      expect(img.style.display).toBe('none');
    });

    it('a group row with photoRef also renders a thumbnail', () => {
      r(<EntryRow row={{ uuid: 'g1', name: 'Smoothie', calories: 0, kind: 'group', photoRef: 'ph_group1' }}
        onTap={() => {}} onConfirm={() => {}} isGroup expanded={false} onToggle={() => {}} rollupKcal={225} />);
      const img = document.querySelector('img.health-row__thumb');
      expect(img).toBeTruthy();
      expect(img.getAttribute('src')).toContain('ph_group1');
    });
  });
  // Task 5.4 — scale-measured badge.
  describe('scale-measured badge', () => {
    it('renders the caller-supplied measurement summary as TEXT, not colour alone', () => {
      r(<EntryRow row={{ ...baseRow }} onTap={() => {}} onConfirm={() => {}} measured="82 g · scale ✓" />);
      expect(screen.getByText('82 g · scale ✓')).toBeTruthy();
    });

    it('renders no badge when the row has no consumed observation', () => {
      r(<EntryRow row={{ ...baseRow }} onTap={() => {}} onConfirm={() => {}} />);
      expect(document.querySelector('.health-row__scale')).toBeFalsy();
    });

    it('coexists with the unsettled cue — an entry can be scale-measured AND unconfirmed', () => {
      r(<EntryRow row={{ ...baseRow, settled: false }} onTap={() => {}} onConfirm={() => {}} measured="82 g · scale ✓" />);
      expect(screen.getByText(/unconfirmed/i)).toBeTruthy();
      expect(screen.getByText('82 g · scale ✓')).toBeTruthy();
      expect(screen.getByRole('button', { name: /confirm entry/i })).toBeTruthy();
    });
  });

  // Task 7.4 — food icons. The Noom dot stays the fallback glyph, so every
  // assertion here is a pair: what appears AND what it replaced.
  describe('food icon', () => {
    const icon = () => document.querySelector('img.health-row__icon');
    const dot = () => document.querySelector('.health-row__dot');

    it('a row with an icon renders the picture instead of the dot', () => {
      r(<EntryRow row={{ ...baseRow, icon: 'fried-eggs' }} onTap={() => {}} onConfirm={() => {}} />);
      expect(icon()).toBeTruthy();
      expect(icon().getAttribute('src')).toBe('/api/v1/health/nutrition/icons/fried-eggs');
      expect(dot()).toBeFalsy();
    });

    it('a row with no icon renders the dot, exactly as before', () => {
      r(<EntryRow row={{ ...baseRow }} onTap={() => {}} onConfirm={() => {}} />);
      expect(icon()).toBeFalsy();
      expect(dot()).toBeTruthy();
    });

    it("the capture pipeline's neutral sentinel is NOT a picture — the dot stands", () => {
      r(<EntryRow row={{ ...baseRow, icon: 'default' }} onTap={() => {}} onConfirm={() => {}} />);
      expect(icon()).toBeFalsy();
      expect(dot()).toBeTruthy();
    });

    it('a failed icon load falls back to the dot rather than a broken-image glyph', () => {
      r(<EntryRow row={{ ...baseRow, icon: 'fried-eggs' }} onTap={() => {}} onConfirm={() => {}} />);
      expect(dot()).toBeFalsy();
      fireEvent.error(icon());
      expect(icon()).toBeFalsy();
      expect(dot()).toBeTruthy();
    });

    // The reason the failure state stores a SLUG rather than a boolean: after
    // an override the same component instance is re-rendered with a new icon,
    // and a boolean would keep suppressing it forever.
    it('a row whose icon is CHANGED after a failure shows the new picture', () => {
      const { rerender } = r(<EntryRow row={{ ...baseRow, icon: 'fried-eggs' }} onTap={() => {}} onConfirm={() => {}} />);
      fireEvent.error(icon());
      expect(icon()).toBeFalsy();
      rerender(
        <MantineProvider>
          <EntryRow row={{ ...baseRow, icon: 'avocado-toast' }} onTap={() => {}} onConfirm={() => {}} />
        </MantineProvider>,
      );
      expect(icon()).toBeTruthy();
      expect(icon().getAttribute('src')).toBe('/api/v1/health/nutrition/icons/avocado-toast');
    });

    it('the icon is decorative: empty alt, so a screen reader reads the name once', () => {
      r(<EntryRow row={{ ...baseRow, icon: 'fried-eggs' }} onTap={() => {}} onConfirm={() => {}} />);
      expect(icon().getAttribute('alt')).toBe('');
    });

    it('the row declares the wider icon column only when an icon actually renders', () => {
      // jsdom cannot see layout, so this asserts the CLASS the component sets;
      // the column widths themselves live in health.scss and are compiled by
      // the stylesheet gate.
      const { unmount } = r(<EntryRow row={{ ...baseRow, icon: 'fried-eggs' }} onTap={() => {}} onConfirm={() => {}} />);
      expect(document.querySelector('.health-row--icon')).toBeTruthy();
      fireEvent.error(icon());
      expect(document.querySelector('.health-row--icon')).toBeFalsy();
      unmount();
      r(<EntryRow row={{ ...baseRow }} onTap={() => {}} onConfirm={() => {}} />);
      expect(document.querySelector('.health-row--icon')).toBeFalsy();
    });

    describe('group rows', () => {
      const group = (over) => ({ uuid: 'g1', name: 'Smoothie', calories: 0, kind: 'group', ...over });
      const renderGroup = (row) => r(
        <EntryRow row={row} onTap={() => {}} onConfirm={() => {}} isGroup expanded={false} onToggle={() => {}} rollupKcal={225} />,
      );

      it("a dish uses its OWN icon when it has one", () => {
        renderGroup(group({ icon: 'avocado-toast', children: [{ uuid: 'c1', icon: 'fried-eggs' }] }));
        expect(icon().getAttribute('src')).toContain('avocado-toast');
      });

      it("a dish with no icon borrows the first child that has one", () => {
        renderGroup(group({ children: [{ uuid: 'c1' }, { uuid: 'c2', icon: 'fried-eggs' }] }));
        expect(icon().getAttribute('src')).toContain('fried-eggs');
      });

      it('a dish whose children have no icons renders none, and no dot either (a group has never had one)', () => {
        renderGroup(group({ children: [{ uuid: 'c1' }, { uuid: 'c2' }] }));
        expect(icon()).toBeFalsy();
        expect(dot()).toBeFalsy();
      });
    });
  });
});
