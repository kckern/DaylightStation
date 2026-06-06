import getLogger from '@/lib/logging/Logger.js';

// Module-level logger (lazy) for purely-local lobby UI events — modal opens,
// tab switches, ghost focus — that don't surface to the container's handlers.
let _uiLog;
export function uiLog() {
  if (!_uiLog) _uiLog = getLogger().child({ component: 'cycle-game-ui' });
  return _uiLog;
}
