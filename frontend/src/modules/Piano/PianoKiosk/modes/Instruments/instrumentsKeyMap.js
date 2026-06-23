// instrumentsKeyMap.js — pure helper for the Instruments voice rack.

/** Always prepend the Onboard (passthrough) entry to the configured instruments. */
export function entriesFor(instruments) {
  return [{ id: '__onboard__', name: 'Onboard', engine: null }, ...(instruments || [])];
}
