import { createContext, useContext, useMemo } from 'react';

export const DEFAULT_MEDIA_RESILIENCE_CONFIG = {
  overlay: {
    revealDelayMs: 300,
    pauseToggleKeys: ['ArrowUp', 'ArrowDown'],
    showPausedOverlay: true
  },
  monitor: {
    progressEpsilonSeconds: 0.25,
    stallDetectionThresholdMs: 500,
    hardRecoverAfterStalledForMs: 8000,
    mountTimeoutMs: 6000,
    mountPollIntervalMs: 750,
    mountMaxAttempts: 3
  },
  recovery: {
    enabled: true,
    reloadDelayMs: 0,
    cooldownMs: 4000,
    maxAttempts: 8
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
    const legacyReload = mergedConfig.reload || {};
    const recoveryConfig = mergedConfig.recovery || {};

    return {
      overlayConfig,
      debugConfig,
      monitorSettings: {
        epsilonSeconds: coerceNumber(monitorConfig.progressEpsilonSeconds, 0.25),
        stallDetectionThresholdMs: coerceNumber(monitorConfig.stallDetectionThresholdMs, 500),
        hardRecoverAfterStalledForMs: coerceNumber(monitorConfig.hardRecoverAfterStalledForMs, 6000),
        mountTimeoutMs: coerceNumber(monitorConfig.mountTimeoutMs, 6000),
        mountPollIntervalMs: coerceNumber(monitorConfig.mountPollIntervalMs, 750),
        mountMaxAttempts: coerceNumber(monitorConfig.mountMaxAttempts, 3)
      },
      recoveryConfig: {
        enabled: recoveryConfig.enabled ?? legacyReload.enabled ?? true,
        reloadDelayMs: coerceNumber(recoveryConfig.reloadDelayMs ?? legacyReload.stallMs, 0),
        cooldownMs: coerceNumber(recoveryConfig.cooldownMs ?? legacyReload.cooldownMs, 4000),
        maxAttempts: coerceNumber(recoveryConfig.maxAttempts ?? legacyReload.maxAttempts, 2)
      }
    };
  }, [contextConfig, configOverrides, runtimeOverrides]);
}
