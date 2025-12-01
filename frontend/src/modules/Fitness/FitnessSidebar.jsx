import React, { useState, forwardRef, useImperativeHandle } from 'react';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { slugifyId } from '../../hooks/useFitnessSession.js';
import FitnessTreasureBox from './FitnessSidebar/FitnessTreasureBox.jsx';
import FitnessUsersList from './FitnessSidebar/FitnessUsers.jsx';
import FitnessSidebarMenu from './FitnessSidebar/FitnessSidebarMenu.jsx';
import FitnessVideo from './FitnessSidebar/FitnessVideo.jsx';
import FitnessVoiceMemo from './FitnessSidebar/FitnessVoiceMemo.jsx';
import FitnessMusicPlayer from './FitnessSidebar/FitnessMusicPlayer.jsx';
import FitnessGovernance from './FitnessSidebar/FitnessGovernance.jsx';
import './FitnessCam.scss';
import './FitnessSidebar/FitnessGovernance.scss';

const FitnessSidebar = forwardRef(({ playerRef, onReloadVideo, reloadTargetSeconds = 0, mode = 'player' }, ref) => {
  const fitnessContext = useFitnessContext();
  const isGovernedInitial = Boolean(fitnessContext?.governanceState?.isGoverned);
  const [menuState, setMenuState] = useState({ open: false, mode: 'settings', target: null });
  const [visibility, setVisibility] = useState(() => ({
    governance: isGovernedInitial,
    treasureBox: !isGovernedInitial,
    users: true,
    video: true,
    voiceMemo: true
  }));
  const [treasureBoxOverridden, setTreasureBoxOverridden] = useState(false);
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
    setMusicOverride,
    replacedPrimaryPool,
    preferredMicrophoneId,
    setPreferredMicrophoneId
  } = fitnessContext;
  const menuOpen = menuState.open;
  const guestCandidates = React.useMemo(() => {
    const tag = (list, category) => (Array.isArray(list) ? list.map(item => ({ ...item, category })) : []);
    const family = tag(usersConfigRaw?.family, 'Family');
    const friends = tag(usersConfigRaw?.friends, 'Friend');
    const primaryReturnees = Array.isArray(replacedPrimaryPool)
      ? replacedPrimaryPool.map((candidate) => ({
          ...candidate,
          category: candidate.category || 'Family',
          source: candidate.source || 'Family'
        }))
      : [];

    const primaryByName = new Map();
    if (Array.isArray(usersConfigRaw?.primary)) {
      usersConfigRaw.primary.forEach((cfg) => {
        if (cfg?.name) {
          primaryByName.set(cfg.name, cfg);
        }
      });
    }

    const primaryGuestPool = [];
    if (guestAssignments && primaryByName.size) {
      Object.values(guestAssignments).forEach((assignment) => {
        if (!assignment?.name) return;
        const match = primaryByName.get(assignment.name);
        if (!match) return;
        const id = match.id || slugifyId(match.name);
        primaryGuestPool.push({
          ...match,
          id,
          profileId: match.profileId || id,
          category: 'Family',
          source: match.source || 'Family',
          allowWhileAssigned: true
        });
      });
    }

    const combined = [...primaryGuestPool, ...primaryReturnees, ...family, ...friends];
    const seenIds = new Set();
    return combined.reduce((acc, candidate) => {
      if (!candidate || !candidate.name) return acc;
      const id = candidate.id || slugifyId(candidate.name);
      if (!id || seenIds.has(id)) return acc;
      seenIds.add(id);
      acc.push({
        ...candidate,
        id,
        profileId: candidate.profileId || id,
        category: candidate.category || 'Family',
        source: candidate.source || candidate.category || null,
        allowWhileAssigned: Boolean(candidate.allowWhileAssigned)
      });
      return acc;
    }, []);
  }, [guestAssignments, replacedPrimaryPool, usersConfigRaw?.family, usersConfigRaw?.friends, usersConfigRaw?.primary]);

  const openSettingsMenu = React.useCallback(() => {
    setMenuState({ open: true, mode: 'settings', target: null });
  }, []);

  useImperativeHandle(ref, () => ({
    openSettingsMenu
  }));

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
    setVisibility((prev) => {
      let next = prev;

      if (isGoverned && !prev.governance) {
        next = next === prev ? { ...prev } : next;
        next.governance = true;
      } else if (!isGoverned && prev.governance) {
        next = next === prev ? { ...prev } : next;
        next.governance = false;
      }

      if (!treasureBoxOverridden) {
        const desiredTreasureVisibility = !isGoverned;
        if (prev.treasureBox !== desiredTreasureVisibility) {
          next = next === prev ? { ...prev } : next;
          next.treasureBox = desiredTreasureVisibility;
        }
      }

      return next === prev ? prev : next;
    });
  }, [isGoverned, treasureBoxOverridden]);

  const handleToggleVisibility = (component) => {
    setVisibility(prev => ({
      ...prev,
      [component]: !prev[component]
    }));
    if (component === 'treasureBox') {
      setTreasureBoxOverridden(true);
    }
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
      {(visibility.video || visibility.voiceMemo) && mode === 'player' && (
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
            appMode={mode}
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
});

export default FitnessSidebar;
