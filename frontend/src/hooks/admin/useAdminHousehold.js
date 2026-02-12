import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/admin/household';

/**
 * Hook for managing household data via the admin household API.
 *
 * Provides fetch, update, create-member, and remove-member operations,
 * with structured logging and error handling.
 *
 * @returns {object} Household state and actions
 */
export function useAdminHousehold() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminHousehold' }), []);

  const [household, setHousehold] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHousehold = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}`);
      setHousehold(result.household || null);
      setMembers(result.members || []);
      logger.info('admin.household.fetched', { memberCount: result.members?.length });
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.household.fetch.failed', { message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  const updateHousehold = useCallback(async (updates) => {
    try {
      const result = await DaylightAPI(`${API_BASE}`, updates, 'PUT');
      logger.info('admin.household.updated');
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const createMember = useCallback(async (memberData) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/members`, memberData, 'POST');
      logger.info('admin.household.member.created', { username: memberData.username });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const removeMember = useCallback(async (username) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/members/${username}`, {}, 'DELETE');
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
    household, members, loading, error,
    fetchHousehold, updateHousehold, createMember, removeMember, generateInvite, clearError
  };
}

export default useAdminHousehold;
