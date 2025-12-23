import React, { useState, useEffect, useMemo } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { listApps, getAppManifest } from './index';
import useAppStorage from './useAppStorage';
import './FitnessAppMenu.scss';

const SettingsControls = ({ onClose }) => {
  const { clearAll } = useAppStorage('_menu');
  
  const handleResetAll = () => {
      if (window.confirm('Reset all app settings? This cannot be undone.')) {
        clearAll();
        onClose();
      }
    };

  return (
      <button onClick={handleResetAll} className="reset-btn">
          Reset All App Settings
      </button>
  );
};

const FitnessAppMenu = ({ activeAppMenuId, onAppSelect, onBack }) => {
  const [menuConfig, setMenuConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const loadMenu = async () => {
      try {
        const config = await DaylightAPI('/api/fitness');
        const fitnessConfig = config?.fitness || config;
        const menus = fitnessConfig?.plex?.app_menus || [];
        const menu = menus.find(m => String(m.id) === String(activeAppMenuId));
        setMenuConfig(menu);
      } catch (err) {
        console.error('Failed to load app menu:', err);
      } finally {
        setLoading(false);
      }
    };
    loadMenu();
  }, [activeAppMenuId]);

  const availableApps = useMemo(() => {
    if (!menuConfig?.items) return [];
    return menuConfig.items
      .map(item => ({ ...item, manifest: getAppManifest(item.id) }))
      .filter(item => item.manifest);
  }, [menuConfig]);

  if (loading) return <div className="fitness-app-menu loading">Loading apps...</div>;

  return (
    <div className="fitness-app-menu">
      <div className="app-menu-header">
        <h2>{menuConfig?.name || 'Fitness Apps'}</h2>
        <button onClick={() => setShowSettings(true)} className="settings-btn">⚙️</button>
      </div>
      
      {showSettings && (
        <div className="settings-panel-overlay">
            <div className="settings-panel">
            <h3>App Settings</h3>
            <SettingsControls onClose={() => setShowSettings(false)} />
            <button onClick={() => setShowSettings(false)} className="close-settings-btn">Close</button>
            </div>
        </div>
      )}

      <div className="app-grid">
        {availableApps.map(app => (
          <button
            key={app.id}
            className="app-card"
            onClick={() => onAppSelect(app.id, app.manifest)}
          >
            <div className="app-icon">{app.manifest.icon || '📱'}</div>
            <div className="app-name">{app.name}</div>
            <div className="app-description">{app.manifest.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default FitnessAppMenu;
