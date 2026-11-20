import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { createRef, useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { AppFrame } from '@/lib/ui';
import { TodayToasts } from "./TodayToasts.jsx";

const noMoves = { undo: null, error: null, clearError: () => {} };
// A touch screen: (pointer: coarse) matches, as on a phone.
const asTouchScreen = () => {
  const original = window.matchMedia;
  window.matchMedia = query => ({ matches: /pointer:\s*coarse/.test(query), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  return () => { window.matchMedia = original; };
};


// A host holding the three undo slots the way TodayView does.
function Host({ controls }) {
  const [undoDelete, setUndoDelete] = useState(null);
  const [mealUndo, setMealUndo] = useState(null);
  const [moveUndo, setMoveUndo] = useState(null);
  controls.current = { setUndoDelete, setMealUndo, setMoveUndo };
  const moves = { ...noMoves, undo: moveUndo ? { label: moveUndo, run: () => {}, dismiss: () => setMoveUndo(null) } : null };
  return <MantineProvider><TodayToasts moves={moves}
    mealUndo={mealUndo} onDismissMealUndo={() => setMealUndo(null)}
    undoDelete={undoDelete} onDismissUndoDelete={() => setUndoDelete(null)} /></MantineProvider>;
}

describe('TodayToasts', () => {
  it('offers only the newest undo, and retires the older one rather than hiding it', async () => {
    const controls = { current: null };
    render(<Host controls={controls} />);
    act(() => controls.current.setUndoDelete({ label: 'Eggs', entryIds: ['e1'] }));
    expect(await screen.findByText('Eggs deleted.')).toBeTruthy();

    act(() => controls.current.setMoveUndo('Moved Toast to Lunch'));
    expect(await screen.findByRole('button', { name: 'Undo move' })).toBeTruthy();
    expect(screen.queryByText('Eggs deleted.')).toBeNull();

    // Dismissing the newer one must not resurrect the older.
    act(() => controls.current.setMoveUndo(null));
    expect(screen.queryByText('Eggs deleted.')).toBeNull();
    expect(screen.queryAllByRole('button', { name: /undo/i })).toHaveLength(0);
  });

  it('keeps a move error and its partial-move undo together', () => {
    const moves = { undo: { label: 'Moved 1 food from Breakfast to Lunch', run: () => {}, dismiss: () => {} },
      error: "Couldn't move 1 of 2 foods: offline", clearError: () => {} };
    render(<MantineProvider><TodayToasts moves={moves} /></MantineProvider>);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't move 1 of 2 foods");
    expect(screen.getByRole('button', { name: 'Undo move' })).toBeTruthy();
  });

  it('a long model reply stays until dismissed; a short cue retires itself', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const long = 'I could not find any food in that photo. Try again with the plate centred and in good light, or type what you ate.';
    const view = render(<MantineProvider><TodayToasts moves={noMoves} captureNotice={long} onDismissCapture={onDismiss} /></MantineProvider>);
    act(() => vi.advanceTimersByTime(60000));
    expect(onDismiss).not.toHaveBeenCalled();
    view.rerender(<MantineProvider><TodayToasts moves={noMoves} captureNotice="Moved to Lunch" onDismissCapture={onDismiss} /></MantineProvider>);
    act(() => vi.advanceTimersByTime(6000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a capture notice with a saved recording keeps its Try again until used', () => {
    const onRetry = vi.fn();
    render(<MantineProvider><TodayToasts moves={noMoves} captureNotice="Couldn't transcribe. The recording is saved."
      captureRetry={{ audioRef: 'a1' }} onRetryCapture={onRetry} onDismissCapture={() => {}} /></MantineProvider>);
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(onRetry).toHaveBeenCalled();
  });

  it('a capture toast offers the other likely day and any other day', async () => {
    const onMoveCapture = vi.fn();
    render(<MantineProvider><TodayToasts moves={noMoves} today="2026-11-18" onMoveCapture={onMoveCapture} onDismissMealUndo={() => {}}
      mealUndo={{ token: 'meal-1', label: 'Added 3 foods to Today, Lunch', offer: { logId: 'log', date: '2026-11-18' } }} /></MantineProvider>);
    expect(await screen.findByText('Added 3 foods to Today, Lunch')).toBeTruthy();
    screen.getByRole('button', { name: 'Move to Yesterday' }).click();
    expect(onMoveCapture).toHaveBeenCalledWith('2026-11-17');
    expect(screen.getByRole('button', { name: 'Other day…' })).toBeTruthy();
  });

  it('food that landed on an earlier day is offered a move to today', async () => {
    const onMoveCapture = vi.fn();
    render(<MantineProvider><TodayToasts moves={noMoves} today="2026-11-18" onMoveCapture={onMoveCapture} onDismissMealUndo={() => {}}
      mealUndo={{ token: 'meal-1', label: 'Added Eggs to Yesterday', offer: { logId: 'log', date: '2026-11-17' } }} /></MantineProvider>);
    (await screen.findByRole('button', { name: 'Move to Today' })).click();
    expect(onMoveCapture).toHaveBeenCalledWith('2026-11-18');
  });

  it('a meal change without an offer has no day buttons', async () => {
    render(<MantineProvider><TodayToasts moves={noMoves} today="2026-11-18" onDismissMealUndo={() => {}}
      mealUndo={{ token: 'meal-1', label: 'Meal updated' }} /></MantineProvider>);
    expect(await screen.findByRole('button', { name: 'Undo meal change' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Move to/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Other day…' })).toBeNull();
  });

  it('holds every capture action while its move runs, and frees them if the food stays', async () => {
    let finish;
    const onMoveCapture = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    render(<MantineProvider><TodayToasts moves={noMoves} today="2026-11-18" onMoveCapture={onMoveCapture} onDismissMealUndo={() => {}}
      mealUndo={{ token: 'meal-1', label: 'Added Eggs to Today', offer: { logId: 'log', date: '2026-11-18' } }} /></MantineProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Yesterday' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo meal change' }).disabled).toBe(true));
    expect(screen.getByRole('button', { name: 'Dismiss' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Other day…' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Move to Yesterday' }));
    expect(onMoveCapture).toHaveBeenCalledTimes(1);
    await act(async () => { finish('not-moved'); });
    expect(screen.getByRole('button', { name: 'Undo meal change' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Move to Yesterday' }).disabled).toBe(false);
  });

  it('an add with no Undo offers the day move beside any Undo already showing', async () => {
    const onMoveOffer = vi.fn(); const shown = { token: null, label: 'Added Apple to Today', offer: { ids: ['a'], what: 'Apple', date: '2026-11-18' } };
    render(<MantineProvider><TodayToasts moves={noMoves} today="2026-11-18" onDismissMealUndo={() => {}} mealUndo={{ token: 'meal-1', label: 'Meal updated' }}
      dayOffers={[shown]} onMoveOffer={onMoveOffer} onDismissOffer={() => {}} /></MantineProvider>);
    expect(await screen.findByText('Added Apple to Today')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Undo meal change' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Move to Yesterday' }));
    expect(onMoveOffer).toHaveBeenCalledWith(shown, '2026-11-17');
  });

  it('two offers name their food on every button, keeping the short visible text', async () => {
    const offer = (id, what) => ({ token: null, label: `Added ${what}`, offer: { ids: [id], what, date: '2026-11-18' } });
    render(<MantineProvider><TodayToasts moves={noMoves} today="2026-11-18" dayOffers={[offer('a', 'Apple'), offer('b', 'Eggs')]}
      onMoveOffer={() => {}} onDismissOffer={() => {}} /></MantineProvider>);
    const move = await screen.findByRole('button', { name: 'Move Eggs to Yesterday' });
    expect(move.textContent).toBe('Move to Yesterday');
    expect(screen.getByRole('button', { name: 'Move Apple to another day' }).textContent).toBe('Other day…');
    expect(screen.getByRole('button', { name: 'Dismiss Apple' })).toBeTruthy();
  });

  it('a superseded capture Undo is reported separately from a person dismissing it', async () => {
    const onDismiss = vi.fn(); const onSupersede = vi.fn();
    const moves = { ...noMoves, undo: null };
    const toast = current => <MantineProvider><TodayToasts moves={current} today="2026-11-18" onDismissMealUndo={onDismiss} onSupersedeMealUndo={onSupersede}
      mealUndo={{ token: 'meal-1', label: 'Added Eggs', offer: { ids: ['e'], what: 'Eggs', date: '2026-11-18' } }} /></MantineProvider>;
    const view = render(toast(moves));
    await screen.findByText('Added Eggs');
    view.rerender(toast({ ...moves, undo: { label: 'Moved Apple', run: () => {}, dismiss: () => {} } }));
    await waitFor(() => expect(onSupersede).toHaveBeenCalledTimes(1));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('a move with an unknown outcome offers only a retry of that move', async () => {
    let finish; const retryMove = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    render(<MantineProvider><TodayToasts moves={noMoves} today="2026-11-18" onDismissMealUndo={() => {}}
      mealUndo={{ token: 'meal-1', label: 'Added Eggs to Today', retryMove, offer: { ids: ['e'], what: 'Eggs', date: '2026-11-18' } }} /></MantineProvider>);
    const retry = await screen.findByRole('button', { name: 'Retry moving Eggs' });
    expect(retry.textContent).toBe('Try again');
    expect(screen.queryByRole('button', { name: 'Move to Yesterday' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Other day…' })).toBeNull();
    fireEvent.click(retry);
    fireEvent.click(screen.getByRole('button', { name: 'Retry moving Eggs' }));
    expect(retryMove).toHaveBeenCalledTimes(1);
    await act(async () => { finish('moved'); });
  });

  it('an Undo in progress holds the day buttons', async () => {
    render(<MantineProvider><TodayToasts moves={noMoves} today="2026-11-18" undoBusy onDismissMealUndo={() => {}}
      mealUndo={{ token: 'meal-1', label: 'Added Eggs to Today', offer: { logId: 'log', date: '2026-11-18' } }} /></MantineProvider>);
    expect((await screen.findByRole('button', { name: 'Move to Yesterday' })).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Other day…' }).disabled).toBe(true);
  });

  describe('a move whose outcome is unknown', () => {
    const unresolved = { id: 'op-1', message: "We couldn't confirm moving Eggs to Dinner.", busy: false, retry: vi.fn(), dismiss: vi.fn() };
    it('gets one toast that can retry it or let it go', () => {
      render(<MantineProvider><TodayToasts moves={{ ...noMoves, error: 'Could not save.', errorHandled: true }} unresolvedMoves={[unresolved]} /></MantineProvider>);
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(unresolved.retry).toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(unresolved.dismiss).toHaveBeenCalled();
    });
    it('a change that already went through cannot be dismissed', () => {
      render(<MantineProvider><TodayToasts moves={noMoves} unresolvedMoves={[{ ...unresolved, dismiss: null }]} /></MantineProvider>);
      expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    });
  });

  it('every toast action sits in the row that gives fingers 44 px', () => {
    render(<MantineProvider><TodayToasts moves={{ ...noMoves, error: 'No.', undo: { label: 'Moved', run: () => {}, dismiss: () => {} } }} captureNotice="Hello" dayNotice="Hi" onDismissCapture={() => {}} /></MantineProvider>);
    for (const button of screen.getAllByRole('button')) expect(button.closest('.health-capture-actions')).toBeTruthy();
  });

  it('the page keeps room for toasts until the view has left it', async () => {
    const pageRef = createRef();
    const view = props => <MantineProvider><div className="ds-root">
      <div className="health-today" data-testid="other-view" />
      <AppFrame><div className="health-today" ref={pageRef}>
        <TodayToasts moves={noMoves} pageRef={pageRef} {...props} />
      </div></AppFrame>
    </div></MantineProvider>;
    const { rerender, unmount } = render(view({ dayNotice: 'Hello', onDismissDayNotice: () => {} }));
    await screen.findByText('Hello');
    rerender(view({ dayNotice: 'Hello again', onDismissDayNotice: () => {} }));
    const page = pageRef.current;
    const scroller = screen.getByRole('main');
    const clearance = () => page.style.getPropertyValue('--health-toast-clearance');
    expect(clearance()).toBe('8px');
    expect(screen.getByTestId('other-view').style.getPropertyValue('--health-toast-clearance')).toBe('');
    rerender(view());
    expect(clearance()).toBe('8px'); // the view is at the end, standing in that room
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { value: 100 });
    fireEvent.scroll(scroller);
    expect(clearance()).toBe('0px');
    unmount();
    expect(clearance()).toBe('');
  });

  describe('focus when the focused control leaves', () => {
    const offer = { token: 'meal-1', label: 'Added Eggs to Today', offer: { ids: ['e'], what: 'Eggs', date: '2026-11-18' } };
    const moved = { ...noMoves, undo: { label: 'Moved Eggs to Yesterday', run: () => {}, dismiss: () => {} } };
    const view = props => <MantineProvider><TodayToasts today="2026-11-18" moves={noMoves} onDismissMealUndo={() => {}} {...props} /></MantineProvider>;
    it('a finished move hands focus to its Undo', async () => {
      const { rerender } = render(view({ mealUndo: offer }));
      (await screen.findByRole('button', { name: 'Move to Yesterday' })).focus();
      rerender(view({ moves: moved }));
      expect(document.activeElement).toBe(await screen.findByRole('button', { name: 'Undo move' }));
    });
    it('a failed move hands focus to Try again in the same toast', async () => {
      const { rerender } = render(view({ mealUndo: offer }));
      (await screen.findByRole('button', { name: 'Move to Yesterday' })).focus();
      rerender(view({ mealUndo: { ...offer, retryMove: () => {} } }));
      expect(document.activeElement).toBe(await screen.findByRole('button', { name: 'Retry moving Eggs' }));
    });
    it('with no toast left, focus goes to the day bar and not the page', async () => {
      const bar = document.createElement('div');
      bar.className = 'health-day-input';
      bar.innerHTML = '<input /><button class="health-day-input__move">Move</button>';
      document.body.append(bar);
      const { rerender } = render(view({ moves: moved }));
      (await screen.findByRole('button', { name: 'Undo move' })).focus();
      rerender(view());
      expect(document.activeElement).toBe(bar.querySelector('button'));
      bar.remove();
    });
    it('on a touch screen with no move button, focus goes to the microphone, not the field', async () => {
      const restore = asTouchScreen();
      const bar = document.body.appendChild(document.createElement('div'));
      bar.className = 'health-day-input';
      bar.innerHTML = '<div class="health-day-input__field"><input /></div><button class="health-day-input__mic">Mic</button>';
      try {
        const { rerender } = render(view({ moves: moved }));
        (await screen.findByRole('button', { name: 'Undo move' })).focus();
        rerender(view());
        expect(document.activeElement).toBe(bar.querySelector('.health-day-input__mic'));
      } finally { bar.remove(); restore(); }
    });
    describe('picking from Other day…', () => {
      const pick = async name => {
        const opener = await screen.findByRole('button', { name: 'Other day…' });
        opener.focus();
        fireEvent.click(opener);
        const item = await screen.findByRole('menuitem', { name });
        item.focus();
        fireEvent.click(item);
      };
      const pending = () => { let finish; const onMoveCapture = vi.fn(() => new Promise(resolve => { finish = resolve; })); return { onMoveCapture, finish: value => finish(value) }; };
      it('keeps focus in the toast while the move runs', async () => {
        const { onMoveCapture } = pending();
        render(view({ mealUndo: offer, onMoveCapture }));
        await pick('Yesterday');
        expect(onMoveCapture).toHaveBeenCalledWith('2026-11-17');
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move to Yesterday' }));
      });
      it('a finished move hands focus to its Undo', async () => {
        const { onMoveCapture, finish } = pending();
        const { rerender } = render(view({ mealUndo: offer, onMoveCapture }));
        await pick('Yesterday');
        await act(async () => { finish('moved'); });
        rerender(view({ moves: moved, onMoveCapture }));
        expect(document.activeElement).toBe(await screen.findByRole('button', { name: 'Undo move' }));
      });
      it('a move with no known outcome hands focus to Try again', async () => {
        const { onMoveCapture, finish } = pending();
        const { rerender } = render(view({ mealUndo: offer, onMoveCapture }));
        await pick('Yesterday');
        await act(async () => { finish('unknown'); });
        rerender(view({ mealUndo: { ...offer, retryMove: () => {} }, onMoveCapture }));
        expect(document.activeElement).toBe(await screen.findByRole('button', { name: 'Retry moving Eggs' }));
      });
      it('a refused move leaves focus on the toast, even if the busy button dropped it', async () => {
        const { onMoveCapture, finish } = pending();
        render(view({ mealUndo: offer, onMoveCapture }));
        await pick('Yesterday');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Move to Yesterday' }).disabled).toBe(true));
        document.activeElement.blur();
        await act(async () => { finish('not-moved'); });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move to Yesterday' }));
      });
      it('a date from the field closes the menu and keeps focus in the toast', async () => {
        const { onMoveCapture } = pending();
        render(view({ mealUndo: offer, onMoveCapture }));
        fireEvent.click(await screen.findByRole('button', { name: 'Other day…' }));
        const field = await screen.findByLabelText('Move to another day');
        field.focus();
        fireEvent.change(field, { target: { value: '2026-11-02' } });
        expect(onMoveCapture).toHaveBeenCalledWith('2026-11-02');
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move to Yesterday' }));
        await waitFor(() => expect(screen.queryByLabelText('Move to another day')).toBeNull());
      });
      it('a half-typed year in the date field moves nothing', async () => {
        const onMoveCapture = vi.fn();
        render(view({ mealUndo: offer, onMoveCapture }));
        fireEvent.click(await screen.findByRole('button', { name: 'Other day…' }));
        fireEvent.change(await screen.findByLabelText('Move to another day'), { target: { value: '0002-11-02' } });
        expect(onMoveCapture).not.toHaveBeenCalled();
      });
    });
    describe('after a move from a menu outside the toasts', () => {
      const failed = { ...noMoves, error: "Couldn't move Eggs.", clearError: () => {} };
      it('goes to the toast that reports it, when focus was lost', async () => {
        const { rerender } = render(view({ moves: failed }));
        await screen.findByRole('button', { name: 'Dismiss' });
        rerender(view({ moves: failed, menuMoveSettled: 1 }));
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss' }));
      });
      it('prefers the next action, such as Try again', async () => {
        const stuck = [{ id: 'op', message: 'Could not confirm.', busy: false, retry: () => {}, dismiss: () => {} }];
        const { rerender } = render(view({ unresolvedMoves: stuck }));
        await screen.findByRole('button', { name: 'Try again' });
        rerender(view({ unresolvedMoves: stuck, menuMoveSettled: 1 }));
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));
      });
      it('leaves focus the person has placed elsewhere', async () => {
        const other = document.createElement('button');
        document.body.append(other);
        const { rerender } = render(view({ moves: failed }));
        await screen.findByRole('button', { name: 'Dismiss' });
        other.focus();
        rerender(view({ moves: failed, menuMoveSettled: 1 }));
        expect(document.activeElement).toBe(other);
        other.remove();
      });
    });
    describe('a Try again on the page', () => {
      const stuck = busy => [{ id: 'op', message: 'Could not confirm.', busy, retry: () => {}, dismiss: () => {} }];
      // jsdom keeps focus on a disabled button, so the browser's drop to the page is staged.
      const dropFocusWhile = run => {
        Object.defineProperty(document, 'activeElement', { configurable: true, get: () => document.body });
        try { run(); } finally { delete document.activeElement; }
      };
      const retryAfterBusyDrop = async ({ pressElsewhere = false } = {}) => {
        const { rerender } = render(view({ unresolvedMoves: stuck(false) }));
        const retry = await screen.findByRole('button', { name: 'Try again' });
        retry.focus();
        rerender(view({ unresolvedMoves: stuck(true) }));
        if (pressElsewhere) fireEvent.pointerDown(document.body);
        const focus = vi.spyOn(retry, 'focus');
        dropFocusWhile(() => rerender(view({ unresolvedMoves: stuck(false) })));
        return focus;
      };
      it('gets focus back when its retry fails again, after the busy button dropped it', async () => {
        expect(await retryAfterBusyDrop()).toHaveBeenCalled();
      });
      it('leaves focus alone when the person pressed elsewhere during the retry', async () => {
        expect(await retryAfterBusyDrop({ pressElsewhere: true })).not.toHaveBeenCalled();
      });
      describe('handed back by the closing day sheet', () => {
        let moveButton;
        beforeEach(() => { moveButton = document.body.appendChild(Object.assign(document.createElement('button'), { className: 'health-day-input__move' })); moveButton.focus(); });
        afterEach(() => moveButton.remove());
        // The toasts are already on the page when the sheet closes.
        const handBack = async moves => {
          const view_ = render(view({ unresolvedMoves: [] }));
          await screen.findByRole('region', { name: 'Food log notifications' });
          view_.rerender(view({ unresolvedMoves: moves, handedBackMove: 'op' }));
          return view_;
        };
        it('takes focus from the day bar', async () => {
          await handBack(stuck(false));
          expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));
        });
        it('waits for a retry still running, then takes focus', async () => {
          const { rerender } = await handBack(stuck(true));
          expect(document.activeElement).toBe(moveButton);
          rerender(view({ unresolvedMoves: stuck(false), handedBackMove: 'op' }));
          expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));
        });
        it('leaves focus the person placed elsewhere', async () => {
          const other = document.body.appendChild(document.createElement('button'));
          other.focus();
          await handBack(stuck(false));
          expect(document.activeElement).toBe(other);
          other.remove();
        });
      });
    });
    it('focus elsewhere is left alone', async () => {
      const other = document.createElement('button');
      document.body.append(other);
      const { rerender } = render(view({ moves: moved }));
      (await screen.findByRole('button', { name: 'Undo move' })).focus();
      other.focus();
      rerender(view());
      expect(document.activeElement).toBe(other);
      other.remove();
    });
  });
});
