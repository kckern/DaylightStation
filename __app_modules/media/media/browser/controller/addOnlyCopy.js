// Add only (RQ-PLAY-10) in a person's words — the ONE source for every place
// the setting shows: Now Playing's More ⋯, the Devices row, its toasts, and the
// reasons a session cannot offer it. The internal name "Add only" never
// reaches the screen (Now Playing ruling 2026-11-27: "Queue what others send").

export const ADD_ONLY_COPY = Object.freeze({
  label: 'Queue what others send',
  explain: 'Plays sent from other devices join the queue instead of replacing what is on.',
  unavailable: 'This device only plays what you start on it.',
  /** The Devices row notice while it is on. */
  onNotice: 'Queue what others send is on: plays from other devices join the queue.',
  turnedOff: (name) => `Stopped queueing what others send on ${name}`,
  turnedOffDetail: 'Plays from any device replace what is on there again',
  turnOffFailed: (name) => `Couldn't stop queueing what others send on ${name}`,
});
