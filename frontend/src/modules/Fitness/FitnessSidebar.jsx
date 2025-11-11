import React, { useState } from 'react';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import FitnessTreasureBox from './FitnessSidebar/FitnessTreasureBox.jsx';
import FitnessUsersList from './FitnessSidebar/FitnessUsers.jsx';
import FitnessSidebarMenu from './FitnessSidebar/FitnessSidebarMenu.jsx';
import FitnessVideo from './FitnessSidebar/FitnessVideo.jsx';
import FitnessVoiceMemo from './FitnessSidebar/FitnessVoiceMemo.jsx';
import FitnessMusicPlayer from './FitnessSidebar/FitnessMusicPlayer.jsx';
import FitnessGovernance from './FitnessSidebar/FitnessGovernance.jsx';
import './FitnessUsers.scss';
import './FitnessSidebar/FitnessGovernance.scss';

const FitnessSidebar = ({ playerRef }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [visibility, setVisibility] = useState({
    governance: false,
    treasureBox: true,
    users: true,
    raceChart: false,
    playlist: false,
    video: true,
    voiceMemo: true
  });
  const fitnessContext = useFitnessContext();
  const { treasureBox, fitnessSession, selectedPlaylistId, setSelectedPlaylistId, governanceState } = fitnessContext;
  const isGoverned = Boolean(governanceState?.isGoverned);
  const showGovernancePanel = isGoverned || visibility.governance;

  React.useEffect(() => {
    setVisibility(prev => {
      if (isGoverned) {
        if (prev.governance) return prev;
        return { ...prev, governance: true };
      }
      if (!prev.governance) return prev;
      return { ...prev, governance: false };
    });
  }, [isGoverned]);

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

      {/* Governance Monitor */}
      {showGovernancePanel && (
        <div className="fitness-sidebar-governance">
          <FitnessGovernance />
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
            isGoverned={isGoverned}
          />
        </>
      )}
    </div>
  );
};

export default FitnessSidebar;
