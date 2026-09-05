/**
 * AddBook — the three-step add flow (design §5), one screen per `step`.
 *
 * Rendered directly with hand-built props, nothing mocked: each step paints
 * its control, each tappable calls the right `actions.*` with the right
 * argument, the number step shows the hook's hint and honours `canSubmit`,
 * the cover step becomes the duplicate card when `duplicateOf` is set, and
 * an error is shown in place.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AddBook from './AddBook.jsx';

const actions = () => ({
  typeIsbn: vi.fn(), lookup: vi.fn(), retryLookup: vi.fn(), confirmCover: vi.fn(),
  choose: vi.fn(), submitPage: vi.fn(), submitDay: vi.fn(), openDuplicate: vi.fn(), back: vi.fn(),
});

const BOOK = {
  isbn13: '9780064400558', title: 'Hatchet', authors: ['Gary Paulsen'], coverUrl: '/c/h.jpg',
  pageCount: 195, description: 'A boy, a plane, a hatchet.',
};

const add = (overrides = {}) => ({
  entry: '', check: { state: 'typing' }, hint: null, canSubmit: false, canRetry: false,
  resolved: null, duplicateOf: null, entryId: null, progressEntryId: null, finishedOn: null,
  metadataMissing: false,
  ...overrides,
});

const TODAY = '2026-09-02';

function mount(step, props = {}) {
  const a = actions();
  render(<AddBook step={step} add={add()} today={TODAY} error={null} busy={false} actions={a} {...props} />);
  return a;
}

const press = (...keys) => keys.forEach((k) => fireEvent.click(screen.getByRole('button', { name: String(k) })));

describe('AddBook', () => {
  it('has a root the shelf can find', () => {
    mount('number');
    expect(screen.getByTestId('add-book')).toBeInTheDocument();
  });

  describe('number', () => {
    it('a 13-slot pad with an X key, controlled by add.entry, typing → typeIsbn', () => {
      const a = mount('number', { add: add({ entry: '978' }) });
      expect(screen.getByText('Type the number under the barcode')).toBeInTheDocument();
      expect(screen.getAllByTestId('numberpad-slot')).toHaveLength(13);
      expect(screen.getByRole('button', { name: 'X' })).toBeInTheDocument();
      expect(screen.getByTestId('numberpad-entry').textContent.replace(/\s/g, '')).toBe('978');
      press(0);
      expect(a.typeIsbn).toHaveBeenCalledWith('9780');
    });

    it('shows add.hint and keeps Look it up dark until canSubmit', () => {
      mount('number', { add: add({ entry: '9780064400559', hint: 'Check that number — one digit is off', canSubmit: false }) });
      expect(screen.getByRole('status')).toHaveTextContent('Check that number');
      expect(screen.getByRole('button', { name: 'Look it up' })).toBeDisabled();
    });

    it('Look it up → lookup()', () => {
      const a = mount('number', { add: add({ entry: '9780064400558', canSubmit: true }) });
      const button = screen.getByRole('button', { name: 'Look it up' });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(a.lookup).toHaveBeenCalledTimes(1);
    });

    it('canRetry → Try again → retryLookup()', () => {
      const a = mount('number', { add: add({ entry: '9780064400558', hint: "Can't look books up right now", canRetry: true, canSubmit: true }) });
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(a.retryLookup).toHaveBeenCalledTimes(1);
    });

    it('no Try again without canRetry', () => {
      mount('number');
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });
  });

  it('lookup: says it is looking, no dead screen', () => {
    mount('lookup', { add: add({ entry: '9780064400558' }) });
    expect(screen.getByText(/looking it up/i)).toBeInTheDocument();
    expect(screen.queryByTestId('numberpad')).toBeNull();
  });

  describe('cover', () => {
    const resolved = { status: 'ok', book: BOOK };

    it('paints the card and asks; Yes / No → confirmCover', () => {
      const a = mount('cover', { add: add({ resolved }) });
      expect(screen.getByRole('img', { name: 'Cover of Hatchet' })).toHaveAttribute('src', '/c/h.jpg');
      expect(screen.getByText('Hatchet')).toBeInTheDocument();
      expect(screen.getByText('Gary Paulsen')).toBeInTheDocument();
      expect(screen.getByText('A boy, a plane, a hatchet.')).toBeInTheDocument();
      expect(screen.getByText(/is this your book/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
      expect(a.confirmCover).toHaveBeenCalledWith(true);
      fireEvent.click(screen.getByRole('button', { name: 'No, edit number' }));
      expect(a.confirmCover).toHaveBeenCalledWith(false);
    });

    it('with duplicateOf: the duplicate card, Open it → openDuplicate, No → confirmCover(false)', () => {
      const a = mount('cover', { add: add({ resolved, duplicateOf: 'kid:9780064400558:e0' }) });
      expect(screen.getByText(/already got this one/i)).toBeInTheDocument();
      expect(screen.queryByText(/is this your book/i)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      expect(a.openDuplicate).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: 'No, edit number' }));
      expect(a.confirmCover).toHaveBeenCalledWith(false);
    });

    it('lets a clean catalog miss continue under an honest ISBN placeholder', () => {
      const unresolved = {
        status: 'not-found',
        book: { isbn13: '9780027746723', title: null, authors: [], coverUrl: null },
      };
      const a = mount('cover', { add: add({ resolved: unresolved, metadataMissing: true }) });
      expect(screen.getByRole('img', { name: /no cover available for book 9780027746723/i })).toBeInTheDocument();
      expect(screen.getByText('Book 9780027746723')).toBeInTheDocument();
      expect(screen.getByText(/couldn't find a title or cover/i)).toBeInTheDocument();
      expect(screen.getByText(/you can still log it by ISBN/i)).toBeInTheDocument();
      expect(screen.queryByText(/fill in the book details later/i)).toBeNull();
      expect(screen.getByText(/is this the ISBN on your book/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Yes, log this book' }));
      expect(a.confirmCover).toHaveBeenCalledWith(true);
    });
  });

  describe('where', () => {
    const resolved = { status: 'ok', book: BOOK };

    it('three doors → choose(where)', () => {
      const a = mount('where', { add: add({ resolved }) });
      fireEvent.click(screen.getByRole('button', { name: /just starting it/i }));
      fireEvent.click(screen.getByRole('button', { name: /partway through/i }));
      fireEvent.click(screen.getByRole('button', { name: /already finished it/i }));
      expect(a.choose).toHaveBeenNthCalledWith(1, 'starting');
      expect(a.choose).toHaveBeenNthCalledWith(2, 'partway');
      expect(a.choose).toHaveBeenNthCalledWith(3, 'finished');
    });

    it('names the book above the doors', () => {
      mount('where', { add: add({ resolved }) });
      expect(screen.getByText(/Hatchet/)).toBeInTheDocument();
    });

    it('busy disables the doors', () => {
      mount('where', { add: add({ resolved }), busy: true });
      expect(screen.getByRole('button', { name: /just starting it/i })).toBeDisabled();
    });
  });

  it('page: the pad → submitPage(84)', () => {
    const a = mount('page', { add: add({ resolved: { status: 'ok', book: BOOK } }) });
    expect(screen.getByText('What page are you on?')).toBeInTheDocument();
    press(8, 4);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(a.submitPage).toHaveBeenCalledWith(84);
  });

  it('when: the DayPicker → submitDay(key)', () => {
    const a = mount('when', { add: add({ resolved: { status: 'ok', book: BOOK } }) });
    expect(screen.getByText(/when did you finish it/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /pick a day/i }));
    fireEvent.click(screen.getByRole('gridcell', { name: /Tuesday 25 August/ }));
    fireEvent.click(screen.getByRole('button', { name: /that's the day/i }));
    expect(a.submitDay).toHaveBeenCalledWith('2026-08-25');
  });

  it('renders the error in place', () => {
    mount('where', { add: add({ resolved: { status: 'ok', book: BOOK } }), error: { message: "That didn't save — try again" } });
    expect(screen.getByText("That didn't save — try again")).toBeInTheDocument();
  });

  it('on the page step the error rides the pad as its hint', () => {
    mount('page', { add: add({ resolved: { status: 'ok', book: BOOK } }), error: { message: 'Type the page you are on' } });
    expect(screen.getByRole('status')).toHaveTextContent('Type the page you are on');
  });

  it.each(['number', 'cover', 'where', 'page', 'when'])('‹ back on %s → back()', (step) => {
    const a = mount(step, { add: add({ resolved: { status: 'ok', book: BOOK } }) });
    fireEvent.click(screen.getByRole('button', { name: '‹ back' }));
    expect(a.back).toHaveBeenCalledTimes(1);
  });
});
