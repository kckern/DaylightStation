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

const FitnessSidebar = ({ playerRef, onReloadVideo, reloadTargetSeconds = 0 }) => {
  const [menuState, setMenuState] = useState({ open: false, mode: 'settings', target: null });
  const [visibility, setVisibility] = useState({
    governance: false,
    treasureBox: true,
    users: true,
    video: true,
    voiceMemo: true
  });
  const [preferredMicrophoneId, setPreferredMicrophoneId] = useState('');
  const fitnessContext = useFitnessContext();
  const { 
    treasureBox, 
    fitnessSession, 
    selectedPlaylistId, 
    governanceState,
    usersConfigRaw,
    guestAssignments,
    assignGuestToDevice,
    clearGuestAssignment,
    sidebarSizeMode,
    musicEnabled,
    setMusicOverride
  } = fitnessContext;
  const menuOpen = menuState.open;
  const guestCandidates = React.useMemo(() => {
    const tag = (list, category) => (Array.isArray(list) ? list.map(item => ({ ...item, category })) : []);
    const family = tag(usersConfigRaw?.family, 'Family');
    const friends = tag(usersConfigRaw?.friends, 'Friend');
    return [...family, ...friends];
  }, [usersConfigRaw?.family, usersConfigRaw?.friends]);

  const openSettingsMenu = React.useCallback(() => {
    setMenuState({ open: true, mode: 'settings', target: null });
  }, []);

  const handleGuestAssignmentRequest = React.useCallback(({ deviceId, defaultName }) => {
    if (!deviceId) return;
    setMenuState({ open: true, mode: 'guest', target: { deviceId, defaultName: defaultName || null } });
  }, []);
  const isGoverned = Boolean(governanceState?.isGoverned);
  const showGovernancePanel = isGoverned || visibility.governance;

  const handleToggleMusic = React.useCallback(() => {
    if (!setMusicOverride) return;
    setMusicOverride(!musicEnabled);
  }, [musicEnabled, setMusicOverride]);

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
          <FitnessUsersList onRequestGuestAssignment={handleGuestAssignmentRequest} />
        </div>
      )}

      {/* Music Player */}
      {musicEnabled && (
        <div className="fitness-sidebar-music">
          <FitnessMusicPlayer 
            selectedPlaylistId={selectedPlaylistId} 
            videoPlayerRef={playerRef}
          />
        </div>
      )}

      {/* Combined Video + Voice Memo Controls */}
      {(visibility.video || visibility.voiceMemo) && (
        <div className="fitness-sidebar-media">
          <FitnessVoiceMemo 
            minimal 
            menuOpen={menuOpen}
            onToggleMenu={() => {
              if (menuOpen && menuState.mode === 'settings') {
                setMenuState({ open: false, mode: 'settings', target: null });
              } else {
                openSettingsMenu();
              }
            }}
            playerRef={playerRef}
            preferredMicrophoneId={preferredMicrophoneId}
          />
        </div>
      )}

      {/* Menu Overlay */}
      {menuOpen && (
        <>
          <div className="sidebar-menu-overlay" onClick={() => setMenuState({ open: false, mode: 'settings', target: null })} />
          <FitnessSidebarMenu 
            onClose={() => setMenuState({ open: false, mode: 'settings', target: null })}
            visibility={visibility}
            onToggleVisibility={handleToggleVisibility}
            musicEnabled={musicEnabled}
            onToggleMusic={handleToggleMusic}
            isGoverned={isGoverned}
            mode={menuState.mode}
            targetDeviceId={menuState.target?.deviceId || null}
            targetDefaultName={menuState.target?.defaultName || null}
            guestAssignments={guestAssignments}
            assignGuestToDevice={assignGuestToDevice}
            clearGuestAssignment={clearGuestAssignment}
            guestCandidates={guestCandidates}
            playerRef={playerRef}
            onReloadVideo={onReloadVideo}
            reloadTargetSeconds={reloadTargetSeconds}
            preferredMicrophoneId={preferredMicrophoneId}
            onSelectMicrophone={setPreferredMicrophoneId}
            sidebarSizeMode={sidebarSizeMode}
          />
        </>
      )}
    </div>
  );
};

export default FitnessSidebar;
