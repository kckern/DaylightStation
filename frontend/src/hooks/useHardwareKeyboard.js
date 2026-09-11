import { useEffect, useState } from 'react';
import { hasHardwareKeyboard, watchHardwareKeyboard } from '../lib/hardwareKeyboard.js';

/**
 * Whether this machine has a keyboard, re-rendering when that becomes known.
 *
 * Two of the three signals behind `lib/hardwareKeyboard.js` arrive AFTER first
 * paint — the fleet registry over the network, a keypress whenever the child
 * gets there — so a component that only asked once would keep showing the
 * answer it got before the evidence came in. That is the Portal's whole bug in
 * miniature: a panel that could type, drawn as one that could not.
 *
 * @returns {boolean}
 */
export function useHardwareKeyboard() {
  const [present, setPresent] = useState(hasHardwareKeyboard);
  useEffect(() => {
    // Re-read on mount as well as on notice: the registry may have answered
    // between this module loading and this component mounting.
    setPresent(hasHardwareKeyboard());
    return watchHardwareKeyboard(() => setPresent(hasHardwareKeyboard()));
  }, []);
  return present;
}

export default useHardwareKeyboard;
