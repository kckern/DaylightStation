import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

export const ADMIN_HOUSEHOLD_PATH = '/api/v1/admin/household';

/**
 * Hook for managing household data via the admin household API.
 *
 * Provides update, create-member, remove-member, and invite operations,
 * with structured logging and error handling.
 *
 * @returns {object} Household commands and command error state
 */
export function useAdminHousehold() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminHousehold' }), []);

  const [error, setError] = useState(null);

  const updateHousehold = useCallback(async (updates) => {
    try {
      const result = await DaylightAPI(ADMIN_HOUSEHOLD_PATH, updates, 'PUT');
      logger.info('admin.household.updated');
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const createMember = useCallback(async (memberData) => {
    try {
      const result = await DaylightAPI(`${ADMIN_HOUSEHOLD_PATH}/members`, memberData, 'POST');
      logger.info('admin.household.member.created', { username: memberData.username });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const removeMember = useCallback(async (username) => {
    try {
      const result = await DaylightAPI(`${ADMIN_HOUSEHOLD_PATH}/members/${username}`, {}, 'DELETE');
      logger.info('admin.household.member.removed', { username });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const generateInvite = useCallback(async (username) => {
    try {
      const result = await DaylightAPI('/api/v1/auth/invite', { username }, 'POST');
      logger.info('admin.household.invite.generated', { username });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const clearError = useCallback(() => setError(null), []);

  return {
    error, updateHousehold, createMember, removeMember, generateInvite, clearError
  };
}

export default useAdminHousehold;
