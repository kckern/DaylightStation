// The Skyline Invaders menus as the four bike buttons. Pure: what each button
// says on each screen (`invadersControls`), and what a press does
// (`invadersAction`). The shell turns an action into the work.
//
// One decision per screen. Start is always button 4, and a stomp on the mat:
//   who      1–4 the people in the workout (hold any: everyone else)
//   roster   1 previous  2 next  3 back  4 choose
//   waves    1 previous  2 next  3 change shooter  4 start (locked: admin unlock)
//   locked   1 admin unlock  3 back  4 change shooter
//   ready    3 back  4 skip (only with a gamepad connected)
//   paused   1 resume  2 sound  3 end round
//   result   1 replay  2 next wave  3 waves  4 change shooter
//   sound    1 quieter  2 louder  3 back  4 mute
// Keys and the gamepad (the digits are the kiosk OS's): left = 1, right = 2,
// back = 3, accept = 4. Exceptions: on the who screen accept takes the first
// person and right opens everyone else; on the lock screen accept asks a grown-up;
// on pause accept and back resume; on the Sound sheet accept goes back, so a
// stray foot-pad press only closes it.

const blank = (position, label = '', hint = '') => ({ position, label, hint, icon: '—', disabled: true });
const key = (position, label, hint, icon, extra = {}) => ({ position, label, hint: hint || '', icon, ...extra });

/**
 * @param {object} view
 * @param {string} view.screen   who | roster | waves | locked | ready | paused | result | sound | loading | error
 * @returns {{ position: number, label: string, hint: string, icon: string, avatarSrc?: string, disabled?: boolean }[]}
 */
export function invadersControls(view) {
  const v = view || {};
  switch (v.screen) {
    case 'who': {
      const riders = v.riders || [];
      return [1, 2, 3, 4].map((position) => {
        const rider = riders[position - 1];
        return rider
          ? key(position, rider.name, 'Hold: someone else', '●', { avatarSrc: rider.avatarSrc })
          : key(position, 'Someone else', 'Hold', '●');
      });
    }
    case 'roster':
      return [key(1, 'Previous', 'Browse people', '←'), key(2, 'Next', 'Browse people', '→'), key(3, 'Back', 'In the workout', '×'), key(4, 'Choose', v.person?.name || '', '✓', { disabled: !v.person })];
    case 'waves': {
      const locked = v.wave?.status === 'locked';
      return [
        key(1, 'Previous', 'Pick a wave', '←', { disabled: (v.count || 0) < 2 }),
        key(2, 'Next', 'Pick a wave', '→', { disabled: (v.count || 0) < 2 }),
        key(3, 'Change shooter', v.shooterName || '', '●'),
        // The mat is the main action: Start says so.
        locked ? key(4, 'Locked', 'Admin unlock', '✓') : key(4, 'Start', v.mat ? 'Or stomp the mat' : v.wave?.name || '', '✓', { disabled: !v.wave }),
      ];
    }
    case 'locked':
      return [key(1, 'Admin unlock', 'Grown-up fingerprint', '✓'), blank(2, 'Locked'), key(3, 'Back', 'Choose shooter', '×'), key(4, 'Change shooter', 'Someone else', '●')];
    case 'ready':
      return [blank(1), blank(2), key(3, 'Back', 'Pick a wave', '×'), v.gamepad ? key(4, 'Skip', 'Gamepad aim', '✓') : blank(4, 'Reach', 'Arms out')];
    case 'paused':
      return [key(1, 'Resume', 'Clock starts', '✓'), key(2, 'Sound', 'Volume and mute', '♫'), key(3, 'End round', 'Save it as ended', '×'), blank(4, 'Paused')];
    case 'result': {
      if (v.saveStatus === 'error') return [key(1, 'Retry save', 'Keep this result', '↻'), blank(2, 'Saving required'), blank(3, 'Saving required'), blank(4, 'Saving required')];
      if (v.saveStatus !== 'saved') return [1, 2, 3, 4].map((position) => blank(position, 'Saving…'));
      return [
        key(1, 'Replay', v.mat && !v.next ? 'Or stomp the mat' : v.wave?.name || '', '↻'),
        v.next ? key(2, 'Next wave', v.mat ? 'Or stomp the mat' : v.next.name, '→') : blank(2, 'No next wave yet'),
        key(3, 'Waves', 'Pick another', '▦'),
        key(4, 'Change shooter', 'Someone else', '●'),
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
      return [key(1, 'Try again', 'Load the waves', '↻'), blank(2), blank(3), blank(4)];
    default:
      return [1, 2, 3, 4].map((position) => blank(position, 'Please wait'));
  }
}

/**
 * What a press means on a screen. `gesture` is single | long | double; only
 * the rider screen listens to a hold. `null` = nothing.
 * @returns {string|null}
 */
export function invadersAction(view, position, gesture = 'single') {
  const v = view || {};
  const control = invadersControls(v).find((item) => item.position === position);
  if (v.screen === 'who') {
    if (gesture !== 'single') return 'open-roster';
    return v.riders?.[position - 1] ? `pick:${v.riders[position - 1].id}` : null;
  }
  if (gesture !== 'single' || !control || control.disabled) return null;
  const table = {
    roster: { 1: 'roster-prev', 2: 'roster-next', 3: 'close-roster', 4: 'roster-choose' },
    waves: { 1: 'wave-prev', 2: 'wave-next', 3: 'change-shooter', 4: v.wave?.status === 'locked' ? 'unlock-wave' : 'start' },
    locked: { 1: 'admin-unlock', 3: 'change-shooter', 4: 'change-shooter' },
    ready: { 3: 'back-to-waves', 4: 'skip-calibration' },
    paused: { 1: 'resume', 2: 'open-sound', 3: 'end-round' },
    result: v.saveStatus === 'error' ? { 1: 'retry-save' } : { 1: 'replay', 2: 'next-wave', 3: 'waves', 4: 'change-shooter' },
    sound: { 1: 'quieter', 2: 'louder', 3: 'close-sound', 4: 'toggle-mute' },
    error: { 1: 'retry-load' },
  };
  return table[v.screen]?.[position] || null;
}

/** The menu keys (keyboard, foot pad, gamepad) as a press: `[position, gesture]`, or null. */
export function pressForMenuKey(screen, action) {
  const at = (position, gesture = 'single') => [position, gesture];
  // Who: accept takes the first rider; right opens everyone else.
  if (screen === 'who') return { accept: at(1), right: at(1, 'long') }[action] ?? null;
  if (screen === 'locked') return { accept: at(1), back: at(3) }[action] ?? null;
  if (screen === 'sound') return { left: at(1), right: at(2), back: at(3), accept: at(3) }[action] ?? null;
  if (screen === 'paused') return { accept: at(1), back: at(1), right: at(2) }[action] ?? null;
  if (screen === 'error') return { accept: at(1) }[action] ?? null;
  return { left: at(1), right: at(2), back: at(3), accept: at(4) }[action] ?? null;
}

/** A stomp on the mat: Start on the wave list; on a saved result, the next wave after a pass, else replay. */
export function stompAction(view) {
  const v = view || {};
  if (v.screen === 'waves') return invadersAction(v, 4);
  if (v.screen === 'result' && v.saveStatus === 'saved') return v.next ? 'next-wave' : 'replay';
  return null;
}
