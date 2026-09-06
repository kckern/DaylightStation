import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// The wall-clock budget for this file's finds is the suite-wide one now
// (frontend/src/test-setup.js, 15s). A local `configure({ asyncUtilTimeout })`
// used to sit here raising the 1s default; left in place it would CLAMP the
// higher global back down, which is the opposite of what it was written to do.
import RubiksCubeProgram from './RubiksCubeProgram.jsx';
import { COLORS, FACES } from '@shared-gaming/rulesets/rubiks-cube/index.mjs';
import { schoolApi } from '../../schoolApi.js';

vi.mock('../../schoolApi.js', () => ({ schoolApi: {
  rubiksCubePreview: vi.fn(), rubiksCubeOpen: vi.fn(), rubiksCubeTurn: vi.fn(), rubiksCubeRestart: vi.fn(), rubiksCubeDemo: vi.fn(), rubiksCubeHint: vi.fn(), rubiksCubeAnswer: vi.fn(),
} }));

const cube = Object.fromEntries(FACES.map((face) => [face, Array(9).fill(COLORS[face])]));
const demo = { id: 'centres-and-pieces', title: 'Centres, edges, and corners', kind: 'demo', prompt: 'Centres stay put.', moves: ['R', "R'"] };
const active = { lessonId: demo.id, revision: 0, cube, moves: [], hints: 0 };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('RubiksCubeProgram', () => {
  it('offers an untracked, replayable first-demo preview', async () => {
    schoolApi.rubiksCubePreview.mockResolvedValue({ ok: true, data: { course: { title: 'Rubik’s Cube Foundations' }, lesson: demo, active, preview: true } });
    render(<RubiksCubeProgram />);
    expect(await screen.findByText('Centres, edges, and corners')).toBeInTheDocument();
    // SETTLE BEFORE DRIVING. `demoPlaying` is reset by an effect keyed on
    // `lesson?.id`, which goes undefined -> 'centres-and-pieces' when the load
    // commits. The heading (what the find above waits on) paints with that
    // commit, but the passive effect flushes after it — so on a starved worker
    // the order becomes: click sets demoPlaying true, THEN the pending reset
    // sets it false, and the button is back to 'Replay demonstration' by the
    // time it is read. Reproduced 2/10 under CPU load (2026-09-06); the dump
    // showed the reverted label, not a missing tree. Flushing here puts the
    // reset before the click, where it belongs, and it must happen on the real
    // clock — the fake timers below cannot run an effect they never scheduled.
    await act(async () => {});
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Replay demonstration' }));
    expect(screen.getByRole('button', { name: 'Playing…' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1_100); });
    expect(screen.getByRole('button', { name: 'Replay demonstration' })).toBeInTheDocument();
  });

  it('sends a revision-guarded turn and exposes a reset for assigned work', async () => {
    const lesson = { ...demo, id: 'turn-practice', title: 'Turn practice', kind: 'lesson', moves: undefined };
    const assigned = { course: { title: 'Rubik’s Cube Foundations', units: [{ id: 'u', title: 'Know the cube', lessons: [{ id: lesson.id, title: lesson.title, kind: lesson.kind, unlocked: true, completed: false }] }] }, lesson, active: { ...active, lessonId: lesson.id }, progress: { completed: 0, total: 1, score: 0 } };
    schoolApi.rubiksCubeOpen.mockResolvedValue({ ok: true, data: assigned });
    schoolApi.rubiksCubeTurn.mockResolvedValue({ ok: true, data: assigned });
    schoolApi.rubiksCubeRestart.mockResolvedValue({ ok: true, data: assigned });
    render(<RubiksCubeProgram userId="learner3" cubeGrant="grant" />);
    expect(await screen.findByRole('heading', { name: 'Turn practice' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'R' })); });
    await waitFor(() => expect(schoolApi.rubiksCubeTurn).toHaveBeenCalledWith(expect.objectContaining({ lessonId: 'turn-practice', move: 'R', expectedRevision: 0 })));
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    await waitFor(() => expect(schoolApi.rubiksCubeRestart).toHaveBeenCalledWith(expect.objectContaining({ lessonId: 'turn-practice' })));
  });
});
