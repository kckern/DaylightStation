import { useCallback } from 'react';

export function useResilienceRecovery({
  recoveryConfig,
  hardRecoverAfterStalledForMs,
  meta,
  waitKey,
  resolveSeekIntentMs,
  epsilonSeconds,
  logResilienceEvent,
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
  fatalStatusValue,
  userIntentRef,
  pausedIntentValue,
  recoveryAttempts,
  onHardResetCycle,
  shouldAttemptRecovery,
  computeRecoveryDelayMs
}) {
  const notifyHardResetCycle = useCallback((payload = {}) => {
    if (typeof onHardResetCycle !== 'function') return;
    try {
      onHardResetCycle(payload);
    } catch (error) {
      if (process.env?.NODE_ENV !== 'production') {
        console.warn('[useResilienceRecovery] hard reset callback failed', error);
      }
    }
  }, [onHardResetCycle]);

  const triggerRecovery = useCallback((reason, {
    ignorePaused = false,
    seekToIntentMs: overrideIntentMs = null,
    force = false,
    skipRecoveryNotification = false
  } = {}) => {
    if (!force && !recoveryConfig.enabled) return false;
    if (!force && !ignorePaused && userIntentRef.current === pausedIntentValue) return false;
    if (!force && recoveryConfig.maxAttempts && recoveryAttempts >= recoveryConfig.maxAttempts) return false;
    if (!force && fatalStatusValue && statusRef.current === fatalStatusValue) {
      logResilienceEvent('recovery-suppressed-fatal', {
        reason,
        attempts: recoveryAttempts
      }, { level: 'warn' });
      return false;
    }

    const now = Date.now();
    if (!force && recoveryConfig.cooldownMs && now - (lastReloadAtRef.current || 0) < recoveryConfig.cooldownMs) return false;

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
        return false;
      }
    }

    let gatingResult = { allowed: true, extraDelayMs: 0 };
    if (!force && typeof shouldAttemptRecovery === 'function') {
      try {
        const response = shouldAttemptRecovery({ reason, attempts: recoveryAttempts, force });
        if (response == null) {
          gatingResult = { allowed: true, extraDelayMs: 0 };
        } else if (typeof response === 'boolean') {
          gatingResult = { allowed: response, extraDelayMs: 0 };
        } else if (typeof response === 'object') {
          gatingResult = {
            allowed: response.allowed !== false,
            extraDelayMs: Number.isFinite(response.extraDelayMs) ? Math.max(0, response.extraDelayMs) : 0,
            blockReason: response.blockReason,
            blockDetails: response.blockDetails,
            onBlocked: typeof response.onBlocked === 'function' ? response.onBlocked : null
          };
        } else {
          gatingResult = { allowed: Boolean(response), extraDelayMs: 0 };
        }
      } catch (error) {
        if (process.env?.NODE_ENV !== 'production') {
          console.warn('[useResilienceRecovery] shouldAttemptRecovery failed', error);
        }
        gatingResult = { allowed: true, extraDelayMs: 0 };
      }

      if (!gatingResult.allowed) {
        logResilienceEvent('recovery-suppressed-policy', {
          reason,
          attempts: recoveryAttempts,
          policy: gatingResult.blockReason || 'custom',
          details: gatingResult.blockDetails || null
        }, { level: 'warn' });
        if (gatingResult.onBlocked) {
          try {
            gatingResult.onBlocked();
          } catch (error) {
            if (process.env?.NODE_ENV !== 'production') {
              console.warn('[useResilienceRecovery] onBlocked callback failed', error);
            }
          }
        }
        return false;
      }
    }

    const resolvedIntentMs = resolveSeekIntentMs(overrideIntentMs);

    logResilienceEvent('recovery-armed', {
      reason,
      ignorePaused,
      force,
      attempts: recoveryAttempts,
      seekToIntentMs: resolvedIntentMs,
      extraDelayMs: gatingResult.extraDelayMs || 0
    }, { level: 'info' });

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

    const computedDelayMs = (() => {
      if (typeof computeRecoveryDelayMs === 'function') {
        const candidate = computeRecoveryDelayMs({ reason, attempts: recoveryAttempts, force });
        if (Number.isFinite(candidate) && candidate > 0) {
          return candidate;
        }
        return 0;
      }
      return Math.max(0, Number.isFinite(recoveryConfig.reloadDelayMs) ? recoveryConfig.reloadDelayMs : 0);
    })();

    const totalDelayMs = Math.max(0, computedDelayMs + (gatingResult.extraDelayMs || 0));

    if (totalDelayMs > 0) {
      clearTimer(reloadTimerRef);
      reloadTimerRef.current = setTimeout(performReload, totalDelayMs);
    } else {
      performReload();
    }

    return true;
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
    fatalStatusValue,
    pausedIntentValue,
    notifyHardResetCycle,
    shouldAttemptRecovery,
    computeRecoveryDelayMs
  ]);

  const scheduleHardRecovery = useCallback(() => {
    if (hardRecoverAfterStalledForMs <= 0) {
      triggerRecovery('stall-hard-recovery');
      return;
    }
    if (hardRecoveryTimerRef.current) return;
    if (fatalStatusValue && statusRef.current === fatalStatusValue) {
      return;
    }
    hardRecoveryTimerRef.current = setTimeout(() => {
      hardRecoveryTimerRef.current = null;
      if (fatalStatusValue && statusRef.current === fatalStatusValue) {
        return;
      }
      triggerRecovery('stall-hard-recovery');
    }, hardRecoverAfterStalledForMs);
  }, [
    hardRecoverAfterStalledForMs,
    triggerRecovery,
    hardRecoveryTimerRef,
    fatalStatusValue,
    statusRef
  ]);

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
