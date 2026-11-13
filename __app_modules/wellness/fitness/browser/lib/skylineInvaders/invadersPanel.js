// The Skyline Invaders menu actions, at four positions. Pure: what each key
// says on each screen (`invadersControls`), and what a press does
// (`invadersAction`). The shell draws them as touch keys and turns an action
// into the work; the keyboard, gamepad and mat press the same positions.
// Invaders does not listen to the bike buttons: the defender stands on the mat.
//
// One decision per screen. Start is always button 4, and a stomp on the mat:
//   who      1–4 the people in the workout (hold any: everyone else)   6 exit
//   roster   1 previous  2 next  3 back  4 choose
//   waves    1 previous  2 next  3 change defender  4 start (locked: admin unlock;
//            no controls picked yet: pick controls)   5 controls   6 exit
//   controls 1 previous card  2 next card (a mat step)  3 not now / keep mine  4 use these (a stomp)
//   locked   1 admin unlock  3 back  4 change defender   6 exit
//   ready    3 back  4 skip (only with a gamepad connected)
//   paused   1 resume  2 sound  3 end round   6 exit
//   result   1 replay  2 next wave  3 waves  4 change defender   6 exit
//   sound    1 quieter  2 louder  3 back  4 mute
//   error    1 try again   6 exit
//   loading  6 exit
// Positions 5 and 6 are past the four panel positions: Controls and Exit are
// keys of their own, never one of a screen's four decisions. Exit is drawn
// only when the host gave the game a way to close (`view.canExit`).
// Keys and the gamepad (the digits are the kiosk OS's): left = 1, right = 2,
// back = 3, accept = 4, up = 5 (controls), down = 6 (exit). Exceptions: on the
// who screen accept takes the first person, right opens everyone else and back
// is Exit (it is the first screen: back from it leaves); on the lock screen
// accept asks a grown-up; on pause accept and back resume; on the Sound sheet
// accept goes back, so a stray foot-pad press only closes it.

/** The one hint a touch key shows: the mat does the same thing. */
export const STOMP_HINT = 'Or stomp the mat';
/** The controls intro's Next key: a step on the mat turns the card. */
export const STEP_HINT = 'Or step on the mat';
/** Hints a touch key draws under its label (the rest stay as the title). */
export const DRAWN_HINTS = Object.freeze([STOMP_HINT, STEP_HINT]);

const blank = (position, label = '', hint = '') => ({ position, label, hint, icon: '—', disabled: true });
const key = (position, label, hint, icon, extra = {}) => ({ position, label, hint: hint || '', icon, ...extra });

/**
 * @param {object} view
 * @param {string} view.screen   who | roster | waves | controls | locked | ready | paused | result | sound | loading | error
 * @param {boolean} [view.canExit]        the host gave the game a way to close
 * @param {boolean} [view.needsControls]  the defender has a camera and no saved controls
 * @param {string} [view.controlsName]    the defender's saved controls, by name
 * @param {string} [view.cardName]        the controls card in hand
 * @returns {{ position: number, label: string, hint: string, icon: string, avatarSrc?: string, disabled?: boolean }[]}
 */
