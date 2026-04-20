import { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../lib/logging/Logger.js';

const STATE_POLL_MS = 3_000;
const STATE_BACKOFF_MS = 10_000;
const HISTORY_REFRESH_MS = 5 * 60_000;

export default function useHomeDashboard() {
  const logger = useMemo(() => getLogger().child({ component: 'home-dashboard' }), []);
  const [config, setConfig] = useState(null);
  const [state, setState] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);

  const failureCount = useRef(0);

  // Config — once
  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/home-dashboard/config')
      .then((r) => r.json())
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        logger.info('home.dashboard.config.loaded');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e);
        logger.error('home.dashboard.config.error', { error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [logger]);

  // State — polling
  useEffect(() => {
    let cancelled = false;
    let timer;
    async function tick() {
      try {
        const res = await fetch('/api/v1/home-dashboard/state');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (cancelled) return;
        setState(body);
        setError(null);
        failureCount.current = 0;
      } catch (e) {
        failureCount.current += 1;
        logger.warn('home.dashboard.state.error', {
          error: e.message,
          failures: failureCount.current,
        });
        if (failureCount.current >= 2) setError(e);
      } finally {
        if (!cancelled) {
          const delay = failureCount.current >= 2 ? STATE_BACKOFF_MS : STATE_POLL_MS;
          timer = setTimeout(tick, delay);
        }
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [logger]);

  // History — every 5 min
  useEffect(() => {
    let cancelled = false;
    let timer;
    async function load() {
      try {
        const res = await fetch('/api/v1/home-dashboard/history');
        const body = await res.json();
        if (!cancelled) setHistory(body);
      } catch (e) {
        logger.warn('home.dashboard.history.error', { error: e.message });
      } finally {
        if (!cancelled) timer = setTimeout(load, HISTORY_REFRESH_MS);
      }
    }
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [logger]);

  // Actions
  const toggleLight = async (entityId, desiredState) => {
    try {
      const res = await fetch('/api/v1/home-dashboard/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId, desiredState }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      logger.info('home.dashboard.toggle.success', { entityId, desiredState });
      return true;
    } catch (e) {
      logger.error('home.dashboard.toggle.fail', { entityId, error: e.message });
      return false;
    }
  };

  const activateScene = async (sceneId) => {
    try {
      const res = await fetch(`/api/v1/home-dashboard/scene/${encodeURIComponent(sceneId)}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      logger.info('home.dashboard.scene.success', { sceneId });
      return true;
    } catch (e) {
      logger.error('home.dashboard.scene.fail', { sceneId, error: e.message });
      return false;
    }
  };

  return { config, state, history, error, toggleLight, activateScene };
}
