import React from 'react';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import '../FitnessSidebar.scss';

const FitnessPlaylistSelector = ({ playlists, selectedPlaylistId, onSelect, onClose }) => {
  const handleSelect = (playlistId) => {
    onSelect(playlistId);
    if (onClose) onClose();
  };

  return (
    <div className="fitness-playlist-selector">
      <div 
        className={`playlist-item ${!selectedPlaylistId ? 'selected' : ''}`}
        onClick={() => handleSelect(null)}
      >
        <div className="playlist-thumb placeholder">
          <span>🔇</span>
        </div>
        <div className="playlist-info">
          <div className="playlist-name">No Music</div>
        </div>
      </div>

      {playlists.map((playlist) => {
        const thumbPath = playlist.thumb || playlist.composite || playlist.art;
        return (
          <div 
            key={playlist.id}
            className={`playlist-item ${selectedPlaylistId === playlist.id ? 'selected' : ''}`}
            onClick={() => handleSelect(playlist.id)}
          >
            <div className="playlist-thumb">
              {thumbPath ? (
                <img src={DaylightMediaPath(thumbPath)} alt={playlist.name} />
              ) : (
                <div className="placeholder"><span>🎵</span></div>
              )}
            </div>
            <div className="playlist-info">
              <div className="playlist-name">{playlist.name}</div>
              {playlist.trackCount && <div className="playlist-meta">{playlist.trackCount} tracks</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default FitnessPlaylistSelector;
