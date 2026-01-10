import { createContext, useContext, useMemo } from 'react';

export const DEFAULT_MEDIA_RESILIENCE_CONFIG = {
  overlay: {
    revealDelayMs: 300,
    pauseToggleKeys: ['ArrowUp', 'ArrowDown'],
    showPausedOverlay: true
  },
  monitor: {
    progressEpsilonSeconds: 0.25,
    stallDetectionThresholdMs: 5000,
    hardRecoverAfterStalledForMs: 2000,
    // Grace period for initial load
    hardRecoverLoadingGraceMs: 15000,
    recoveryCooldownMs: 4000
  },
  recovery: {
    enabled: true,
    maxAttempts: 3
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
        stallDetectionThresholdMs: coerceNumber(monitorConfig.stallDetectionThresholdMs, 5000),
        hardRecoverAfterStalledForMs: coerceNumber(monitorConfig.hardRecoverAfterStalledForMs, 2000),
        hardRecoverLoadingGraceMs: coerceNumber(monitorConfig.hardRecoverLoadingGraceMs, 15000),
        recoveryCooldownMs: coerceNumber(monitorConfig.recoveryCooldownMs, 4000)
      },
      recoveryConfig: {
        enabled: recoveryConfig.enabled ?? true,
        maxAttempts: coerceNumber(recoveryConfig.maxAttempts, 3)
      }
    };
  }, [contextConfig, configOverrides, runtimeOverrides]);
}
