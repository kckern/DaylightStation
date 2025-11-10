import React from 'react';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import '../FitnessUsers.scss';

const FitnessSidebarMenu = ({ onClose, visibility, onToggleVisibility, selectedPlaylistId, onPlaylistChange }) => {
  const fitnessContext = useFitnessContext();
  
  // Extract playlists from config
  const playlists = fitnessContext?.plexConfig?.music_playlists || [];

  const handleToggle = (component) => {
    onToggleVisibility(component);
  };

  const handlePlaylistChange = (e) => {
    const playlistId = e.target.value;
    if (onPlaylistChange) {
      onPlaylistChange(playlistId || null);
    }
  };

  return (
    <div className="fitness-sidebar-menu">
      <div className="sidebar-menu-header">
        <h3>Settings</h3>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="sidebar-menu-content">
        <div className="menu-section">
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
            <span>� Race Chart</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={visibility.raceChart}
                onChange={() => handleToggle('raceChart')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="menu-item toggle-item">
            <span>🎵 Playlist</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={visibility.playlist}
                onChange={() => handleToggle('playlist')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          {visibility.playlist && playlists.length > 0 && (
            <div className="menu-item playlist-dropdown">
              <select 
                value={selectedPlaylistId || ''} 
                onChange={handlePlaylistChange}
                className="playlist-select"
              >
                <option value="">Select a playlist...</option>
                {playlists.map((playlist) => (
                  <option key={playlist.id} value={playlist.id}>
                    {playlist.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FitnessSidebarMenu;
