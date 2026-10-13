import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function emptyResources(sessionId) {
  return {
    sessionId,
    config: null,
    configReady: false,
    ladder: null,
    ladderReady: false,
    rungId: 'learner',
  };
}

function mergeConfig(current, patch) {
  return {
    ...(current || {}),
    ...patch,
    feedback: { ...(current?.feedback || {}), ...(patch.feedback || {}) },
  };
}

/** Load and mutate only the config and ladder that belong to the active session. */
export function useChessSessionResources({
  sessionId,
  userId,
  historyLength,
  readConfig,
  readLadder,
  writeConfig,
  logger,
}) {
  const [stored, setStored] = useState(() => emptyResources(sessionId));
  const resources = stored.sessionId === sessionId ? stored : emptyResources(sessionId);
  const activeRef = useRef({ sessionId, userId });
  activeRef.current = { sessionId, userId };
  const introSavedRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setStored(emptyResources(sessionId));

    Promise.resolve(readConfig(userId)).then((loaded) => {
      if (cancelled) return;
      setStored((current) => {
        if (current.sessionId !== sessionId) return current;
        return {
          ...current,
          config: loaded || null,
          configReady: true,
          rungId: loaded?.default_rung || 'learner',
        };
      });
      logger.info('config-loaded', {
        sessionId,
        default_rung: loaded?.default_rung ?? null,
        rungs: loaded?.rungs?.length ?? 0,
      });
    }).catch((error) => {
      if (cancelled) return;
      setStored((current) => (current.sessionId === sessionId
        ? { ...current, configReady: true }
        : current));
      logger.warn?.('config-load-failed', { sessionId, error: error?.message });
    });

    Promise.resolve(readLadder(userId)).then((loaded) => {
      if (cancelled) return;
      setStored((current) => (current.sessionId === sessionId
        ? { ...current, ladder: loaded || null, ladderReady: true }
        : current));
      logger.info('ladder-loaded', {
        sessionId,
        level: loaded?.unlocked_through ?? null,
        opponent: loaded?.current?.name ?? null,
        persisted: loaded?.persisted ?? false,
      });
    }).catch((error) => {
      if (cancelled) return;
      setStored((current) => (current.sessionId === sessionId
        ? { ...current, ladderReady: true }
        : current));
      logger.warn?.('ladder-load-failed', { sessionId, error: error?.message });
    });

    return () => { cancelled = true; };
  }, [logger, readConfig, readLadder, sessionId, userId]);

  const updateSetting = useCallback((patch) => {
    const active = activeRef.current;
    setStored((current) => {
      if (current.sessionId !== active.sessionId) return current;
      return {
        ...current,
        config: mergeConfig(current.config, patch),
        rungId: patch.default_rung || current.rungId,
      };
    });
    if (active.userId) writeConfig(active.userId, patch);
    logger.info('setting-applied', { sessionId: active.sessionId, patch, persisted: !!active.userId });
  }, [logger, writeConfig]);

  useEffect(() => {
    if (!resources.configReady || !historyLength || !userId || resources.config?.seen_intro === true) return;
    const key = `${sessionId}:${userId}`;
    if (introSavedRef.current === key) return;
    introSavedRef.current = key;
    writeConfig(userId, { seen_intro: true });
    setStored((current) => (current.sessionId === sessionId
      ? { ...current, config: mergeConfig(current.config, { seen_intro: true }) }
      : current));
  }, [historyLength, resources.config, resources.configReady, sessionId, userId, writeConfig]);

  return useMemo(() => ({
    chessConfig: resources.config,
    configReady: resources.configReady,
    ladder: resources.ladder,
    ladderReady: resources.ladderReady,
    rungId: resources.rungId,
    opponent: resources.ladder?.current ?? null,
    ladderLevel: resources.ladder?.unlocked_through ?? null,
    updateSetting,
  }), [resources, updateSetting]);
}

export default useChessSessionResources;
