import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SchoolMaterialPlayer from './SchoolMaterialPlayer.jsx';

const unitProgressMock = vi.fn();
const bankMock = vi.fn();
const materialUnitsMock = vi.fn();
vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    unitProgress: (...a) => unitProgressMock(...a),
    bank: (...a) => bankMock(...a),
    materialUnits: (...a) => materialUnitsMock(...a),
  },
}));

const materialsErrorMock = vi.fn();
const materialsMock = vi.fn();
vi.mock('../schoolLog.js', () => ({
  schoolLog: {
    materials: (...a) => materialsMock(...a),
    materialsError: (...a) => materialsErrorMock(...a),
    player: vi.fn(),
  },
}));

// Stand in for the shared Player: exposes buttons the test can tap to fire
// the two signals SchoolMaterialPlayer wires — onProgress (timeupdate tick)
// and clear() (the single natural-end/exit signal, same as PianoVideoPlayer) —
// plus the imperative ref API useMediaChrome drives the transport through.
// A real <video> element backs it so the chrome's timeupdate mirroring works.
let fakeMedia = null;
const toggleMock = vi.fn();
function playerApi() {
  return {
    getMediaElement: () => fakeMedia,
    getCurrentTime: () => fakeMedia?.currentTime || 0,
    getDuration: () => 0,
    toggle: toggleMock,
    seek: (t) => {
      if (!fakeMedia) return;
      fakeMedia.currentTime = t;
      fakeMedia.dispatchEvent(new Event('timeupdate'));
    },
  };
}
vi.mock('../../Player/Player.jsx', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(({ play, clear, onProgress }, ref) => {
      useImperativeHandle(ref, () => playerApi(), []);
      return (
        <div data-testid="player-stub">
          <span data-testid="content-id">{play?.contentId}</span>
          <button type="button" onClick={() => onProgress({ currentTime: 5, duration: 100, percent: '5.0' })}>tick</button>
          <button type="button" onClick={() => clear()}>simulate-end</button>
        </div>
      );
    }),
  };
});

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
  materialUnitsMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { units: [] } });
  materialsMock.mockReset();
  materialsErrorMock.mockReset();
  toggleMock.mockReset();
  fakeMedia = document.createElement('video');
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

  it('leaving via the header breadcrumb (unmount) flushes progress but does NOT hand off to the quiz', async () => {
    // The player no longer renders its own back row — navigation is the app
    // header breadcrumb, which unmounts the player. Unmounting must flush the
    // final progress write, and (unlike a natural end) must never trigger the
    // quiz handoff.
    const { unmount } = render(<SchoolMaterialPlayer material={material} unit={unitWithQuiz} userId="kid1" onExit={() => {}} />);
    await findPlayer();
    fireEvent.click(screen.getByText('tick'));
    await waitFor(() => expect(unitProgressMock).toHaveBeenCalledTimes(1));
    unmount();
    await waitFor(() => expect(unitProgressMock).toHaveBeenCalledTimes(2)); // unmount flush
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

  // --- video tap zones: rewind | play-pause | forward, in equal thirds ------
  describe('video tap zones', () => {
    const zones = (container) => [...container.querySelectorAll('.school-material-player__zone')];

    it('splits the video into three zones (none of them for audio)', async () => {
      const { container, rerender } = render(<SchoolMaterialPlayer material={material} unit={unit} userId="kid1" onExit={() => {}} />);
      await findPlayer();
      expect(zones(container).map((z) => z.getAttribute('aria-label')))
        .toEqual(['Back 15 seconds', 'Play', 'Forward 15 seconds']);

      rerender(<SchoolMaterialPlayer material={{ ...material, medium: 'audio' }} unit={unit} userId="kid1" onExit={() => {}} />);
      expect(zones(container)).toHaveLength(0);
    });

    it('the middle zone toggles playback; the side zones seek ∓15s', async () => {
      const { container } = render(<SchoolMaterialPlayer material={material} unit={unit} userId="kid1" onExit={() => {}} />);
      await findPlayer();
      const [rew, mid, fwd] = zones(container);

      fireEvent.click(mid);
      expect(toggleMock).toHaveBeenCalledTimes(1);

      fireEvent.click(fwd);
      expect(fakeMedia.currentTime).toBe(15);
      fireEvent.click(fwd);
      expect(fakeMedia.currentTime).toBe(30);
      fireEvent.click(rew);
      expect(fakeMedia.currentTime).toBe(15);
      // Never past the start, however many taps.
      fireEvent.click(rew);
      fireEvent.click(rew);
      expect(fakeMedia.currentTime).toBe(0);
    });
  });

  // --- prev = restart, then previous unit (the CD-player button) ------------
  describe('the leftmost transport button', () => {
    const prevUnit = { id: 'plex:9', title: 'Water', quiz: null };
    const prevBtn = () => screen.getByRole('button', { name: /restart, or previous/i });

    beforeEach(() => {
      materialUnitsMock.mockResolvedValue({ ok: true, status: 200, data: { units: [prevUnit, unit] } });
    });

    it('steps to the previous unit when already at the start', async () => {
      const onNavigate = vi.fn();
      render(<SchoolMaterialPlayer material={material} unit={unit} userId="kid1" onExit={() => {}} onNavigate={onNavigate} />);
      await findPlayer();
      await waitFor(() => expect(prevBtn()).not.toBeDisabled());
      fireEvent.click(prevBtn());
      expect(onNavigate).toHaveBeenCalledWith(prevUnit);
    });

    it('restarts (and does NOT navigate) once past the restart window', async () => {
      const onNavigate = vi.fn();
      const { container } = render(<SchoolMaterialPlayer material={material} unit={unit} userId="kid1" onExit={() => {}} onNavigate={onNavigate} />);
      await findPlayer();
      const fwd = container.querySelectorAll('.school-material-player__zone')[2];
      fireEvent.click(fwd); // 15s in — past the 10s window
      fireEvent.click(prevBtn());
      expect(onNavigate).not.toHaveBeenCalled();
      expect(fakeMedia.currentTime).toBe(0);
    });

    it('is enabled on the FIRST unit once playing, because restart is still available', async () => {
      materialUnitsMock.mockResolvedValue({ ok: true, status: 200, data: { units: [unit] } });
      const { container } = render(<SchoolMaterialPlayer material={material} unit={unit} userId="kid1" onExit={() => {}} />);
      await findPlayer();
      expect(prevBtn()).toBeDisabled(); // at 0:00 with nothing before it
      fireEvent.click(container.querySelectorAll('.school-material-player__zone')[2]);
      expect(prevBtn()).not.toBeDisabled();
    });
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
