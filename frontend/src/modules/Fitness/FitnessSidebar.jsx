import React, { useState } from 'react';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import FitnessTreasureBox from './FitnessSidebar/FitnessTreasureBox.jsx';
import FitnessUsersList from './FitnessSidebar/FitnessUsers.jsx';
import FitnessSidebarMenu from './FitnessSidebar/FitnessSidebarMenu.jsx';
import FitnessVideo from './FitnessSidebar/FitnessVideo.jsx';
import FitnessVoiceMemo from './FitnessSidebar/FitnessVoiceMemo.jsx';
import './FitnessUsers.scss';

const FitnessSidebar = ({ playerRef }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [visibility, setVisibility] = useState({
    treasureBox: true,
    users: true,
    video: true,
    voiceMemo: true
  });

  const fitnessContext = useFitnessContext();
  const { treasureBox, fitnessSession } = fitnessContext;

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
          />
        </>
      )}
    </div>
  );
};

export default FitnessSidebar;
