import React from 'react';
import '../FitnessUsers.scss';

const FitnessSidebarMenu = ({ onClose, visibility, onToggleVisibility }) => {
  const handleToggle = (component) => {
    onToggleVisibility(component);
  };

  return (
    <div className="fitness-sidebar-menu">
      <div className="sidebar-menu-header">
        <h3>Sidebar Menu</h3>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="sidebar-menu-content">
        <div className="menu-section">
          <h4>Sidebar Components</h4>
          
          <div className="menu-item toggle-item">
            <span>💰 Treasure Box</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={visibility.treasureBox}
                onChange={() => handleToggle('treasureBox')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="menu-item toggle-item">
            <span>👥 User Devices</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={visibility.users}
                onChange={() => handleToggle('users')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="menu-item toggle-item">
            <span>📹 Share Video</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={visibility.video}
                onChange={() => handleToggle('video')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="menu-item toggle-item">
            <span>🎤 Voice Memo</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={visibility.voiceMemo}
                onChange={() => handleToggle('voiceMemo')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div className="menu-section">
          <h4>Settings</h4>
          <button className="menu-item">⚙️ Preferences</button>
          <button className="menu-item">🔔 Notifications</button>
        </div>
      </div>
    </div>
  );
};

export default FitnessSidebarMenu;
