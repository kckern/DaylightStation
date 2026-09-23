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

import { RowPreviewContent, RowPreviewProvider, CLOSE_DELAY_MS, CURSOR_OFFSET_PX, placeCard } from './RowPreview.jsx';

import { EntryRow } from './EntryRow.jsx';
import { PortionContext } from './usePortionDraft.js';

// The app wraps everything in AppThemeProvider's .ds-root (inline --ds-* tokens).
const r = ui => render(<MantineProvider><div className="ds-root">{ui}</div></MantineProvider>);
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


// jsdom ships no PointerEvent, so fireEvent.pointer* would carry no coordinates.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) { super(type, init); this.pointerType = init.pointerType ?? 'mouse'; this.isPrimary = true; }
  };
}

describe('placeCard', () => {
  const view = { innerWidth: 1000, innerHeight: 800 };
  const size = { width: 300, height: 120 };
  it('sits above and to the right of the cursor', () => {
    expect(placeCard({ x: 100, y: 400 }, size, view)).toEqual({ left: 100 + CURSOR_OFFSET_PX, top: 400 - CURSOR_OFFSET_PX - 120, side: 'top' });
  });
  it('flips below the cursor when there is no room above', () => {
    const at = placeCard({ x: 100, y: 60 }, size, view);
    expect(at.side).toBe('bottom');
    expect(at.top).toBeGreaterThan(60);
  });
  it('stays inside the viewport at the right edge', () => {
    const at = placeCard({ x: 950, y: 400 }, size, view);
    expect(at.left + size.width).toBeLessThanOrEqual(1000 - 8);
  });
});

describe('EntryRow preview card — one card, at the cursor', () => {
  beforeEach(() => { vi.useFakeTimers(); sampled.mockReset(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const cards = () => document.querySelectorAll('.health-row-preview__card');
  const card = () => document.querySelector('.health-row-preview__card');
  const pear = { ...apple, uuid: 'row-2', name: 'Pear', calories: 101 };
  const rows = (...list) => r(<RowPreviewProvider>{list.map(row => <EntryRow key={row.uuid} row={row} onTap={() => {}} />)}</RowPreviewProvider>);
  const lineOf = name => screen.getByRole('button', { name: `Edit ${name}` }).closest('.health-row-line');
  const hover = (el, x, y) => fireEvent.pointerEnter(el, { pointerType: 'mouse', clientX: x, clientY: y });

  it('opens the moment the pointer arrives, logs once, and closes after leaving', () => {
    rows(apple);
    const artwork = lineOf('Apple').querySelector('.health-row-artwork');
    hover(artwork, 50, 300);
    expect(lineOf('Apple').dataset.preview).toBe('open');
    expect(card()).toBeTruthy();
    expect(card().textContent).toContain('Apple');
    expect(sampled).toHaveBeenCalledWith('row.preview.open', { uuid: 'row-1', hasPhoto: false }, { maxPerMinute: 20 });
    fireEvent.pointerLeave(artwork, { pointerType: 'mouse' });
    expect(card()).toBeTruthy(); // the short grace between artwork and name
    act(() => { vi.advanceTimersByTime(CLOSE_DELAY_MS + 5); });
    expect(card()).toBeNull();
    expect(lineOf('Apple').dataset.preview).toBeUndefined();
  });

  it('is a singleton: moving to another row swaps the content, never adds a second card', () => {
    rows(apple, pear);
    hover(lineOf('Apple').querySelector('.health-row-artwork'), 50, 300);
    fireEvent.pointerLeave(lineOf('Apple').querySelector('.health-row-artwork'), { pointerType: 'mouse' });
    hover(screen.getByRole('button', { name: 'Edit Pear' }), 80, 330);
    expect(cards()).toHaveLength(1);
    expect(card().textContent).toContain('Pear');
    expect(card().textContent).not.toContain('Apple');
    expect(lineOf('Apple').dataset.preview).toBeUndefined();
    expect(lineOf('Pear').dataset.preview).toBe('open');
    act(() => { vi.advanceTimersByTime(1000); });
    // Apple's pending close must not take down Pear's card.
    expect(cards()).toHaveLength(1);
  });

  it('follows the cursor and never takes the pointer itself', () => {
    rows(apple);
    const name = screen.getByRole('button', { name: 'Edit Apple' });
    hover(name, 120, 500);
    const first = card().style.transform;
    fireEvent.pointerMove(name, { pointerType: 'mouse', clientX: 300, clientY: 520 });
    act(() => { vi.advanceTimersByTime(50); }); // the move lands on the next animation frame
    expect(card().style.transform).not.toBe(first);
    expect(card().style.transform).toContain(`${300 + CURSOR_OFFSET_PX}px`);
    expect(card().getAttribute('role')).toBe('tooltip');
    expect(card().closest('.ds-root')).toBeTruthy();
  });

  it('the name carries no native title tooltip to compete with the card', () => {
    const { container } = rows(apple);
    expect(container.querySelector('.health-row__description').getAttribute('title')).toBeNull();
  });

  it('keyboard focus on the name opens it; Escape closes it', () => {
    rows(apple);
    const name = screen.getByRole('button', { name: 'Edit Apple' });
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.focus(name);
    expect(lineOf('Apple').dataset.preview).toBe('open');
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(card()).toBeNull();
  });

  it('focus that did not come from Tab (a sheet returning focus, a tap) does not open it', () => {
    rows(apple);
    const name = screen.getByRole('button', { name: 'Edit Apple' });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.focus(name);
    expect(card()).toBeNull();
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.pointerDown(document.body);
    fireEvent.focus(name);
    expect(card()).toBeNull();
  });

  it('never opens while a portion draft is live', () => {
    r(<PortionContext.Provider value={{ draft: { row: apple, status: 'editing' } }}>
      <RowPreviewProvider><EntryRow row={apple} onTap={() => {}} /></RowPreviewProvider>
    </PortionContext.Provider>);
    hover(document.querySelector('.health-row-artwork'), 50, 300);
    expect(card()).toBeNull();
    expect(sampled).not.toHaveBeenCalled();
  });

  it('on a touch screen, tapping the artwork opens the card; a tap elsewhere closes it', () => {
    const original = window.matchMedia;
    window.matchMedia = query => ({ matches: query === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} });
    try {
      const onTap = vi.fn();
      r(<RowPreviewProvider><EntryRow row={apple} onTap={onTap} /></RowPreviewProvider>);
      fireEvent.click(document.querySelector('.health-row-artwork'));
      expect(card()).toBeTruthy();
      expect(onTap).not.toHaveBeenCalled();
      fireEvent.pointerDown(document.body);
      expect(card()).toBeNull();
    } finally { window.matchMedia = original; }
  });

  it('without a provider, a row shows no card and nothing breaks', () => {
    r(<EntryRow row={apple} onTap={() => {}} />);
    hover(document.querySelector('.health-row-artwork'), 50, 300);
    expect(card()).toBeNull();
  });
});
