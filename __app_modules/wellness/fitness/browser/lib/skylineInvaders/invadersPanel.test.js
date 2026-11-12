import { describe, expect, it } from 'vitest';
import { invadersAction, invadersControls, pressForMenuKey, stompAction } from './invadersPanel.js';

const labels = (view) => invadersControls(view).map((control) => control.label);

describe('invadersControls: one decision per screen on the four bike buttons', () => {
  it('who: the riders on their buttons, the rest say Other riders (hold)', () => {
    const view = { screen: 'who', riders: [{ id: 'kid', name: 'Kid', avatarSrc: 'a.png' }] };
    expect(labels(view)).toEqual(['Kid', 'Other riders', 'Other riders', 'Other riders']);
    expect(invadersAction(view, 1)).toBe('pick:kid');
    expect(invadersAction(view, 2)).toBeNull();
    expect(invadersAction(view, 3, 'long')).toBe('open-roster');
  });

  it('waves: previous, next, change shooter, Start — Locked asks for an unlock', () => {
    const view = { screen: 'waves', count: 3, wave: { id: 'w1', name: 'First Light', status: 'open' }, shooterName: 'Kid' };
    expect(labels(view)).toEqual(['Previous', 'Next', 'Change shooter', 'Start']);
    expect(invadersAction(view, 4)).toBe('start');
    expect(invadersAction({ ...view, wave: { ...view.wave, status: 'locked' } }, 4)).toBe('unlock-wave');
    expect(invadersControls({ ...view, count: 1 })[0].disabled).toBe(true);
  });

  it('ready: Skip only with a gamepad connected', () => {
    expect(invadersAction({ screen: 'ready', gamepad: false }, 4)).toBeNull();
    expect(invadersAction({ screen: 'ready', gamepad: true }, 4)).toBe('skip-calibration');
    expect(invadersAction({ screen: 'ready' }, 3)).toBe('back-to-waves');
  });

  it('result: replay, next wave (only when there is one), waves, change shooter; nothing until saved', () => {
    const saved = { screen: 'result', saveStatus: 'saved', wave: { name: 'First Light' }, next: { name: 'Zigzag' } };
    expect(labels(saved)).toEqual(['Replay', 'Next wave', 'Waves', 'Change shooter']);
    expect(invadersAction({ ...saved, next: null }, 2)).toBeNull();
    expect(invadersControls({ ...saved, saveStatus: 'saving' }).every((control) => control.disabled)).toBe(true);
    expect(invadersAction({ ...saved, saveStatus: 'error' }, 1)).toBe('retry-save');
    expect(invadersAction({ ...saved, saveStatus: 'error' }, 2)).toBeNull();
  });

  it('paused, sound and locked', () => {
    expect(labels({ screen: 'paused' }).slice(0, 3)).toEqual(['Resume', 'Sound', 'End round']);
    expect(invadersAction({ screen: 'sound', sound: { level: 0, muted: false } }, 1)).toBeNull();
    expect(invadersAction({ screen: 'sound', sound: { level: 60, muted: false } }, 4)).toBe('toggle-mute');
    expect(invadersAction({ screen: 'locked' }, 1)).toBe('admin-unlock');
    expect(invadersAction({ screen: 'locked' }, 2)).toBeNull();
  });
});

describe('the menu keys and the mat', () => {
  it('map to panel presses; the digits are never used', () => {
    expect(pressForMenuKey('waves', 'accept')).toEqual([4, 'single']);
    expect(pressForMenuKey('waves', 'left')).toEqual([1, 'single']);
    expect(pressForMenuKey('who', 'right')).toEqual([1, 'long']);
    expect(pressForMenuKey('sound', 'accept')).toEqual([3, 'single']);
    expect(pressForMenuKey('locked', 'accept')).toEqual([1, 'single']);
  });

  it('a stomp starts a wave, and after a saved round goes on (next wave after a pass, else replay)', () => {
    expect(stompAction({ screen: 'waves', count: 1, wave: { name: 'A', status: 'open' } })).toBe('start');
    expect(stompAction({ screen: 'result', saveStatus: 'saved', next: { name: 'B' } })).toBe('next-wave');
    expect(stompAction({ screen: 'result', saveStatus: 'saved', next: null })).toBe('replay');
    expect(stompAction({ screen: 'result', saveStatus: 'saving' })).toBeNull();
    expect(stompAction({ screen: 'who' })).toBeNull();
  });
});
