import React, { useState } from 'react';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import FitnessTreasureBox from './FitnessSidebar/FitnessTreasureBox.jsx';
import FitnessUsersList from './FitnessSidebar/FitnessUsers.jsx';
import FitnessSidebarMenu from './FitnessSidebar/FitnessSidebarMenu.jsx';
import FitnessVideo from './FitnessSidebar/FitnessVideo.jsx';
import FitnessVoiceMemo from './FitnessSidebar/FitnessVoiceMemo.jsx';
import FitnessMusicPlayer from './FitnessSidebar/FitnessMusicPlayer.jsx';
import './FitnessUsers.scss';

const FitnessSidebar = ({ playerRef }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [visibility, setVisibility] = useState({
    treasureBox: true,
    users: true,
    raceChart: false,
    playlist: false,
    video: true,
    voiceMemo: true
  });
  const fitnessContext = useFitnessContext();
  const { treasureBox, fitnessSession, selectedPlaylistId, setSelectedPlaylistId } = fitnessContext;

  // Automatically show playlist when selectedPlaylistId is set
  React.useEffect(() => {
    if (selectedPlaylistId && !visibility.playlist) {
      setVisibility(prev => ({ ...prev, playlist: true }));
    }
  }, [selectedPlaylistId, visibility.playlist]);

  const handleToggleVisibility = (component) => {
    setVisibility(prev => ({
      ...prev,
      [component]: !prev[component]
    }));
  };

  return (
    <div className="fitness-sidebar-container">
      {/* Treasure Box */}
      {visibility.treasureBox && (
        <div className="fitness-sidebar-treasurebox">
          <FitnessTreasureBox box={treasureBox} session={fitnessSession} />
        </div>
      )}

      {/* Users List (HR monitors, RPM, etc) - grows to fill space */}
      {visibility.users && (
        <div className="fitness-sidebar-devices">
          <FitnessUsersList />
        </div>
      )}

      {/* Music Player */}
      {visibility.playlist && (
        <div className="fitness-sidebar-music">
          <FitnessMusicPlayer selectedPlaylistId={selectedPlaylistId} />
        </div>
      )}

      {/* Combined Video + Voice Memo Controls */}
      {(visibility.video || visibility.voiceMemo) && (
        <div className="fitness-sidebar-media">
          <FitnessVoiceMemo 
            minimal 
            menuOpen={menuOpen}
            onToggleMenu={() => setMenuOpen(!menuOpen)}
            playerRef={playerRef}
          />
        </div>
      )}

      {/* Menu Overlay */}
      {menuOpen && (
        <>
          <div className="sidebar-menu-overlay" onClick={() => setMenuOpen(false)} />
          <FitnessSidebarMenu 
            onClose={() => setMenuOpen(false)}
            visibility={visibility}
            onToggleVisibility={handleToggleVisibility}
            selectedPlaylistId={selectedPlaylistId}
            onPlaylistChange={setSelectedPlaylistId}
          />
        </>
      )}
    </div>
  );
};

export default FitnessSidebar;
