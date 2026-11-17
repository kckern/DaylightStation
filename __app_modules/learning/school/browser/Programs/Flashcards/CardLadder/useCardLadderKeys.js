import { useSchoolCommands } from '../../../portal/useSchoolCommands.js';
import { noteKeyEvent } from './inputVia.js';

/** Card Ladder retains Tab-to-hear while sharing surface, IME and modal guards. */
export function useCardLadderKeys(map, options = {}) {
  useSchoolCommands(Object.fromEntries(Object.entries(map).filter(([, action]) => typeof action === 'function').map(([key, action]) => [key, event => { noteKeyEvent(event); action(); }])), { ...options, allowInInput: key => key === 'tab' });
}
export default useCardLadderKeys;
