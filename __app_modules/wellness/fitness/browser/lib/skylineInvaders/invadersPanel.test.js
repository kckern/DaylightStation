import { describe, expect, it } from 'vitest';
import { invadersAction, invadersControls, pressForMenuKey, stompAction } from './invadersPanel.js';

const labels = (view) => invadersControls(view).map((control) => control.label);

describe('invadersControls: one decision per screen, as four touch keys', () => {
  it('who: the riders on their buttons, the rest say Someone else (hold)', () => {
    const view = { screen: 'who', riders: [{ id: 'kid', name: 'Kid', avatarSrc: 'a.png' }] };
    expect(labels(view)).toEqual(['Kid', 'Someone else', 'Someone else', 'Someone else']);
    expect(invadersAction(view, 1)).toBe('pick:kid');
    expect(invadersAction(view, 2)).toBeNull();
    expect(invadersAction(view, 3, 'long')).toBe('open-roster');
  });

  it('waves: previous, next, change defender, Start — Locked asks for an unlock', () => {
    const view = { screen: 'waves', count: 3, wave: { id: 'w1', name: 'First Light', status: 'open' }, shooterName: 'Kid' };
    expect(labels(view)).toEqual(['Previous', 'Next', 'Change defender', 'Start']);
    expect(invadersAction(view, 4)).toBe('start');
    expect(invadersAction({ ...view, wave: { ...view.wave, status: 'locked' } }, 4)).toBe('unlock-wave');
    expect(invadersControls({ ...view, count: 1 })[0].disabled).toBe(true);
  });

  it('ready: Skip only with a gamepad connected', () => {
    expect(invadersAction({ screen: 'ready', gamepad: false }, 4)).toBeNull();
    expect(invadersAction({ screen: 'ready', gamepad: true }, 4)).toBe('skip-ready');
    expect(invadersAction({ screen: 'ready' }, 3)).toBe('back-to-waves');
  });

  it('result: replay, next wave (only when there is one), waves, change defender; nothing until saved', () => {
    const saved = { screen: 'result', saveStatus: 'saved', wave: { name: 'First Light' }, next: { name: 'Zigzag' } };
    expect(labels(saved)).toEqual(['Replay', 'Next wave', 'Waves', 'Change defender']);
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

describe('controls and exit: keys of their own, past the four panel positions', () => {
  const waves = { screen: 'waves', count: 3, wave: { id: 'w1', name: 'First Light', status: 'open' }, shooterName: 'Kid', mat: true };

  it('waves: a defender with no controls picks them where Start would be, and a stomp opens the intro', () => {
    const view = { ...waves, needsControls: true };
    expect(labels(view)).toEqual(['Previous', 'Next', 'Change defender', 'Pick controls']);
    expect(invadersControls(view)[3].hint).toBe('Or stomp the mat');
    expect(invadersAction(view, 4)).toBe('open-controls');
    expect(stompAction(view)).toBe('open-controls');
    // A locked wave still asks for its unlock first.
    expect(invadersAction({ ...view, wave: { ...view.wave, status: 'locked' } }, 4)).toBe('unlock-wave');
  });

  it('waves: a defender with saved controls gets a Controls key naming them', () => {
    const view = { ...waves, controlsName: 'Twist' };
    expect(labels(view)).toEqual(['Previous', 'Next', 'Change defender', 'Start', 'Controls']);
    expect(invadersControls(view)[4]).toMatchObject({ position: 5, hint: 'Twist' });
    expect(invadersAction(view, 5)).toBe('open-controls');
    expect(invadersAction(waves, 5)).toBeNull();
    expect(pressForMenuKey('waves', 'up')).toEqual([5, 'single']);
  });

  it('controls: back, next (a mat step), not now, use these (a stomp)', () => {
    const view = { screen: 'controls', mat: true, cardName: 'Wipers' };
    expect(labels(view)).toEqual(['Back', 'Next', 'Not now', 'Use these']);
    expect(invadersControls(view).map((control) => control.hint)).toEqual(['The one before', 'Or step on the mat', 'Back to the waves', 'Or stomp the mat']);
    expect([1, 2, 3, 4].map((position) => invadersAction(view, position))).toEqual(['controls-prev', 'controls-next', 'controls-close', 'controls-use']);
    expect(stompAction(view)).toBe('controls-use');
    expect(labels({ ...view, controlsName: 'Twist' })[2]).toBe('Keep mine');
    expect(invadersControls({ ...view, mat: false })[1].hint).toBe('The next one');
    expect(['left', 'right', 'back', 'accept'].map((action) => pressForMenuKey('controls', action)[0])).toEqual([1, 2, 3, 4]);
    expect(pressForMenuKey('controls', 'down')).toBeNull();      // no Exit over the tryout: Not now is the way back
  });

  it('exit: a key on every screen a player can stop on, only when the host can close the game', () => {
    const screens = [
      { screen: 'who', riders: [] }, waves, { screen: 'locked' }, { screen: 'paused' }, { screen: 'error' }, { screen: 'loading' },
      { screen: 'result', saveStatus: 'saved' }, { screen: 'result', saveStatus: 'saving' }, { screen: 'result', saveStatus: 'error' },
    ];
    for (const view of screens) {
      expect({ screen: view.screen, save: view.saveStatus, exit: invadersAction({ ...view, canExit: true }, 6) }).toEqual({ screen: view.screen, save: view.saveStatus, exit: 'exit' });
      expect(invadersControls({ ...view, canExit: true }).find((control) => control.position === 6)).toMatchObject({ label: 'Exit' });
      expect(invadersAction(view, 6)).toBeNull();
      expect(invadersControls(view).some((control) => control.position === 6)).toBe(false);
    }
    for (const screen of ['roster', 'ready', 'sound', 'controls']) expect(invadersAction({ screen, canExit: true }, 6)).toBeNull();
    expect(invadersControls({ screen: 'paused', canExit: true })[4].hint).toBe('Ends the round and leaves');
    expect(invadersControls({ screen: 'result', saveStatus: 'saving', canExit: true })[4].hint).toBe('Leave without waiting');
  });

  it('exit on the keys and the gamepad: down everywhere, and back on the first screen', () => {
    for (const screen of ['who', 'waves', 'locked', 'paused', 'result', 'error', 'loading']) expect(pressForMenuKey(screen, 'down')).toEqual([6, 'single']);
    expect(pressForMenuKey('who', 'back')).toEqual([6, 'single']);
    expect(pressForMenuKey('error', 'back')).toEqual([6, 'single']);
    // Elsewhere back keeps its own meaning.
    expect(pressForMenuKey('waves', 'back')).toEqual([3, 'single']);
    expect(pressForMenuKey('paused', 'back')).toEqual([1, 'single']);
  });
});
