import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { useLifeUsername } from "./useLifeUser.js";

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useCeremony' });
  return _logger;
}

const API_BASE = '/api/v1/life/plan';

function ceremonyError(error) {
  if (!error.status) return { message: error.message };
  return {
    status: error.status,
    code: error.body?.code,
    message: error.body?.error || `Request failed (HTTP ${error.status})`,
  };
}

/**
 * Hook for managing a ceremony flow.
 * Fetches content, manages step state, submits responses.
 *
 * @param {string} type - ceremony type (unit_intention, cycle_retro, etc.)
 * @param {string} [username]
 * @returns {object} state — `error` (fetch phase) and `submitError` (complete phase)
 *   are each null or { status?, code?, message } (never a raw string). They are kept
 *   separate so a failed submit doesn't unmount the form the user already filled in.
 */
export function useCeremony(type, username) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [step, setStep] = useState(0);
  const [responses, setResponses] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Follow the selected household user (explicit arg wins over context).
  const ctxUsername = useLifeUsername();
  const user = username || ctxUsername;
  const qs = user ? `?username=${encodeURIComponent(user)}` : '';

  const session = useRef(null);
  const path = `${API_BASE}/ceremony/${type}`;
  useEffect(() => {
    const controller = new AbortController();
    const current = { submitting: false };
    session.current = current;
    setContent(null);
    setResponses({});
    setStep(0);
    setCompleted(false);
    setSubmitting(false);
    setSubmitError(null);
    setLoading(true);
    setError(null);
    DaylightAPI(path + qs, {}, 'GET', { signal: controller.signal }).then(data => {
      if (session.current !== current) return;
      setContent(data);
      logger().info('ceremony-loaded', { type, periodId: data.periodId });
    }).catch(err => {
      if (session.current !== current) return;
      const info = ceremonyError(err);
      setError(info);
      logger().error('ceremony-load-error', { type, ...info });
    }).finally(() => { if (session.current === current) setLoading(false); });
    return () => {
      session.current = null;
      controller.abort();
    };
  }, [path, type, qs]);

  const setResponse = useCallback((key, value) => {
    setResponses(prev => ({ ...prev, [key]: value }));
  }, []);

  const nextStep = useCallback(() => setStep(s => s + 1), []);
  const prevStep = useCallback(() => setStep(s => Math.max(0, s - 1)), []);

  const submit = useCallback(async () => {
    const current = session.current;
    if (!current || current.submitting || current.completed) return;
    current.submitting = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await DaylightAPI(`${path}/complete${qs}`, responses, 'POST');
      if (session.current !== current) return;
      current.completed = true;
      setCompleted(true);
      logger().info('ceremony-completed', { type });
    } catch (err) {
      if (session.current !== current) return;
      const info = ceremonyError(err);
      setSubmitError(info);
      logger().error('ceremony-submit-error', { type, ...info });
    } finally {
      current.submitting = false;
      if (session.current === current) setSubmitting(false);
    }
  }, [path, type, qs, responses]);

  return {
    content, loading, error, submitError,
    step, nextStep, prevStep,
    responses, setResponse,
    submit, submitting, completed,
  };
}
