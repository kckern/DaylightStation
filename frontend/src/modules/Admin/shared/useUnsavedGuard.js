import { useEffect, useId } from 'react';
import { useUnsavedGuardRegistry } from './UnsavedGuardContext.jsx';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'unsaved-guard' });
  return _logger;
}

/**
 * useUnsavedGuard — register an editor's dirty state with the admin
 * unsaved-changes guard (audit C1).
 *
 * While `dirty` is true:
 *  - a `beforeunload` listener warns on tab close / hard reload
 *  - AdminNav intercepts in-app navigation via the shared registry
 *
 * The listener is attached ONLY while dirty and removed when dirty goes
 * false or the component unmounts.
 *
 * @param {boolean} dirty - current unsaved-changes state
 * @param {object} [options]
 * @param {string} [options.label] - identifying context for logs
 */
export function useUnsavedGuard(dirty, { label } = {}) {
  const id = useId();
  const registry = useUnsavedGuardRegistry();

  // Keep the registry in sync with this consumer's dirty flag.
  useEffect(() => {
    if (!registry) return;
    registry.register(id, dirty);
  }, [registry, id, dirty]);

  // Remove this consumer from the registry on unmount.
  useEffect(() => {
    if (!registry) return undefined;
    return () => registry.unregister(id);
  }, [registry, id]);

  // beforeunload guard — attached only while dirty.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      // Legacy spec requirement: setting returnValue triggers the prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    logger().debug('unsaved_guard.armed', { label });
    return () => {
      window.removeEventListener('beforeunload', handler);
      logger().debug('unsaved_guard.disarmed', { label });
    };
  }, [dirty, label]);
}

export default useUnsavedGuard;
