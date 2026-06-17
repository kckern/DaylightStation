import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import { listModules, getModuleManifest } from '../index';
import useModuleStorage from '../player/useModuleStorage';
import { useFitness } from '@/context/FitnessContext.jsx';
import { useUnlock } from '../hooks/useUnlock.js';
import UnlockPrompt from '../player/overlays/UnlockPrompt.jsx';
import './FitnessModuleMenu.scss';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'FitnessModuleMenu' });
  return _logger;
}

const SettingsControls = ({ onClose }) => {
  const { clearAll } = useModuleStorage('_menu');

  const handleResetAll = () => {
      if (window.confirm('Reset all module settings? This cannot be undone.')) {
        clearAll();
        onClose();
      }
    };

  return (
      <button onClick={handleResetAll} className="reset-btn">
          Reset All Module Settings
      </button>
  );
};

const FitnessModuleMenu = ({ activeModuleMenuId, onModuleSelect, onBack }) => {
  const [menuConfig, setMenuConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // Config-driven locks map (e.g. { dance_party: ['kckern','elizabeth'] }). A
  // module is gated iff locks[id] is a non-empty array. Surfaced via the unified
  // fitness config (root + nested fitness block).
  const { fitnessConfiguration } = useFitness();
  const locks = useMemo(() => {
    const cfg = fitnessConfiguration || {};
    return cfg.locks || cfg.fitness?.locks || {};
  }, [fitnessConfiguration]);
  const isLocked = useCallback(
    (moduleId) => Array.isArray(locks?.[moduleId]) && locks[moduleId].length > 0,
    [locks]
  );

  // A single unlock instance owned by the menu. `pendingLaunchRef` holds the
  // launch we must perform once a fingerprint matches.
  const { requestUnlock, state: unlockState, activeLock, reset } = useUnlock();
  const [pendingLaunch, setPendingLaunch] = useState(null); // { id, manifest, label }

  const performLaunch = useCallback((id, manifest) => {
    onModuleSelect && onModuleSelect(id, manifest);
  }, [onModuleSelect]);

  const handleModuleTap = useCallback((mod) => {
    if (!isLocked(mod.id)) {
      performLaunch(mod.id, mod.manifest);
      return;
    }
    const label = mod.name || mod.manifest?.name || mod.id;
    logger().info('module.locked_tap', { module: mod.id });
    setPendingLaunch({ id: mod.id, manifest: mod.manifest, label });
    requestUnlock(mod.id).then((result) => {
      if (result?.matched) {
        performLaunch(mod.id, mod.manifest);
      }
      // matched:false / denied — leave the prompt up showing the denied state;
      // the user dismisses via cancel/close which calls closeUnlock().
    });
  }, [isLocked, performLaunch, requestUnlock]);

  const closeUnlock = useCallback(() => {
    setPendingLaunch(null);
    reset();
  }, [reset]);

  useEffect(() => {
    const loadMenu = async () => {
      try {
        const config = await DaylightAPI('/api/v1/fitness');
        const fitnessConfig = config?.fitness || config;
        const menus = fitnessConfig?.plex?.app_menus || [];
        const menu = menus.find(m => String(m.id) === String(activeModuleMenuId));
        setMenuConfig(menu);
      } catch (err) {
        logger().error('module-menu-load-failed', { error: err.message });
      } finally {
        setLoading(false);
      }
    };
    loadMenu();
  }, [activeModuleMenuId]);

  const availableModules = useMemo(() => {
    const items = [...(menuConfig?.items || [])];

    // Ensure Pose Demo appears even if not yet in config
    const poseDemoManifest = getModuleManifest('pose_demo');
    const hasPoseDemo = items.some((item) => String(item.id) === 'pose_demo');
    if (poseDemoManifest && !hasPoseDemo) {
      items.push({ id: 'pose_demo', name: poseDemoManifest.name || 'Pose Demo' });
    }

    // Ensure Vibration Monitor appears even if not yet in config
    const vibrationManifest = getModuleManifest('vibration_monitor');
    const hasVibration = items.some((item) => String(item.id) === 'vibration_monitor');
    if (vibrationManifest && !hasVibration) {
      items.push({ id: 'vibration_monitor', name: vibrationManifest.name || 'Vibration Monitor' });
    }

    return items
      .map(item => ({ ...item, manifest: getModuleManifest(item.id) }))
      .filter(item => item.manifest);
  }, [menuConfig]);

  if (loading) return <div className="fitness-module-menu loading">Loading modules...</div>;

  return (
    <div className="fitness-module-menu">
      <div className="module-menu-header">
        <h2>{menuConfig?.name || 'Fitness Modules'}</h2>
        <button onClick={() => setShowSettings(true)} className="settings-btn">⚙️</button>
      </div>

      {showSettings && (
        <div className="settings-panel-overlay">
            <div className="settings-panel">
            <h3>Module Settings</h3>
            <SettingsControls onClose={() => setShowSettings(false)} />
            <button onClick={() => setShowSettings(false)} className="close-settings-btn">Close</button>
            </div>
        </div>
      )}

      <div className="module-grid">
        {availableModules.map(mod => {
          const locked = isLocked(mod.id);
          return (
            <button
              key={mod.id}
              className={`module-card${locked ? ' module-card--locked' : ''}`}
              data-locked={locked || undefined}
              // This app prefers onPointerDown for low-latency taps on the garage
              // touchscreen; onKeyDown preserves keyboard activation for the button.
              onPointerDown={() => handleModuleTap(mod)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleModuleTap(mod);
                }
              }}
            >
              {locked && (
                <div className="module-lock-badge" aria-label="Locked" title="Locked">🔒</div>
              )}
              <div className="module-icon">{mod.manifest.icon || '📱'}</div>
              <div className="module-name">{mod.name}</div>
              <div className="module-description">{mod.manifest.description}</div>
            </button>
          );
        })}
      </div>

      <UnlockPrompt
        open={!!pendingLaunch}
        state={unlockState}
        lockLabel={pendingLaunch?.label || (activeLock ? activeLock : undefined)}
        onCancel={closeUnlock}
      />
    </div>
  );
};

export default FitnessModuleMenu;
