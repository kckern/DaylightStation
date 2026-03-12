import { useState, useEffect, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useCeremony' });
  return _logger;
}

const API_BASE = '/api/v1/life/plan';

/**
 * Hook for managing a ceremony flow.
 * Fetches content, manages step state, submits responses.
 *
 * @param {string} type - ceremony type (unit_intention, cycle_retro, etc.)
 * @param {string} [username]
 */
export function useCeremony(type, username) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0);
  const [responses, setResponses] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  const qs = username ? `?username=${username}` : '';

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/ceremony/${type}${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setContent(data);
      logger().info('ceremony-loaded', { type, periodId: data.periodId });
    } catch (err) {
      setError(err.message);
      logger().error('ceremony-load-error', { type, error: err.message });
    } finally {
      setLoading(false);
    }
  }, [type, qs]);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  const setResponse = useCallback((key, value) => {
    setResponses(prev => ({ ...prev, [key]: value }));
  }, []);

  const nextStep = useCallback(() => setStep(s => s + 1), []);
  const prevStep = useCallback(() => setStep(s => Math.max(0, s - 1)), []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/ceremony/${type}/complete${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(responses),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCompleted(true);
      logger().info('ceremony-completed', { type });
    } catch (err) {
      setError(err.message);
      logger().error('ceremony-submit-error', { type, error: err.message });
    } finally {
      setSubmitting(false);
    }
  }, [type, qs, responses]);

  return {
    content, loading, error,
    step, nextStep, prevStep,
    responses, setResponse,
    submit, submitting, completed,
  };
}