export function invadersControls(view) {
  const v = view || {};
  // Exit: the way out of the game, on every screen a player can stop on.
  const exit = (hint = 'Leave the game') => (v.canExit ? [key(6, 'Exit', hint, '×')] : []);
  switch (v.screen) {
    case 'who': {
      const riders = v.riders || [];
      return [1, 2, 3, 4].map((position) => {
        const rider = riders[position - 1];
        return rider
          ? key(position, rider.name, 'Hold: someone else', '●', { avatarSrc: rider.avatarSrc })
          : key(position, 'Someone else', 'Hold', '●');
      }).concat(exit());
    }
    case 'roster':
      return [key(1, 'Previous', 'Browse people', '←'), key(2, 'Next', 'Browse people', '→'), key(3, 'Back', 'In the workout', '×'), key(4, 'Choose', v.person?.name || '', '✓', { disabled: !v.person })];
    case 'waves': {
      const locked = v.wave?.status === 'locked';
      return [
        key(1, 'Previous', 'Pick a wave', '←', { disabled: (v.count || 0) < 2 }),
        key(2, 'Next', 'Pick a wave', '→', { disabled: (v.count || 0) < 2 }),
        key(3, 'Change defender', v.shooterName || '', '●'),
        // The mat is the main action: Start says so. A defender who has not
        // picked their controls yet (and has a camera to aim with) picks them first.
        locked ? key(4, 'Locked', 'Admin unlock', '✓')
          : v.needsControls ? key(4, 'Pick controls', v.mat ? STOMP_HINT : 'How you aim', '✓', { disabled: !v.wave })
            : key(4, 'Start', v.mat ? STOMP_HINT : v.wave?.name || '', '✓', { disabled: !v.wave }),
        ...(v.controlsName && !locked ? [key(5, 'Controls', v.controlsName, '●')] : []),
        ...exit(),
      ];
    }
    case 'controls':
      return [
        key(1, 'Back', 'The one before', '←'),
        key(2, 'Next', v.mat ? STEP_HINT : 'The next one', '→'),
        key(3, v.controlsName ? 'Keep mine' : 'Not now', v.controlsName || 'Back to the waves', '×'),
        key(4, 'Use these', v.mat ? STOMP_HINT : v.cardName || '', '✓'),
      ];
    case 'locked':
      return [key(1, 'Admin unlock', 'Grown-up fingerprint', '✓'), blank(2, 'Locked'), key(3, 'Back', 'Choose defender', '×'), key(4, 'Change defender', 'Someone else', '●'), ...exit()];
    case 'ready':
      return [blank(1), blank(2), key(3, 'Back', 'Pick a wave', '×'), v.gamepad ? key(4, 'Skip', 'Gamepad aim', '✓') : blank(4, 'Reach', 'Arms out')];
    case 'paused':
      return [key(1, 'Resume', 'Clock starts', '✓'), key(2, 'Sound', 'Volume and mute', '♫'), key(3, 'End round', 'Save it as ended', '×'), blank(4, 'Paused'), ...exit('Ends the round and leaves')];
    case 'result': {
      // The way out never waits on a save: nobody should have to reload the page to leave.
      if (v.saveStatus === 'error') return [key(1, 'Retry save', 'Keep this result', '↻'), blank(2, 'Saving required'), blank(3, 'Saving required'), blank(4, 'Saving required'), ...exit('Leave without waiting')];
      if (v.saveStatus !== 'saved') return [...[1, 2, 3, 4].map((position) => blank(position, 'Saving…')), ...exit('Leave without waiting')];
      return [
        key(1, 'Replay', v.mat && !v.next ? STOMP_HINT : v.wave?.name || '', '↻'),
        v.next ? key(2, 'Next wave', v.mat ? STOMP_HINT : v.next.name, '→') : blank(2, 'No next wave yet'),
        key(3, 'Waves', 'Pick another', '▦'),
        key(4, 'Change defender', 'Someone else', '●'),
        ...exit(),
      ];
    }
    case 'sound': {
      const muted = !!v.sound?.muted;
      const level = v.sound?.level ?? 0;
      const now = muted ? 'Muted' : `Volume ${level}`;
      return [
        key(1, 'Quieter', now, '←', { disabled: muted || level <= 0 }),
        key(2, 'Louder', now, '→', { disabled: level >= 100 && !muted }),
        key(3, 'Back', 'Return', '×'),
        key(4, muted ? 'Unmute' : 'Mute', muted ? 'Sound back on' : 'Silence the game', '♫'),
      ];
    }
    case 'error':
      return [key(1, 'Try again', 'Load the waves', '↻'), blank(2), blank(3), blank(4), ...exit()];
    default:
      return [...[1, 2, 3, 4].map((position) => blank(position, 'Please wait')), ...exit()];
  }
}

