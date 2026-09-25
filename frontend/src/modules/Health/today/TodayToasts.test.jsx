import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { TodayToasts } from './TodayToasts.jsx';

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

  it('a capture notice with a saved recording keeps its Try again until used', () => {
    const onRetry = vi.fn();
    render(<MantineProvider><TodayToasts moves={noMoves} captureNotice="Couldn't transcribe. The recording is saved."
      captureRetry={{ audioRef: 'a1' }} onRetryCapture={onRetry} onDismissCapture={() => {}} /></MantineProvider>);
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(onRetry).toHaveBeenCalled();
  });
});
