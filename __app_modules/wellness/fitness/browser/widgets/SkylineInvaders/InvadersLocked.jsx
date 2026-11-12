import React from 'react';
import SkylineControlPanel from '../SkylineGlider/SkylineControlPanel.jsx';
import useMenuInput from './useMenuInput.js';

// The school-day lock: one window and the four bike buttons, nothing behind it
// (the Skyline Glider `denied` screen). A grown-up can open the round with their
// fingerprint (1); Back (3) and Change shooter (4) both return to the shooter
// picker, as in Skyline Glider.
//
// The lock is the riders' (useSkylineGroupAccess over everyone in the session),
// so picking someone else as the shooter only helps when nobody riding is a
// learner who still has school to finish.

const REASONS = Object.freeze({
  incomplete: 'Finish today’s school work to unlock.',
  expired: 'Finish today’s school work to unlock.',
  indeterminate: 'Today’s school work can’t be checked right now. A grown-up can unlock.',
  unavailable: 'The school check is offline. A grown-up can unlock.',
});

/** The panel for the lock screen, in the shape SkylineControlPanel draws. */
export function lockedControls() {
  return [
    { position: 1, label: 'Admin unlock', hint: 'Grown-up fingerprint', icon: '✓' },
    { position: 2, label: 'Locked', hint: '', icon: '—', disabled: true },
    { position: 3, label: 'Back', hint: 'Choose shooter', icon: '×' },
    { position: 4, label: 'Change shooter', hint: 'Someone else', icon: '●' },
  ];
}

/**
 * @param {object} props
 * @param {string|null} props.state           the access verdict's state
 * @param {string[]} [props.blockedNames]      the learners the lock is waiting on
 * @param {(position: number) => void} props.onPress   1 admin, 3 back, 4 change shooter
 * @param {boolean} [props.active]             false while the fingerprint prompt is up
 */
export default function InvadersLocked({ state = null, blockedNames = [], onPress, active = true }) {
  // Gamepad A / Enter asks a grown-up; B / Escape goes back. The digits are the kiosk OS's.
  useMenuInput(active, (action) => {
    if (action === 'accept') onPress?.(1);
    else if (action === 'back') onPress?.(3);
  });
  return (
    <section className="skyline-menu-screen skyline-invaders__locked" data-testid="skyline-invaders-locked" aria-label="Round locked">
      <div className="skyline-menus" data-phase="denied">
        {blockedNames.length > 0 && <p className="skyline-menus__kicker" data-testid="invaders-locked-for">{`School first: ${blockedNames.join(', ')}`}</p>}
        <h1>Round locked</h1>
        <p>{REASONS[state] || REASONS.incomplete}</p>
      </div>
      <SkylineControlPanel controls={lockedControls()} onPress={(position) => onPress?.(position)} />
    </section>
  );
}
