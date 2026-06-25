import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import { listModules, getModuleManifest } from '../index';
import useModuleStorage from '../player/useModuleStorage';
import { useFitness } from '@/context/FitnessContext.jsx';
import { useIdentity } from '../identity/IdentityProvider';
import UnlockPrompt from '../player/overlays/UnlockPrompt.jsx';
import LockIcon from '../player/overlays/LockIcon.jsx';
import { isKioskEnv } from '@/lib/kioskEnv.js';
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
  // Locks are kiosk-bound: off-kiosk (dev/test) nothing is gated, so a developer
  // can open any module (e.g. the Game Boy emulator) without a fingerprint. The
  // garage kiosk still enforces locks; pass ?kiosk=1 to test them in dev.
  const isLocked = useCallback(
    (moduleId) => isKioskEnv() && Array.isArray(locks?.[moduleId]) && locks[moduleId].length > 0,
    [locks]
  );

  // A single unlock instance owned by the menu. `pendingLaunch` holds the
  // launch we must perform once a fingerprint matches.
  const { registerUnlock, unlockState, unlockedUser, clearUnlock } = useIdentity();
  const [pendingLaunch, setPendingLaunch] = useState(null); // { id, manifest, label }

  const performLaunch = useCallback((id, manifest) => {
    onModuleSelect && onModuleSelect(id, manifest);
  }, [onModuleSelect]);

  const handleModuleTap = useCallback((mod) => {
    if (!isLocked(mod.id)) {
      performLaunch(mod.id, mod.manifest);
      return;
    }
    // Ignore taps (on this or any other locked card) while a prompt is already
    // open, so a second card can't repoint the prompt's label over an in-flight
    // or just-resolved scan. The open prompt must be dismissed first.
    if (pendingLaunch) return;
    const label = mod.name || mod.manifest?.name || mod.id;
    logger().info('module.locked_tap', { module: mod.id });
    setPendingLaunch({ id: mod.id, manifest: mod.manifest, label });
    registerUnlock(mod.id).then((result) => {
      if (result?.matched) {
        performLaunch(mod.id, mod.manifest);
      }
      // matched:false / denied — leave the prompt up showing the denied state;
      // the user dismisses via cancel/close which calls closeUnlock().
    });
  }, [isLocked, performLaunch, registerUnlock, pendingLaunch]);

  const closeUnlock = useCallback(() => {
    setPendingLaunch(null);
    clearUnlock();
  }, [clearUnlock]);

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
    // The menu is fully config-driven: items come from fitness.yml's
    // `plex.app_menus[].items` (SSoT). Each id is resolved to its registered
    // manifest; items without a manifest are dropped. Nothing is injected here.
    return (menuConfig?.items || [])
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
                <div className="module-lock-badge" aria-label="Locked" title="Locked"><LockIcon /></div>
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
        lockLabel={pendingLaunch?.label}
        unlockedUser={unlockedUser}
        onCancel={closeUnlock}
      />
    </div>
  );
};

export default FitnessModuleMenu;
