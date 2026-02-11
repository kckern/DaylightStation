import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/admin/integrations';

/**
 * Hook for managing integrations via the admin integrations API.
 *
 * Provides list, detail, and test operations for third-party service integrations,
 * with structured logging and error handling.
 *
 * @returns {object} Integrations state and actions
 */
export function useAdminIntegrations() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminIntegrations' }), []);

  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}`);
      setIntegrations(result.integrations || []);
      logger.info('admin.integrations.fetched', { count: result.integrations?.length });
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.integrations.fetch.failed', { message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  const fetchDetail = useCallback(async (provider) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/${provider}`);
      return result.integration;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, []);

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

  return {
    integrations, loading, error,
    fetchIntegrations, fetchDetail, testConnection, clearError
  };
}

export default useAdminIntegrations;