/**
 * What a press means on a screen. `gesture` is single | long | double; only
 * the who screen listens to a hold. `null` = nothing.
 * @returns {string|null}
 */
export function invadersAction(view, position, gesture = 'single') {
  const v = view || {};
  const control = invadersControls(v).find((item) => item.position === position);
  if (v.screen === 'who') {
    if (position === 6) return gesture === 'single' && v.canExit ? 'exit' : null;
    if (gesture !== 'single') return 'open-roster';
    return v.riders?.[position - 1] ? `pick:${v.riders[position - 1].id}` : null;
  }
  if (gesture !== 'single' || !control || control.disabled) return null;
  const table = {
    roster: { 1: 'roster-prev', 2: 'roster-next', 3: 'close-roster', 4: 'roster-choose' },
    waves: { 1: 'wave-prev', 2: 'wave-next', 3: 'change-shooter', 4: v.wave?.status === 'locked' ? 'unlock-wave' : v.needsControls ? 'open-controls' : 'start', 5: 'open-controls', 6: 'exit' },
    controls: { 1: 'controls-prev', 2: 'controls-next', 3: 'controls-close', 4: 'controls-use' },
    locked: { 1: 'admin-unlock', 3: 'change-shooter', 4: 'change-shooter', 6: 'exit' },
    ready: { 3: 'back-to-waves', 4: 'skip-ready' },
    paused: { 1: 'resume', 2: 'open-sound', 3: 'end-round', 6: 'exit' },
    result: v.saveStatus === 'error' ? { 1: 'retry-save', 6: 'exit' } : { 1: 'replay', 2: 'next-wave', 3: 'waves', 4: 'change-shooter', 6: 'exit' },
    sound: { 1: 'quieter', 2: 'louder', 3: 'close-sound', 4: 'toggle-mute' },
    error: { 1: 'retry-load', 6: 'exit' },
    loading: { 6: 'exit' },
  };
  return table[v.screen]?.[position] || null;
}

/** The menu keys (keyboard, foot pad, gamepad) as a press: `[position, gesture]`, or null. */
export function pressForMenuKey(screen, action) {
  const at = (position, gesture = 'single') => [position, gesture];
  // Who: accept takes the first rider; right opens everyone else; back leaves the game.
  if (screen === 'who') return { accept: at(1), right: at(1, 'long'), back: at(6), down: at(6) }[action] ?? null;
  if (screen === 'locked') return { accept: at(1), back: at(3), down: at(6) }[action] ?? null;
  if (screen === 'sound') return { left: at(1), right: at(2), back: at(3), accept: at(3) }[action] ?? null;
  if (screen === 'paused') return { accept: at(1), back: at(1), right: at(2), down: at(6) }[action] ?? null;
  if (screen === 'error') return { accept: at(1), back: at(6), down: at(6) }[action] ?? null;
  if (screen === 'loading') return { back: at(6), down: at(6) }[action] ?? null;
  if (screen === 'controls' || screen === 'roster' || screen === 'ready') return { left: at(1), right: at(2), back: at(3), accept: at(4) }[action] ?? null;
  // Waves and result: up is Controls, down is Exit.
  return { left: at(1), right: at(2), back: at(3), accept: at(4), up: at(5), down: at(6) }[action] ?? null;
}

/** A stomp on the mat: Start on the wave list; pick the card in the controls intro; on a saved result, the next wave after a pass, else replay. */
export function stompAction(view) {
  const v = view || {};
  if (v.screen === 'waves') return invadersAction(v, 4);
  if (v.screen === 'controls') return 'controls-use';
  if (v.screen === 'result' && v.saveStatus === 'saved') return v.next ? 'next-wave' : 'replay';
  return null;
}
