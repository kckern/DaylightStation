import React, { useState, forwardRef, useImperativeHandle } from 'react';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import FitnessTreasureBox from './FitnessSidebar/FitnessTreasureBox.jsx';
import FitnessUsersList from './FitnessSidebar/FitnessUsers.jsx';
import FitnessSidebarMenu from './FitnessSidebar/FitnessSidebarMenu.jsx';
import FitnessVideo from './FitnessSidebar/FitnessVideo.jsx';
import FitnessVoiceMemo from './FitnessSidebar/FitnessVoiceMemo.jsx';
import FitnessMusicPlayer from './FitnessSidebar/FitnessMusicPlayer.jsx';
import FitnessGovernance from './FitnessSidebar/FitnessGovernance.jsx';
import './FitnessSidebar.scss';
import './FitnessSidebar/FitnessGovernance.scss';

const FitnessSidebar = forwardRef(({ playerRef, videoVolume, onReloadVideo, reloadTargetSeconds = 0, mode = 'player', governanceDisabled = false, viewMode = 'cam', onToggleViewMode = null, miniCamContent = null, onToggleChart = null, showChart = true, boostLevel, setBoost }, ref) => {
  const fitnessContext = useFitnessContext();
  const isGovernedInitial = governanceDisabled ? false : Boolean(fitnessContext?.governanceState?.isGoverned);
  const [menuState, setMenuState] = useState({ open: false, mode: 'settings', target: null });
  const [visibility, setVisibility] = useState(() => ({
    governance: governanceDisabled ? false : isGovernedInitial,
    treasureBox: governanceDisabled ? true : !isGovernedInitial,
    users: true,
    video: true,
    voiceMemo: true,
    sidebarCam: true
  }));
  const [treasureBoxOverridden, setTreasureBoxOverridden] = useState(false);
  const { 
    treasureBox, 
    fitnessSession, 
    selectedPlaylistId, 
    governanceState,
    usersConfigRaw,
    deviceAssignments = [],
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
    if (primaryByName.size) {
      deviceAssignments.forEach((assignment) => {
        if (!assignment?.occupantName) return;
        const match = primaryByName.get(assignment.occupantName);
        if (!match) return;
        // Use explicit ID from match config
        const id = match.id || match.profileId;
        if (!id) {
          console.warn('[FitnessSidebar] primaryGuestPool: match missing id for', match.name);
          return;
        }
        primaryGuestPool.push({
          ...match,
          id,
          profileId: id,
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
      // Use explicit ID from candidate
      const id = candidate.id || candidate.profileId;
      if (!id) {
        console.warn('[FitnessSidebar] guestCandidates: candidate missing id for', candidate.name);
        return acc;
      }
      if (seenIds.has(id)) return acc;
      seenIds.add(id);
      acc.push({
        ...candidate,
        id,
        profileId: id,
        category: candidate.category || 'Family',
        source: candidate.source || candidate.category || null,
        allowWhileAssigned: Boolean(candidate.allowWhileAssigned)
      });
      return acc;
    }, []);
  }, [deviceAssignments, replacedPrimaryPool, usersConfigRaw?.family, usersConfigRaw?.friends, usersConfigRaw?.primary]);

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
  const isGoverned = governanceDisabled ? false : Boolean(governanceState?.isGoverned);
  const showGovernancePanel = !governanceDisabled && (isGoverned || visibility.governance);

  const handleToggleMusic = React.useCallback(() => {
    if (!setMusicOverride) return;
    setMusicOverride(!musicEnabled);
  }, [musicEnabled, setMusicOverride]);

  const handleTreasureBoxActivate = React.useCallback(() => {
    if (typeof onToggleChart === 'function') {
      onToggleChart();
      return;
    }
    if (typeof onToggleViewMode === 'function') {
      onToggleViewMode();
    }
  }, [onToggleViewMode, onToggleChart]);

  React.useEffect(() => {
    if (governanceDisabled) {
      return;
    }
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
  }, [isGoverned, treasureBoxOverridden, governanceDisabled]);

  const handleToggleVisibility = (component) => {
    if (governanceDisabled && component === 'governance') {
      return;
    }
    setVisibility(prev => ({
      ...prev,
      [component]: !prev[component]
    }));
    if (component === 'treasureBox') {
      setTreasureBoxOverridden(true);
    }
  };

  return (
    <div className={`fitness-sidebar-container fitness-sidebar-mode-${mode}`}>
      {/* Mini cam slot when chart is in main view */}


      {/* Treasure Box */}
      {visibility.treasureBox && (
        <div
          className="fitness-sidebar-treasurebox"
          role="button"
          tabIndex={0}
          onClick={handleTreasureBoxActivate}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleTreasureBoxActivate();
            }
          }}
        >
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
            videoVolume={videoVolume}
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
            assignGuestToDevice={assignGuestToDevice}
            clearGuestAssignment={clearGuestAssignment}
            guestCandidates={guestCandidates}
            playerRef={playerRef}
            onReloadVideo={onReloadVideo}
            reloadTargetSeconds={reloadTargetSeconds}
            preferredMicrophoneId={preferredMicrophoneId}
            onSelectMicrophone={setPreferredMicrophoneId}
            sidebarSizeMode={sidebarSizeMode}
            governanceDisabled={governanceDisabled}
            viewMode={viewMode}
            onToggleViewMode={onToggleViewMode}
            showChart={showChart}
            onToggleChart={onToggleChart}
            boostLevel={boostLevel}
            setBoost={setBoost}
            videoVolume={videoVolume}
          />
        </>
      )}
    </div>
  );
});

export default FitnessSidebar;
