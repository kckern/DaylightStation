import { useCallback } from 'react';

export function useResilienceRecovery({
  recoveryConfig,
  hardRecoverAfterStalledForMs,
  meta,
  waitKey,
  resolveSeekIntentMs,
  epsilonSeconds,
  logResilienceEvent,
  logMetric,
  defaultReload,
  onReloadRef,
  persistSeekIntentMs,
  lastReloadAtRef,
  lastProgressSecondsRef,
  lastSecondsRef,
  clearTimer,
  reloadTimerRef,
  hardRecoveryTimerRef,
  progressTokenRef,
  resilienceActions,
  statusRef,
  pendingStatusValue,
  recoveringStatusValue,
  userIntentRef,
  pausedIntentValue,
  recoveryAttempts,
  onHardResetCycle,
  onRecoveryAttempt
}) {
  const notifyHardResetCycle = useCallback((payload = {}) => {
    if (typeof onHardResetCycle !== 'function') return;
    try {
      onHardResetCycle(payload);
    } catch (error) {
      logResilienceEvent('hard-reset-callback-error', {
        error: error?.message || String(error),
        payload
      }, { level: 'warn' });
    }
  }, [onHardResetCycle]);

  const triggerRecovery = useCallback((reason, {
    ignorePaused = false,
    seekToIntentMs: overrideIntentMs = null,
    force = false,
    skipRecoveryNotification = false
  } = {}) => {
    if (!force && !recoveryConfig.enabled) return;
    if (!force && !ignorePaused && userIntentRef.current === pausedIntentValue) return;
    if (!force && recoveryConfig.maxAttempts && recoveryAttempts >= recoveryConfig.maxAttempts) return;
    const now = Date.now();
    if (!force && recoveryConfig.cooldownMs && now - (lastReloadAtRef.current || 0) < recoveryConfig.cooldownMs) return;

    if (!force && statusRef.current === pendingStatusValue) {
      const progressedSeconds = Number.isFinite(lastProgressSecondsRef.current)
        ? lastProgressSecondsRef.current
        : (Number.isFinite(lastSecondsRef.current) ? lastSecondsRef.current : 0);
      if (!Number.isFinite(progressedSeconds) || progressedSeconds < epsilonSeconds) {
        logResilienceEvent('recovery-suppressed-no-progress', {
          reason,
          progressedSeconds,
          epsilonSeconds
        }, { level: 'info' });
        return;
      }
    }

    const resolvedIntentMs = resolveSeekIntentMs(overrideIntentMs);

    logResilienceEvent('recovery-armed', {
      reason,
      ignorePaused,
      force,
      attempts: recoveryAttempts,
      seekToIntentMs: resolvedIntentMs
    }, { level: 'info' });

    if (typeof onRecoveryAttempt === 'function') {
      onRecoveryAttempt({ reason, attempts: recoveryAttempts + 1 });
    } else if (typeof logMetric === 'function') {
      logMetric('recovery_attempt', {
        reason,
        attempts: recoveryAttempts + 1
      }, { level: 'info', tags: ['metric', 'recovery'] });
    }

    if (!skipRecoveryNotification) {
      notifyHardResetCycle({
        reason,
        seekToIntentMs: resolvedIntentMs,
        source: 'trigger-recovery'
      });
    }

    const performReload = () => {
      logResilienceEvent('recovery-triggered', {
        reason,
        force,
        seekToIntentMs: resolvedIntentMs
      }, { level: 'warn' });
      lastReloadAtRef.current = Date.now();
      resilienceActions.recoveryTriggered({ guardToken: progressTokenRef.current });
      lastProgressSecondsRef.current = null;

      if (Number.isFinite(resolvedIntentMs)) {
        persistSeekIntentMs(resolvedIntentMs);
      }

      onReloadRef.current?.({ reason, meta, waitKey, seekToIntentMs: resolvedIntentMs });
    };

    if (recoveryConfig.reloadDelayMs > 0) {
      clearTimer(reloadTimerRef);
      reloadTimerRef.current = setTimeout(performReload, recoveryConfig.reloadDelayMs);
    } else {
      performReload();
    }
  }, [
    recoveryConfig,
    userIntentRef,
    recoveryAttempts,
    lastReloadAtRef,
    lastProgressSecondsRef,
    lastSecondsRef,
    epsilonSeconds,
    resolveSeekIntentMs,
    logResilienceEvent,
    resilienceActions,
    progressTokenRef,
    persistSeekIntentMs,
    onReloadRef,
    meta,
    waitKey,
    clearTimer,
    reloadTimerRef,
    pendingStatusValue,
    statusRef,
    pausedIntentValue,
    notifyHardResetCycle
  ]);

  const scheduleHardRecovery = useCallback(() => {
    if (hardRecoverAfterStalledForMs <= 0) {
      triggerRecovery('stall-hard-recovery');
      return;
    }
    if (hardRecoveryTimerRef.current) return;
    hardRecoveryTimerRef.current = setTimeout(() => {
      hardRecoveryTimerRef.current = null;
      triggerRecovery('stall-hard-recovery');
    }, hardRecoverAfterStalledForMs);
  }, [hardRecoverAfterStalledForMs, triggerRecovery, hardRecoveryTimerRef]);

  const forcePlayerRemount = useCallback((reason = 'overlay-hard-reset', options = {}) => {
    const {
      seekToIntentMs: explicitSeekMs = null,
      forceDocumentReload = false
    } = options || {};
    const normalizedIntentMs = resolveSeekIntentMs(explicitSeekMs);
    const logPayload = {
      reason,
      seekToIntentMs: normalizedIntentMs,
      forceDocumentReload
    };
    if (forceDocumentReload || !onReloadRef.current) {
      logResilienceEvent('hard-reset-document-reload', logPayload, { level: 'warn' });
      defaultReload();
      return;
    }
    logResilienceEvent('hard-reset-force-remount', logPayload, { level: 'warn' });
    notifyHardResetCycle({
      reason,
      seekToIntentMs: normalizedIntentMs,
      source: 'force-player-remount'
    });
    lastReloadAtRef.current = Date.now();
    resilienceActions.setStatus(recoveringStatusValue, {
      carryRecovery: true,
      clearStallToken: true,
      clearRecoveryGuard: true
    });

    if (Number.isFinite(normalizedIntentMs)) {
      persistSeekIntentMs(normalizedIntentMs);
    }

    onReloadRef.current({
      reason,
      meta,
      waitKey,
      forceFullReload: true,
      ...options,
      seekToIntentMs: normalizedIntentMs
    });
  }, [
    resolveSeekIntentMs,
    onReloadRef,
    logResilienceEvent,
    defaultReload,
    lastReloadAtRef,
    resilienceActions,
    persistSeekIntentMs,
    meta,
    waitKey,
    recoveringStatusValue
  ]);

  const requestOverlayHardReset = useCallback((input, overrides = {}) => {
    const payload = typeof input === 'string'
      ? { reason: input }
      : (input && typeof input === 'object' ? input : {});
    const merged = { ...payload, ...overrides };
    const {
      reason = 'overlay-failsafe',
      ignorePaused = true,
      force = true,
      seekToIntentMs: overrideIntentMs = null,
      seekSeconds = null,
      forceDocumentReload = false
    } = merged;

    const normalizedSeekMs = (() => {
      if (Number.isFinite(overrideIntentMs)) return Math.max(0, overrideIntentMs);
      if (Number.isFinite(seekSeconds)) return Math.max(0, seekSeconds * 1000);
      return null;
    })();

    logResilienceEvent('overlay-hard-reset-request', {
      reason,
      forceDocumentReload,
      seekToIntentMs: normalizedSeekMs
    }, { level: 'warn' });

    forcePlayerRemount(reason, {
      ...merged,
      seekToIntentMs: normalizedSeekMs,
      forceDocumentReload
    });

    triggerRecovery(reason, {
      ignorePaused,
      force,
      seekToIntentMs: normalizedSeekMs,
      skipRecoveryNotification: true
    });
  }, [forcePlayerRemount, triggerRecovery, logResilienceEvent]);

  return {
    triggerRecovery,
    scheduleHardRecovery,
    forcePlayerRemount,
    requestOverlayHardReset
  };
}
