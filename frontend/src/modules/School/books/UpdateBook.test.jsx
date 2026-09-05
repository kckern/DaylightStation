/**
 * UpdateBook — the overlay a child updates a book from (design §4).
 *
 * Rendered directly with hand-built props, nothing mocked: these tests pin
 * that one control appears per `progressMode`, which `actions.*` each
 * tappable calls and with what, that the pad starts empty, that the finish
 * path goes through DayPicker collapsed on today, and that a write's error
 * is shown in place.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import UpdateBook from './UpdateBook.jsx';

const actions = () => ({
  submitProgress: vi.fn(), checkIn: vi.fn(), finish: vi.fn(), setAside: vi.fn(),
  setMode: vi.fn(), back: vi.fn(),
});

const item = (overrides = {}, projection = {}) => ({
  itemId: 'kid:hatchet:e0', bookId: 'hatchet', progressMode: 'page', pageCount: 195, openedAt: '2026-08-20',
  events: [], title: 'Hatchet', authors: ['Gary Paulsen'], coverUrl: '/c/h.jpg',
  ...overrides,
  projection: { status: 'reading', page: 84, percent: 43, minutes: 0, daysRead: 2, lastAt: '2026-08-25T10:00:00Z', ...projection },
});

const TODAY = '2026-09-02';

function mount(props = {}) {
  const a = actions();
  render(<UpdateBook item={item()} today={TODAY} error={null} busy={false} actions={a} {...props} />);
  return a;
}

const press = (...keys) => keys.forEach((k) => fireEvent.click(screen.getByRole('button', { name: String(k) })));
const entry = () => screen.getByTestId('numberpad-entry').textContent.replace(/\s/g, '');

describe('UpdateBook', () => {
  it('has a root the shelf can find, the cover and the title', () => {
    mount();
    expect(screen.getByTestId('update-book')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cover of Hatchet' })).toHaveAttribute('src', '/c/h.jpg');
    expect(screen.getByText('Hatchet')).toBeInTheDocument();
  });

  describe('page mode', () => {
    it('shows the page pad, empty, and no check-in button', () => {
      mount();
      expect(screen.getByText('What page are you on?')).toBeInTheDocument();
      expect(entry()).toBe('');
      expect(screen.getAllByTestId('numberpad-slot')).toHaveLength(4);
      expect(screen.queryByRole('button', { name: /read some today/i })).toBeNull();
    });

    it('Save with 84 → submitProgress({ page: 84 })', () => {
      const a = mount();
      press(8, 4);
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(a.submitProgress).toHaveBeenCalledWith({ page: 84 });
    });
  });

  describe('minutes mode', () => {
    it('asks how long and submits minutes', () => {
      const a = mount({ item: item({ progressMode: 'minutes', pageCount: null }) });
      expect(screen.getByText('How long did you read?')).toBeInTheDocument();
      expect(screen.getAllByTestId('numberpad-slot')).toHaveLength(3);
      press(2, 5);
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(a.submitProgress).toHaveBeenCalledWith({ minutes: 25 });
    });

    it('shows the time read so far in hours and minutes', () => {
      mount({ item: item({ progressMode: 'minutes', pageCount: null }, { minutes: 80 }) });
      expect(screen.getByText('1h 20m so far')).toBeInTheDocument();
    });
  });

  describe('check mode', () => {
    it('one button, no pad, → checkIn()', () => {
      const a = mount({ item: item({ progressMode: 'check', pageCount: null }) });
      expect(screen.queryByTestId('numberpad')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /read some today/i }));
      expect(a.checkIn).toHaveBeenCalledTimes(1);
    });
  });

  describe('finishing', () => {
    it('I finished it → the DayPicker, collapsed on today; confirming → finish(today)', () => {
      const a = mount();
      expect(screen.queryByTestId('daypicker')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /i finished it/i }));
      expect(screen.getByTestId('daypicker')).toBeInTheDocument();
      expect(screen.getByText(/Today · Wed 2/)).toBeInTheDocument();
      expect(screen.queryByRole('grid')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /that's the day/i }));
      expect(a.finish).toHaveBeenCalledWith(TODAY);
    });

    it('picking a past day → finish with that day', () => {
      const a = mount();
      fireEvent.click(screen.getByRole('button', { name: /i finished it/i }));
      fireEvent.click(screen.getByRole('button', { name: /pick a day/i }));
      fireEvent.click(screen.getByRole('gridcell', { name: /Tuesday 25 August/ }));
      fireEvent.click(screen.getByRole('button', { name: /that's the day/i }));
      expect(a.finish).toHaveBeenCalledWith('2026-08-25');
    });
  });

  it('set it aside → setAside()', () => {
    const a = mount();
    fireEvent.click(screen.getByRole('button', { name: /set it aside/i }));
    expect(a.setAside).toHaveBeenCalledTimes(1);
  });

  describe('mode switch', () => {
    it('tapping the progress line opens the chooser; a choice → setMode', () => {
      const a = mount();
      expect(screen.queryByRole('button', { name: /just check in/i })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /84 \/ 195/ }));
      fireEvent.click(screen.getByRole('button', { name: /just check in/i }));
      expect(a.setMode).toHaveBeenCalledWith('check');
    });

    it('offers all three modes, with the current one disabled so it cannot post a no-op', () => {
      const a = mount();
      fireEvent.click(screen.getByRole('button', { name: /84 \/ 195/ }));
      const current = screen.getByRole('button', { name: /count pages/i });
      expect(current).toBeDisabled();
      fireEvent.click(current);
      fireEvent.click(screen.getByRole('button', { name: /count minutes/i }));
      fireEvent.click(screen.getByRole('button', { name: /just check in/i }));
      expect(a.setMode).not.toHaveBeenCalledWith('page');
      expect(a.setMode).toHaveBeenNthCalledWith(1, 'minutes');
      expect(a.setMode).toHaveBeenNthCalledWith(2, 'check');
    });
  });

  it('renders the error where the child is looking', () => {
    mount({ error: { message: "That didn't save — try again" } });
    expect(screen.getByText("That didn't save — try again")).toBeInTheDocument();
  });

  it('a blank-entry sentence rides the pad as its hint', () => {
    mount({ error: { message: 'Type a page or tap "I read some today"' } });
    expect(screen.getByRole('status')).toHaveTextContent('Type a page or tap');
  });

  it('busy disables the primary buttons', () => {
    mount({ busy: true, item: item({ progressMode: 'check', pageCount: null }) });
    expect(screen.getByRole('button', { name: /read some today/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /i finished it/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /set it aside/i })).toBeDisabled();
  });

  it('busy disables Save on the pad', () => {
    mount({ busy: true });
    press(8, 4);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('‹ back → back()', () => {
    const a = mount();
    fireEvent.click(screen.getByRole('button', { name: '‹ back' }));
    expect(a.back).toHaveBeenCalledTimes(1);
  });
});
