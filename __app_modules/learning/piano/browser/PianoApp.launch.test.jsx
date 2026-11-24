import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ handlers: null, navigate: vi.fn(), setPlaying: vi.fn(), setVideoActive: vi.fn(), sendPanic: vi.fn(), setCurrentUser: vi.fn(), open: vi.fn(), openCourse: vi.fn() }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => h.navigate }));
vi.mock('./PianoKiosk/useKioskLaunchCommand.js', () => ({ useKioskLaunchCommand: (handlers) => { h.handlers = handlers; } }));
vi.mock('./PianoKiosk/pianoContentOpen.js', () => ({ openPianoContent: (...a) => h.open(...a), openPianoCourseLesson: (...a) => h.openCourse(...a) }));
vi.mock('./PianoKiosk/usePianoPlayback.js', () => ({ usePianoPlayback: () => ({ setPlaying: h.setPlaying, setVideoActive: h.setVideoActive }) }));
vi.mock('./PianoKiosk/PianoMidiContext.jsx', async (orig) => ({ ...(await orig()), usePianoMidi: () => ({ sendPanic: h.sendPanic }) }));
vi.mock('./PianoKiosk/PianoUserContext.jsx', async (orig) => ({ ...(await orig()), usePianoUser: () => ({ setCurrentUser: h.setCurrentUser }) }));
vi.mock('./PianoKiosk/PianoConfig.jsx', async (orig) => ({ ...(await orig()), usePianoKioskConfig: () => ({ basePath: '/piano' }) }));

const { KioskLaunchListener } = await import('./PianoApp.jsx');

describe('KioskLaunchListener', () => {
  beforeEach(() => { for (const fn of [h.navigate, h.setPlaying, h.setVideoActive, h.sendPanic, h.setCurrentUser, h.open, h.openCourse]) fn.mockClear(); });
  it('silences whatever was playing before a remote open of sheet music', () => {
    render(<KioskLaunchListener />);
    h.handlers.onPianoOpen('files:docs/sheet-music/x.mxl', { play: 'learn' });
    expect(h.setPlaying).toHaveBeenCalledWith(false);
    expect(h.setVideoActive).toHaveBeenCalledWith(false);
    expect(h.sendPanic).toHaveBeenCalledTimes(1);
    expect(h.open).toHaveBeenCalledWith({ contentId: 'files:docs/sheet-music/x.mxl', basePath: '/piano', navigate: h.navigate, play: 'learn' });
    expect(h.sendPanic.mock.invocationCallOrder[0]).toBeLessThan(h.open.mock.invocationCallOrder[0]);
  });
  it('still silences and switches the learner on a course open', () => {
    render(<KioskLaunchListener />);
    h.handlers.onPianoCourseOpen({ learnerId: 'kid', courseId: 'c', lessonId: 'l' });
    expect(h.sendPanic).toHaveBeenCalledTimes(1);
    expect(h.setCurrentUser).toHaveBeenCalledWith('kid');
  });
});
