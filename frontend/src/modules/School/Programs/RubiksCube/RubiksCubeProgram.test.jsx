import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    render(<RubiksCubeProgram userId="milo" cubeGrant="grant" />);
    expect(await screen.findByRole('heading', { name: 'Turn practice' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'R' })); });
    await waitFor(() => expect(schoolApi.rubiksCubeTurn).toHaveBeenCalledWith(expect.objectContaining({ lessonId: 'turn-practice', move: 'R', expectedRevision: 0 })));
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    await waitFor(() => expect(schoolApi.rubiksCubeRestart).toHaveBeenCalledWith(expect.objectContaining({ lessonId: 'turn-practice' })));
  });
});
