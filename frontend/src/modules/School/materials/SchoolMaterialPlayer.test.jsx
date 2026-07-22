import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SchoolMaterialPlayer from './SchoolMaterialPlayer.jsx';

const unitProgressMock = vi.fn();
const bankMock = vi.fn();
vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    unitProgress: (...a) => unitProgressMock(...a),
    bank: (...a) => bankMock(...a),
  },
}));

const materialsErrorMock = vi.fn();
const materialsMock = vi.fn();
vi.mock('../schoolLog.js', () => ({
  schoolLog: {
    materials: (...a) => materialsMock(...a),
    materialsError: (...a) => materialsErrorMock(...a),
  },
}));

// Stand in for the shared Player: exposes buttons the test can tap to fire
// the two signals SchoolMaterialPlayer wires — onProgress (timeupdate tick)
// and clear() (the single natural-end/exit signal, same as PianoVideoPlayer).
vi.mock('../../Player/Player.jsx', () => ({
  default: ({ play, clear, onProgress }) => (
    <div data-testid="player-stub">
      <span data-testid="content-id">{play?.contentId}</span>
      <button type="button" onClick={() => onProgress({ currentTime: 5, duration: 100, percent: '5.0' })}>tick</button>
      <button type="button" onClick={() => clear()}>simulate-end</button>
    </div>
  ),
}));

vi.mock('../quiz/QuizRunner.jsx', () => ({
  default: ({ bank, onExit }) => (
    <div data-testid="quiz-runner">
      <span data-testid="quiz-bank-id">{bank?.id}</span>
      <button type="button" onClick={onExit}>quiz-done</button>
    </div>
  ),
}));

const material = { id: 'plex:1', title: 'Bill Nye', medium: 'video' };
const unit = { id: 'plex:10', title: 'Air', quiz: null };
const unitWithQuiz = { id: 'plex:10', title: 'Air', quiz: { bankId: 'bank_1' } };

beforeEach(() => {
  unitProgressMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
  bankMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { id: 'bank_1', title: 'Air Quiz', items: [] } });
  materialsMock.mockReset();
  materialsErrorMock.mockReset();
});

async function findPlayer() {
  return screen.findByTestId('player-stub');
}

describe('SchoolMaterialPlayer', () => {
  it('plays unit.id as the plex content id', async () => {
    render(<SchoolMaterialPlayer material={material} unit={unit} userId="kid1" onExit={() => {}} />);
    await findPlayer();
    expect(screen.getByTestId('content-id').textContent).toBe('plex:10');
  });

  it('logs player-start on mount', async () => {
    render(<SchoolMaterialPlayer material={material} unit={unit} userId="kid1" onExit={() => {}} />);
    await findPlayer();
    expect(materialsMock).toHaveBeenCalledWith('player-start', { materialId: 'plex:1', unitId: 'plex:10', medium: 'video' });
  });

  it('throttles progress writes: two rapid ticks produce exactly one write, only when userId is present', async () => {
    render(<SchoolMaterialPlayer material={material} unit={unit} userId="kid1" onExit={() => {}} />);
    await findPlayer();
    fireEvent.click(screen.getByText('tick'));
    fireEvent.click(screen.getByText('tick'));
    await waitFor(() => expect(unitProgressMock).toHaveBeenCalledTimes(1));
    expect(unitProgressMock).toHaveBeenCalledWith('plex:1', 'plex:10', {
      userId: 'kid1', percent: 5, playhead: 5, durationMs: 100000,
    });
  });

  it('guest (no userId): zero progress writes ever, including the final unmount flush', async () => {
    const { unmount } = render(<SchoolMaterialPlayer material={material} unit={unit} userId={undefined} onExit={() => {}} />);
    await findPlayer();
    fireEvent.click(screen.getByText('tick'));
    unmount();
    expect(unitProgressMock).not.toHaveBeenCalled();
  });

  it('flushes a final write on unmount (manual exit) even though the throttle window has not elapsed', async () => {
    const onExit = vi.fn();
    const { unmount } = render(<SchoolMaterialPlayer material={material} unit={unit} userId="kid1" onExit={onExit} />);
    await findPlayer();
    fireEvent.click(screen.getByText('tick')); // first tick writes immediately (throttle window starts empty)
    await waitFor(() => expect(unitProgressMock).toHaveBeenCalledTimes(1));
    unmount();
    // unmount flush re-sends the latest known progress even though <10s elapsed
    await waitFor(() => expect(unitProgressMock).toHaveBeenCalledTimes(2));
  });

  it('the visible exit row flushes progress and exits with {refetch:true}, without any quiz handoff', async () => {
    const onExit = vi.fn();
    render(<SchoolMaterialPlayer material={material} unit={unitWithQuiz} userId="kid1" onExit={onExit} />);
    await findPlayer();
    fireEvent.click(screen.getByText('tick'));
    fireEvent.click(screen.getByRole('button', { name: /Bill Nye/i }));
    expect(onExit).toHaveBeenCalledWith({ refetch: true });
    expect(bankMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quiz-runner')).toBeNull();
  });

  it('end without a quiz calls onExit({refetch:true})', async () => {
    const onExit = vi.fn();
    render(<SchoolMaterialPlayer material={material} unit={unit} userId="kid1" onExit={onExit} />);
    await findPlayer();
    fireEvent.click(screen.getByText('simulate-end'));
    await waitFor(() => expect(onExit).toHaveBeenCalledWith({ refetch: true }));
    expect(bankMock).not.toHaveBeenCalled();
  });

  it('end with a quiz fetches the bank and renders QuizRunner; its onExit calls the player onExit with {refetch:true}', async () => {
    const onExit = vi.fn();
    render(<SchoolMaterialPlayer material={material} unit={unitWithQuiz} userId="kid1" onExit={onExit} />);
    await findPlayer();
    fireEvent.click(screen.getByText('simulate-end'));
    expect(await screen.findByTestId('quiz-runner')).toBeInTheDocument();
    expect(bankMock).toHaveBeenCalledWith('bank_1');
    expect(screen.getByTestId('quiz-bank-id').textContent).toBe('bank_1');
    expect(materialsMock).toHaveBeenCalledWith('quiz-handoff', { bankId: 'bank_1' });

    fireEvent.click(screen.getByText('quiz-done'));
    expect(onExit).toHaveBeenCalledWith({ refetch: true });
  });

  it('a bank-fetch failure logs an error and exits (never strands the child)', async () => {
    bankMock.mockResolvedValue({ ok: false, status: 500, data: null });
    const onExit = vi.fn();
    render(<SchoolMaterialPlayer material={material} unit={unitWithQuiz} userId="kid1" onExit={onExit} />);
    await findPlayer();
    fireEvent.click(screen.getByText('simulate-end'));
    await waitFor(() => expect(onExit).toHaveBeenCalledWith({ refetch: true }));
    expect(materialsErrorMock).toHaveBeenCalledWith('quiz-bank-load-failed', { bankId: 'bank_1' });
    expect(screen.queryByTestId('quiz-runner')).toBeNull();
  });
});
