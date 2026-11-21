import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/admin/integrations';

/**
 * Hook for integration test commands via the admin integrations API.
 *
 * Read-only screens use useApiResource; this hook owns command feedback only.
 *
 * @returns {object} Integration command state and actions
 */
export function useAdminIntegrations() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminIntegrations' }), []);
  const [error, setError] = useState(null);

  const testConnection = useCallback(async (provider) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/${provider}/test`, {}, 'POST');
      logger.info('admin.integrations.tested', { provider });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const clearError = useCallback(() => setError(null), []);

  return { error, testConnection, clearError };
}

export default useAdminIntegrations;
