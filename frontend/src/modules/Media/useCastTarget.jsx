// frontend/src/modules/Media/useCastTarget.jsx
import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { wsService } from '../../services/WebSocketService';
import getLogger from '../../lib/logging/Logger.js';

const CastTargetContext = createContext(null);

const STEP_LABELS = {
  power: 'Powering on...',
  verify: 'Connecting...',
  volume: 'Setting volume...',
  prepare: 'Preparing...',
  prewarm: 'Warming up...',
  load: 'Loading...',
};

export function CastTargetProvider({ children }) {
  const logger = useMemo(() => getLogger().child({ component: 'CastTarget' }), []);

  // Target device + settings
  const [device, setDevice] = useState(null);
  const [settings, setSettings] = useState({ shader: null, volume: null });

  // Cast status
  const [status, setStatus] = useState('idle'); // idle | sending | success | error
  const [currentStep, setCurrentStep] = useState(null);
  const [error, setError] = useState(null);

  // Last cast for retry
  const lastCastRef = useRef(null);
  const revertTimerRef = useRef(null);

  // Subscribe to wake-progress events for the targeted device
  useEffect(() => {
    if (!device) return;
    const topic = `homeline:${device.id}`;

    const unsubscribe = wsService.subscribe(
      (msg) => msg.topic === topic && msg.type === 'wake-progress',
      (msg) => {
        logger.debug('cast-target.progress', { step: msg.step, status: msg.status });
        if (msg.status === 'running') {
          setCurrentStep(msg.step);
        }
        if (msg.status === 'failed') {
          setStatus('error');
          setError(msg.error || `Failed at ${msg.step}`);
          setCurrentStep(null);
        }
      }
    );

    return unsubscribe;
  }, [device?.id, logger]);

  // Clean up revert timer on unmount
  useEffect(() => {
    return () => clearTimeout(revertTimerRef.current);
  }, []);

  const selectDevice = useCallback((dev, initialSettings = {}) => {
    logger.info('cast-target.select', { id: dev.id, name: dev.name });
    setDevice(dev);
    setSettings(prev => ({
      shader: initialSettings.shader ?? prev.shader,
      volume: initialSettings.volume ?? prev.volume ?? dev.defaultVolume ?? 50,
    }));
    setStatus('idle');
    setCurrentStep(null);
    setError(null);
  }, [logger]);

  const updateSettings = useCallback((patch) => {
    setSettings(prev => ({ ...prev, ...patch }));
  }, []);

  const clearTarget = useCallback(() => {
    logger.info('cast-target.clear');
    setDevice(null);
    setSettings({ shader: null, volume: null });
    setStatus('idle');
    setCurrentStep(null);
    setError(null);
  }, [logger]);

  const castToTarget = useCallback(async (contentId, perCastOptions = {}) => {
    if (!device) return;
    const castParams = { contentId, perCastOptions };
    lastCastRef.current = castParams;

    logger.info('cast-target.cast', { deviceId: device.id, contentId, ...perCastOptions });
    setStatus('sending');
    setCurrentStep('power');
    setError(null);
    clearTimeout(revertTimerRef.current);

    try {
      const params = new URLSearchParams();
      params.set('queue', contentId);
      if (settings.shader) params.set('shader', settings.shader);
      if (settings.volume != null) params.set('volume', String(settings.volume));
      if (perCastOptions.shuffle) params.set('shuffle', '1');
      if (perCastOptions.repeat) params.set('repeat', '1');

      const res = await fetch(`/api/v1/device/${device.id}/load?${params}`);
      const result = await res.json();

      if (result.ok) {
        logger.info('cast-target.cast.success', { deviceId: device.id, totalElapsedMs: result.totalElapsedMs });
        setStatus('success');
        setCurrentStep(null);
        revertTimerRef.current = setTimeout(() => setStatus('idle'), 5000);
      } else {
        logger.warn('cast-target.cast.failed', { deviceId: device.id, error: result.error, failedStep: result.failedStep });
        setStatus('error');
        setError(result.error || 'Cast failed');
        setCurrentStep(null);
      }
      return result;
    } catch (err) {
      logger.error('cast-target.cast.error', { deviceId: device.id, error: err.message });
      setStatus('error');
      setError(err.message);
      setCurrentStep(null);
      return { ok: false, error: err.message };
    }
  }, [device, settings, logger]);

  const retry = useCallback(() => {
    if (!lastCastRef.current) return;
    const { contentId, perCastOptions } = lastCastRef.current;
    castToTarget(contentId, perCastOptions);
  }, [castToTarget]);

  const value = useMemo(() => ({
    device,
    settings,
    status,
    currentStep,
    stepLabel: currentStep ? STEP_LABELS[currentStep] || currentStep : null,
    error,
    selectDevice,
    updateSettings,
    clearTarget,
    castToTarget,
    retry,
  }), [device, settings, status, currentStep, error, selectDevice, updateSettings, clearTarget, castToTarget, retry]);

  return (
    <CastTargetContext.Provider value={value}>
      {children}
    </CastTargetContext.Provider>
  );
}

export function useCastTarget() {
  const ctx = useContext(CastTargetContext);
  if (!ctx) throw new Error('useCastTarget must be used within CastTargetProvider');
  return ctx;
}
