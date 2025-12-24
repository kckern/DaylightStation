import React, { useState, useEffect, useMemo } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { listPlugins, getPluginManifest } from './index';
import usePluginStorage from './usePluginStorage';
import './FitnessPluginMenu.scss';

const SettingsControls = ({ onClose }) => {
  const { clearAll } = usePluginStorage('_menu');
  
  const handleResetAll = () => {
      if (window.confirm('Reset all plugin settings? This cannot be undone.')) {
        clearAll();
        onClose();
      }
    };

  return (
      <button onClick={handleResetAll} className="reset-btn">
          Reset All Plugin Settings
      </button>
  );
};

const FitnessPluginMenu = ({ activePluginMenuId, onPluginSelect, onBack }) => {
  const [menuConfig, setMenuConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const loadMenu = async () => {
      try {
        const config = await DaylightAPI('/api/fitness');
        const fitnessConfig = config?.fitness || config;
        const menus = fitnessConfig?.plex?.app_menus || [];
        const menu = menus.find(m => String(m.id) === String(activePluginMenuId));
        setMenuConfig(menu);
      } catch (err) {
        console.error('Failed to load plugin menu:', err);
      } finally {
        setLoading(false);
      }
    };
    loadMenu();
  }, [activePluginMenuId]);

  const availablePlugins = useMemo(() => {
    const items = [...(menuConfig?.items || [])];

    // Ensure Component Showcase appears even if not yet in config
    const showcaseManifest = getPluginManifest('component_showcase');
    const hasShowcase = items.some((item) => String(item.id) === 'component_showcase');
    if (showcaseManifest && !hasShowcase) {
      items.push({ id: 'component_showcase', name: showcaseManifest.name || 'UX Showcase' });
    }

    return items
      .map(item => ({ ...item, manifest: getPluginManifest(item.id) }))
      .filter(item => item.manifest);
  }, [menuConfig]);

  if (loading) return <div className="fitness-plugin-menu loading">Loading plugins...</div>;

  return (
    <div className="fitness-plugin-menu">
      <div className="plugin-menu-header">
        <h2>{menuConfig?.name || 'Fitness Plugins'}</h2>
        <button onClick={() => setShowSettings(true)} className="settings-btn">⚙️</button>
      </div>
      
      {showSettings && (
        <div className="settings-panel-overlay">
            <div className="settings-panel">
            <h3>Plugin Settings</h3>
            <SettingsControls onClose={() => setShowSettings(false)} />
            <button onClick={() => setShowSettings(false)} className="close-settings-btn">Close</button>
            </div>
        </div>
      )}

      <div className="plugin-grid">
        {availablePlugins.map(plugin => (
          <button
            key={plugin.id}
            className="plugin-card"
            onClick={() => onPluginSelect(plugin.id, plugin.manifest)}
          >
            <div className="plugin-icon">{plugin.manifest.icon || '📱'}</div>
            <div className="plugin-name">{plugin.name}</div>
            <div className="plugin-description">{plugin.manifest.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default FitnessPluginMenu;
