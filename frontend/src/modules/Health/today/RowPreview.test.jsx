import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const sampled = vi.fn();
vi.mock('../../../lib/ui/createAppLogger.js', () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: (...a) => sampled(...a) };
  log.child = () => log;
  return { createAppLogger: () => log };
});
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

import { RowPreviewContent, OPEN_DELAY_MS, CLOSE_DELAY_MS } from './RowPreview.jsx';
import { EntryRow } from './EntryRow.jsx';
import { PortionContext } from './usePortionDraft.js';

const r = ui => render(<MantineProvider>{ui}</MantineProvider>);
const apple = { uuid: 'row-1', name: 'Apple', calories: 95, protein: 0.5, carbs: 25, fat: 0.3, grams: 182, unit: 'g', amount: 182, icon: 'apple' };

describe('RowPreviewContent', () => {
  afterEach(cleanup);

  it('shows the full product photo first, never the thumbnail', () => {
    const { container } = r(<RowPreviewContent row={{ ...apple, photoRef: 'p/1.jpg' }} kcal={95} />);
    const hero = container.querySelector('.health-row-preview__hero');
    expect(hero.dataset.kind).toBe('photo');
    const src = hero.querySelector('img').getAttribute('src');
    expect(src).toContain('/nutrition/photos/');
    expect(src).not.toContain('size=thumb');
  });

  it('falls back to the icon, then to the placeholder', () => {
    const iconCase = r(<RowPreviewContent row={apple} kcal={95} />);
    expect(iconCase.container.querySelector('.health-row-preview__hero').dataset.kind).toBe('icon');
    iconCase.unmount();
    const none = r(<RowPreviewContent row={{ ...apple, icon: 'default' }} kcal={95} />);
    expect(none.container.querySelector('.health-row-preview__hero').dataset.kind).toBe('placeholder');
    expect(none.container.querySelector('.health-row-preview__hero svg')).toBeTruthy();
  });

  it('carries the name, portion, kcal, macros and density', () => {
    r(<RowPreviewContent row={apple} kcal={95.4} />);
    expect(screen.getByText('Apple')).toBeTruthy();
    expect(screen.getByText('182 g')).toBeTruthy();
    expect(screen.getByText('95 kcal')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Carbs: 25 grams/ })).toBeTruthy();
    expect(screen.getByText('0.5 kcal/g')).toBeTruthy();
  });

  it('a group shows its total and ingredient count', () => {
    const children = [{ uuid: 'a', name: 'Bun', calories: 200, grams: 60, unit: 'g', amount: 60 },
      { uuid: 'b', name: 'Patty', calories: 300, grams: 100, unit: 'g', amount: 100 }];
    r(<RowPreviewContent row={{ uuid: 'g', kind: 'group', name: 'Burger', children }} isGroup kcal={500} />);
    expect(screen.getByText('2 ingredients')).toBeTruthy();
    expect(screen.getByText('500 kcal')).toBeTruthy();
  });
});

describe('EntryRow preview card', () => {
  beforeEach(() => { vi.useFakeTimers(); sampled.mockReset(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const card = () => document.querySelector('.health-row-preview');
  const isOpen = container => container.querySelector('.health-row-line').dataset.preview === 'open';

  it('opens after the hover delay, logs once, and closes after leaving', () => {
    const { container } = r(<EntryRow row={apple} onTap={() => {}} />);
    const artwork = container.querySelector('.health-row-artwork');
    fireEvent.pointerEnter(artwork);
    act(() => { vi.advanceTimersByTime(OPEN_DELAY_MS - 50); });
    expect(card()).toBeNull();
    act(() => { vi.advanceTimersByTime(60); });
    expect(isOpen(container)).toBe(true);
    act(() => { vi.advanceTimersByTime(1000); }); // the card's fade-in
    expect(card()).toBeTruthy();
    expect(sampled).toHaveBeenCalledWith('row.preview.open', { uuid: 'row-1', hasPhoto: false }, { maxPerMinute: 20 });
    fireEvent.pointerLeave(artwork);
    act(() => { vi.advanceTimersByTime(CLOSE_DELAY_MS - 50); });
    expect(isOpen(container)).toBe(true);
    act(() => { vi.advanceTimersByTime(60); });
    expect(isOpen(container)).toBe(false);
  });

  it('keyboard focus on the name opens it; Escape closes it', () => {
    const { container } = r(<EntryRow row={apple} onTap={() => {}} />);
    const name = screen.getByRole('button', { name: 'Edit Apple' });
    fireEvent.focus(name);
    act(() => { vi.advanceTimersByTime(OPEN_DELAY_MS); });
    expect(isOpen(container)).toBe(true);
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(isOpen(container)).toBe(false);
  });

  it('never opens while a portion draft is live', () => {
    const { container } = r(<PortionContext.Provider value={{ draft: { row: apple, status: 'editing' } }}>
      <EntryRow row={apple} onTap={() => {}} />
    </PortionContext.Provider>);
    fireEvent.pointerEnter(container.querySelector('.health-row-artwork'));
    act(() => { vi.advanceTimersByTime(OPEN_DELAY_MS * 2); });
    expect(isOpen(container)).toBe(false);
    expect(card()).toBeNull();
    expect(sampled).not.toHaveBeenCalled();
  });

  it('on a touch screen, tapping the artwork opens the card', () => {
    const original = window.matchMedia;
    window.matchMedia = query => ({ matches: query === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} });
    try {
      const onTap = vi.fn();
      const { container } = r(<EntryRow row={apple} onTap={onTap} />);
      fireEvent.click(container.querySelector('.health-row-artwork'));
      expect(isOpen(container)).toBe(true);
      expect(onTap).not.toHaveBeenCalled();
    } finally { window.matchMedia = original; }
  });
});
