import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { TodayToasts } from "./TodayToasts.jsx";

const noMoves = { undo: null, error: null, clearError: () => {} };

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
    await waitFor(() => controls.current.setUndoDelete({ label: 'Eggs', entryIds: ['e1'] }));
    expect(await screen.findByText('Eggs deleted.')).toBeTruthy();

    await waitFor(() => controls.current.setMoveUndo('Moved Toast to Lunch'));
    expect(await screen.findByRole('button', { name: 'Undo move' })).toBeTruthy();
    expect(screen.queryByText('Eggs deleted.')).toBeNull();

    // Dismissing the newer one must not resurrect the older.
    await waitFor(() => controls.current.setMoveUndo(null));
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

  it('an Undo in progress holds the day buttons', async () => {
    render(<MantineProvider><TodayToasts moves={noMoves} today="2026-11-18" undoBusy onDismissMealUndo={() => {}}
      mealUndo={{ token: 'meal-1', label: 'Added Eggs to Today', offer: { logId: 'log', date: '2026-11-18' } }} /></MantineProvider>);
    expect((await screen.findByRole('button', { name: 'Move to Yesterday' })).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Other day…' }).disabled).toBe(true);
  });
});
