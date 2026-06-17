// frontend/src/modules/Fitness/widgets/FingerprintManager/useFingerprintManager.js
import { useCallback, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'fingerprint-manager' }));

const LIST_PATH = 'api/v1/fitness/fingerprints';
const ENROLL_PATH = 'api/v1/fitness/fingerprints/enroll';

/**
 * Data hook for the fingerprint manager: load the user list, enroll a finger,
 * and remove one. All errors resolve (never throw) so callers branch on the
 * returned shape, matching useUnlock's contract.
 */
export function useFingerprintManager() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await DaylightAPI(LIST_PATH);
      setUsers(Array.isArray(list) ? list : []);
      logger().debug('manager.listed', { count: Array.isArray(list) ? list.length : 0 });
    } catch (err) {
      logger().warn('manager.list.error', { error: err?.message });
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const enroll = useCallback(async ({ username, finger, clientToken }) => {
    logger().info('manager.enroll.start', { username, finger });
    try {
      const res = await DaylightAPI(ENROLL_PATH, { username, finger, clientToken }, 'POST');
      logger().info('manager.enroll.done', { username, success: !!res?.success });
      return res || { success: false };
    } catch (err) {
      logger().warn('manager.enroll.error', { username, error: err?.message });
      return { success: false, error: err?.message };
    }
  }, []);

  const remove = useCallback(async ({ username, finger }) => {
    logger().info('manager.delete.start', { username, finger });
    try {
      const res = await DaylightAPI(LIST_PATH, { username, finger }, 'DELETE');
      logger().info('manager.delete.done', { username, success: !!res?.success });
      return res || { success: false };
    } catch (err) {
      logger().warn('manager.delete.error', { username, error: err?.message });
      return { success: false, error: err?.message };
    }
  }, []);

  return { users, loading, refresh, enroll, remove };
}

export default useFingerprintManager;
