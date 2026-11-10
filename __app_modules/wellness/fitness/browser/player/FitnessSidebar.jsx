import React, { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { useFitnessContext } from "../context/FitnessContext.jsx";
import getLogger from '@/lib/logging/Logger.js';
import { useRenderProfiler } from "../hooks/fitness/useRenderProfiler.js";
import FitnessTreasureBox from "./panels/FitnessTreasureBox.jsx";
import FitnessUsersList from "./panels/FitnessUsers.jsx";
import FitnessSidebarMenu from "./panels/FitnessSidebarMenu.jsx";
import SidebarMenuScrim from "./SidebarMenuScrim.jsx";
import FitnessVoiceMemo from "./panels/FitnessVoiceMemo.jsx";
import FitnessMusicPlayer from "./panels/FitnessMusicPlayer.jsx";
import FitnessGovernance from "./panels/FitnessGovernance.jsx";
import { DaylightAPI } from '@/lib/api.mjs';
import { buildEndSessionRequest } from "./endSessionRequest.js";
import { buildGuestCandidates } from "../lib/guestOptionsBuilder.js";
import "./FitnessSidebar.scss";
import "./panels/FitnessGovernance.scss";

const FitnessSidebar = forwardRef(({ playerRef, videoVolume, onReloadVideo, reloadTargetSeconds = 0, mode = 'player', governanceDisabled = false, viewMode = 'cam', onToggleViewMode = null, miniCamContent = null, onToggleChart = null, showChart = true, boostLevel, setBoost }, ref) => {
  useRenderProfiler('FitnessSidebar');
  const fitnessContext = useFitnessContext();
  const isGovernedInitial = governanceDisabled ? false : Boolean(fitnessContext?.governanceState?.isGoverned);
  const [menuState, setMenuState] = useState({ open: false, mode: 'settings', target: null });
  const sidebarRef = useRef(null);
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
    fitnessSessionInstance,
    selectedPlaylistId,
    governanceState,
    usersConfigRaw,
    deviceAssignments = [],
    assignGuestToDevice,
    sidebarSizeMode,
    musicEnabled,
    replacedPrimaryPool,
    preferredMicrophoneId,
    setPreferredMicrophoneId,
    musicPlayerRef,
    requestEndSession
  } = fitnessContext;
  const menuOpen = menuState.open;

  const [endingSession, setEndingSession] = useState(false);
  const [endSessionError, setEndSessionError] = useState(null);
  const activeSessionId = fitnessSessionInstance?.sessionId || null;

  const handleEndSession = React.useCallback(async (event) => {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    const req = buildEndSessionRequest(activeSessionId);
    if (!req) return;
    if (endingSession) return;
    setEndingSession(true);
    setEndSessionError(null);
    // End the LIVE session immediately (reliable, same-browser). The server POST
    // below is a finalize backstop that also triggers the time-lapse recap.
    try { requestEndSession?.(); } catch (_) { /* live-end best effort */ }
    try {
      await DaylightAPI(req.path, req.body, req.method);
    } catch (err) {
      setEndSessionError(err?.message || 'Failed to end session');
    } finally {
      setEndingSession(false);
    }
  }, [activeSessionId, endingSession, requestEndSession]);
  const guestCandidates = React.useMemo(() => buildGuestCandidates({
    usersConfig: usersConfigRaw,
    deviceAssignments,
    replacedPrimaryPool,
    logger: getLogger(),
  }), [deviceAssignments, replacedPrimaryPool, usersConfigRaw?.family, usersConfigRaw?.friends, usersConfigRaw?.primary]);

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
    <div ref={sidebarRef} className={`fitness-sidebar-container fitness-sidebar-mode-${mode}`}>
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
          <FitnessUsersList
            onRequestGuestAssignment={handleGuestAssignmentRequest}
          />
        </div>
      )}

      {/* Music is opt-in on the standalone chart and automatic only for media
          explicitly configured without its own soundtrack. */}
      {musicEnabled && (
        <div className="fitness-sidebar-music">
          <FitnessMusicPlayer
            ref={musicPlayerRef}
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

      {mode === 'cam' && (
        <div className="fitness-sidebar-media">
          <div className="media-controls-container">
            {miniCamContent && (
              <div className="media-video-section">{miniCamContent}</div>
            )}
            <div className="media-button-panel">
              <button
                className="media-config-btn"
                onClick={() => {
                  if (menuOpen && menuState.mode === 'settings') {
                    setMenuState({ open: false, mode: 'settings', target: null });
                  } else {
                    openSettingsMenu();
                  }
                }}
                title="Open menu"
              >
                ⋮
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Menu Overlay */}
      {menuOpen && (
        <>
          <SidebarMenuScrim
            anchorRef={sidebarRef}
            onClose={() => setMenuState({ open: false, mode: 'settings', target: null })}
          />
          <FitnessSidebarMenu 
            onClose={() => setMenuState({ open: false, mode: 'settings', target: null })}
            appMode={mode}
            visibility={visibility}
            onToggleVisibility={handleToggleVisibility}
            isGoverned={isGoverned}
            mode={menuState.mode}
            targetDeviceId={menuState.target?.deviceId || null}
            targetDefaultName={menuState.target?.defaultName || null}
            assignGuestToDevice={assignGuestToDevice}
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
            activeSessionId={activeSessionId}
            endingSession={endingSession}
            endSessionError={endSessionError}
            onEndSession={handleEndSession}
          />
        </>
      )}

    </div>
  );
});

FitnessSidebar.displayName = 'FitnessSidebar';

export default FitnessSidebar;
