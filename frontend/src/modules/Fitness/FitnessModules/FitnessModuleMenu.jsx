import React, { useState, useEffect, useMemo } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { listModules, getModuleManifest } from './index';
import useModuleStorage from './useModuleStorage';
import './FitnessModuleMenu.scss';
import getLogger from '../../../lib/logging/Logger.js';

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

    // Ensure Component Showcase appears even if not yet in config
    const showcaseManifest = getModuleManifest('component_showcase');
    const hasShowcase = items.some((item) => String(item.id) === 'component_showcase');
    if (showcaseManifest && !hasShowcase) {
      items.push({ id: 'component_showcase', name: showcaseManifest.name || 'UX Showcase' });
    }

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

    // Ensure Session Browser appears even if not yet in config
    const sessionBrowserManifest = getModuleManifest('session-browser');
    const hasSessionBrowser = items.some((item) => String(item.id) === 'session-browser');
    if (sessionBrowserManifest && !hasSessionBrowser) {
      items.push({ id: 'session-browser', name: sessionBrowserManifest.name || 'History' });
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
        {availableModules.map(mod => (
          <button
            key={mod.id}
            className="module-card"
            onClick={() => onModuleSelect(mod.id, mod.manifest)}
          >
            <div className="module-icon">{mod.manifest.icon || '📱'}</div>
            <div className="module-name">{mod.name}</div>
            <div className="module-description">{mod.manifest.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default FitnessModuleMenu;
