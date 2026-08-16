/**
 * The game chrome kit — the furniture every piano game shares.
 *
 * Import from here, not from the individual files: what a game needs from the
 * platform's visual layer should read as one list at the top of the file.
 */
export { default as GameRail } from './GameRail.jsx';
export { default as GameSlot } from './GameSlot.jsx';
export { default as GameButton } from './GameButton.jsx';
export { default as GameStatusBar } from './GameStatusBar.jsx';
export { default as GameSheet, GameField } from './GameSheet.jsx';
export { GameToggle, GameChoice } from './GameToggle.jsx';
export { default as GameStepper } from './GameStepper.jsx';
export { default as DealNotice } from './DealNotice.jsx';
export { default as LadderBadge } from './LadderBadge.jsx';
export { default as WinTally } from './WinTally.jsx';
export { CountdownOverlay, LifeMeter, ProgressMeter } from './GameChrome.jsx';
