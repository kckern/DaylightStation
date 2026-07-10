import { createContext, useContext, useMemo } from 'react';

export const DEFAULT_MEDIA_RESILIENCE_CONFIG = {
  overlay: {
    revealDelayMs: 300,
    pauseToggleKeys: ['ArrowUp', 'ArrowDown'],
    showPausedOverlay: true
  },
  monitor: {
    progressEpsilonSeconds: 0.25,
    // Grace period for initial load
    hardRecoverLoadingGraceMs: 15000,
    // Poisoned-segment escape: nudge the recovery seek forward after this many
    // consecutive same-position startup failures.
    maxSamePositionRetries: 2,
    recoverySeekNudgeSeconds: 6
  },
  // Attempt cap + cooldown/backoff are NOT configurable here — they are owned
  // by lib/recoveryLedger.js (RECOVERY_MAX_ATTEMPTS et al.), the single
  // accounting authority shared by every recovery actor.
  recovery: {
    enabled: true
  },
  debug: {
    revealDelayMs: 5000
  }
};

export const MediaResilienceConfigContext = createContext(DEFAULT_MEDIA_RESILIENCE_CONFIG);

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function mergeDeep(target, source) {
  if (!isObject(target)) return source;
  if (!isObject(source)) return target;
  const output = { ...target };
  Object.keys(source).forEach((key) => {
    const targetValue = output[key];
    const sourceValue = source[key];
    if (Array.isArray(sourceValue)) {
      output[key] = sourceValue.slice();
    } else if (isObject(sourceValue) && isObject(targetValue)) {
      output[key] = mergeDeep(targetValue, sourceValue);
    } else {
      output[key] = sourceValue;
    }
  });
  return output;
}

const mergeConfigs = (...configs) => configs.filter(Boolean).reduce((acc, cfg) => mergeDeep(acc, cfg), {});

export const mergeMediaResilienceConfig = (...configs) => mergeConfigs(...configs);

const coerceNumber = (value, fallback) => (Number.isFinite(value) ? value : fallback);

export function useResilienceConfig({ configOverrides, runtimeOverrides } = {}) {
  const contextConfig = useContext(MediaResilienceConfigContext);

  return useMemo(() => {
    const mergedConfig = mergeConfigs(
      DEFAULT_MEDIA_RESILIENCE_CONFIG,
      contextConfig,
      configOverrides,
      runtimeOverrides
    );

    const overlayConfig = mergedConfig.overlay || {};
    const debugConfig = mergedConfig.debug || {};
    const monitorConfig = mergedConfig.monitor || {};
    const recoveryConfig = mergedConfig.recovery || {};

    return {
      overlayConfig,
      debugConfig,
      monitorSettings: {
        epsilonSeconds: coerceNumber(monitorConfig.progressEpsilonSeconds, 0.25),
        hardRecoverLoadingGraceMs: coerceNumber(monitorConfig.hardRecoverLoadingGraceMs, 15000),
        maxSamePositionRetries: coerceNumber(monitorConfig.maxSamePositionRetries, 2),
        recoverySeekNudgeSeconds: coerceNumber(monitorConfig.recoverySeekNudgeSeconds, 6)
      },
      recoveryConfig: {
        enabled: recoveryConfig.enabled ?? true
      }
    };
  }, [contextConfig, configOverrides, runtimeOverrides]);
}
