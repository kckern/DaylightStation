import React from 'react';
import { useFitnessContext, FITNESS_DEBUG } from '@/context/FitnessContext.jsx';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { TouchVolumeButtons, snapToTouchLevel, linearVolumeFromLevel, linearLevelFromVolume } from './TouchVolumeButtons.jsx';
import DebugMicButton from './DebugMicButton.jsx';
import { buildGuestOptions, nextGenericGuestName, zonesMapToArray } from '../../lib/guestOptionsBuilder.js';
import { genericGuestImageId } from '../../lib/guestPlaceholders.js';
import FeedbackOverlay from '@/modules/Feedback/FeedbackOverlay.jsx';
import hardReload from '../../lib/hardReload.js';
import '../FitnessSidebar.scss';

// Auto-close behavior for quick-action settings: flash the selected control
// briefly so the user sees their tap was registered, then dismiss the menu.
const ACK_FLASH_MS = 300;
const MENU_IDLE_CLOSE_MS = 5000;

// Note: slugifyId has been removed - we now use explicit IDs from config

const FitnessSidebarMenu = ({
  onClose,
  visibility,
  onToggleVisibility,
  musicEnabled,
  onToggleMusic,
  mode = 'settings',
  appMode = 'player',
  targetDeviceId,
  targetDefaultName,
  assignGuestToDevice,
  guestCandidates = [],
  playerRef,
  onReloadVideo,
  reloadTargetSeconds = 0,
  preferredMicrophoneId = '',
  onSelectMicrophone,
  sidebarSizeMode = 'regular',
  viewMode = 'cam',
  onToggleViewMode = null,
  showChart = true,
  onToggleChart = null,
  boostLevel,
  setBoost,
  videoVolume,
  activeSessionId = null,
  endingSession = false,
  endSessionError = null,
  onEndSession = null
}) => {
  const fitnessContext = useFitnessContext();
  const pauseMusicPlayer = fitnessContext?.pauseMusicPlayer;
  const resumeMusicPlayer = fitnessContext?.resumeMusicPlayer;
  const setFeedbackRecordingActive = fitnessContext?.setFeedbackRecordingActive;
  // pauseMusicPlayer only reaches the in-session FitnessMusicPlayer (unmounted
  // on plain browse/menu screens); the ambient MENU music is a separate player
  // (useMenuMusic via MenuMusicController) ducked instead via the context flag.
  const onFeedbackPauseMusic = React.useCallback(() => {
    pauseMusicPlayer?.();
    setFeedbackRecordingActive?.(true);
  }, [pauseMusicPlayer, setFeedbackRecordingActive]);
  const onFeedbackResumeMusic = React.useCallback(() => {
    resumeMusicPlayer?.();
    setFeedbackRecordingActive?.(false);
  }, [resumeMusicPlayer, setFeedbackRecordingActive]);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const deviceAssignments = fitnessContext?.deviceAssignments || [];
  const getDeviceAssignment = fitnessContext?.getDeviceAssignment;
  const activeHeartRateParticipants = fitnessContext?.activeHeartRateParticipants || [];
  const [selectedTab, setSelectedTab] = React.useState('friends');
  const [confirmEndSession, setConfirmEndSession] = React.useState(false);
  const playlists = fitnessContext?.plexConfig?.music_playlists || [];
  const suppressDeviceUntilNextReading = fitnessContext?.suppressDeviceUntilNextReading;
  const hasMusicPlaylists = playlists.length > 0;
  const deviceIdStr = targetDeviceId ? String(targetDeviceId) : null;
  const activeAssignment = deviceIdStr
    ? (typeof getDeviceAssignment === 'function'
        ? getDeviceAssignment(deviceIdStr)
        : deviceAssignments.find((entry) => String(entry.deviceId) === deviceIdStr))
    : null;
  const baseUser = deviceIdStr ? fitnessContext?.getUserByDevice?.(deviceIdStr) : null;
  const baseName = activeAssignment?.metadata?.baseUserName || targetDefaultName || baseUser?.name || null;
  const monitorLabel = deviceIdStr ? `#${deviceIdStr}` : 'Unknown';
  const currentLabel = activeAssignment?.occupantName || activeAssignment?.metadata?.name || baseName || 'Unassigned';
  // Continuous-usage threshold (fitness.yml → governance.usage_threshold_seconds,
  // 300s default — same resolution FitnessContext uses for GuestAssignmentService).
  const fitnessRoot = fitnessContext?.fitnessConfiguration?.fitness
    || fitnessContext?.fitnessConfiguration
    || {};
  const usageThresholdSeconds = fitnessRoot?.governance?.usage_threshold_seconds;
  // Audit N4: configured guest profiles (fitness.yml → guest_profiles) drive
  // age-class generic options (e.g. kid zone-threshold overrides).
  const guestProfiles = fitnessRoot?.guest_profiles || null;
  const usageThresholdMs = (Number.isFinite(usageThresholdSeconds) ? usageThresholdSeconds : 300) * 1000;
  const segmentAgeMs = Number.isFinite(activeAssignment?.updatedAt)
    ? Date.now() - activeAssignment.updatedAt
    : null;
  const segmentWillTransfer = Number.isFinite(segmentAgeMs) && segmentAgeMs < usageThresholdMs;
  const currentSummaryClass = `guest-summary-value${activeAssignment ? ' guest-summary-value--active' : ''}`;
  const [mediaElement, setMediaElement] = React.useState(() => playerRef?.current?.getMediaElement?.() || null);

  const isWideSidebar = sidebarSizeMode === 'large';

  const videoMediaAvailable = Boolean(mediaElement);

  // Track media element replacements so boost can rebind after player remounts
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let cancelled = false;
    const updateElement = () => {
      const next = playerRef?.current?.getMediaElement?.() || null;
      setMediaElement((prev) => (prev === next ? prev : next));
    };
    updateElement();
    const intervalId = window.setInterval(() => {
      if (!cancelled) updateElement();
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [playerRef]);

  React.useEffect(() => {
    if (mediaElement && videoVolume) {
      videoVolume.applyToPlayer?.();
    }
  }, [mediaElement, videoVolume]);

  const videoDisplayLevel = React.useMemo(
    () => snapToTouchLevel(linearLevelFromVolume(videoVolume?.volume)),
    [videoVolume?.volume]
  );

  // Tracks which control is mid-ack-flash. The menu auto-closes after
  // MENU_IDLE_CLOSE_MS of no pointer/key/change activity inside its root.
  const [flashingId, setFlashingId] = React.useState(null);
  const ackTimerRef = React.useRef(null);
  const closeTimerRef = React.useRef(null);
  React.useEffect(() => () => {
    if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const scheduleIdleClose = React.useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose?.();
    }, MENU_IDLE_CLOSE_MS);
  }, [onClose]);

  const ackSelection = React.useCallback((id) => {
    setFlashingId(id);
    if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
    ackTimerRef.current = setTimeout(() => {
      setFlashingId(null);
      ackTimerRef.current = null;
    }, ACK_FLASH_MS);
    scheduleIdleClose();
  }, [scheduleIdleClose]);

  const rootInteractionHandlers = React.useMemo(() => ({
    onPointerDown: scheduleIdleClose,
    onTouchStart: scheduleIdleClose,
    onKeyDown: scheduleIdleClose,
    onChange: scheduleIdleClose,
  }), [scheduleIdleClose]);

  const handleVideoLevelSelect = React.useCallback((level) => {
    const next = linearVolumeFromLevel(level);
    videoVolume?.setVolume?.(next);
    ackSelection('video-volume');
  }, [videoVolume, ackSelection]);

  const handleReloadPage = () => {
    hardReload('settings-menu');
  };

  const handleReloadVideo = () => {
    if (onReloadVideo) {
      onReloadVideo();
    }
  };

  const formatSeconds = (seconds) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const hours = Math.floor(mins / 60);
    if (hours > 0) {
      const remMins = mins % 60;
      return `${hours}:${String(remMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const reloadLabel = formatSeconds(reloadTargetSeconds);

  const guestOptions = React.useMemo(() => buildGuestOptions({
    guestCandidates,
    deviceAssignments,
    activeAssignment,
    activeHeartRateParticipants,
    baseName,
    baseUserId: baseName ? (fitnessContext?.getUserByName?.(baseName)?.id ?? null) : null,
    selectedTab,
    guestProfiles
  }), [guestCandidates, activeAssignment, baseName, selectedTab, deviceAssignments, activeHeartRateParticipants, fitnessContext, guestProfiles]);

  // Auto-switch to Family tab if Friends tab is empty or all used up
  React.useEffect(() => {
    if (selectedTab === 'friends' && guestOptions.filteredOptions.length === 0) {
      setSelectedTab('family');
    }
  }, [selectedTab, guestOptions.filteredOptions.length]);

  const handleToggle = (component) => {
    onToggleVisibility(component);
    ackSelection(component);
  };

  const handleChartToggle = () => {
    onToggleChart?.();
    ackSelection('chart');
  };

  const handleMusicToggle = () => {
    onToggleMusic?.();
    ackSelection('music');
  };

  const handleBoostSelect = (level) => {
    setBoost(level);
    ackSelection(`boost-${level}`);
  };

  const handleAssignGuest = (option) => {
    if (!assignGuestToDevice || !deviceIdStr) return;
    // W2: generic "Guest" gets a device-keyed alias so two simultaneous
    // Guests on different devices resolve to distinct User identities.
    // Configured users keep their explicit profileId / id.
    const profileId = option.isGeneric
      ? `guest_${deviceIdStr}`
      : (option.profileId || option.id);
    // Audit N3: simultaneous generic Guests get numbered names (Guest, Guest 2, ...)
    const name = option.isGeneric
      ? nextGenericGuestName(deviceAssignments)
      : option.name;
    // Audit N4: age-class options (e.g. Guest kid) carry configured zone
    // overrides into ledger metadata.zones, which
    // UserManager.resolveUserForDevice applies via buildZoneConfig.
    const ageClass = option.ageClass || null;
    const zones = ageClass ? zonesMapToArray(guestProfiles?.[ageClass]?.zones) : null;
    assignGuestToDevice(deviceIdStr, {
      name,
      profileId,
      candidateId: option.id,
      source: option.source,
      baseUserName: baseName,
      ...(ageClass ? { ageClass } : {}),
      ...(zones ? { zones } : {})
    });
    if (onClose) onClose();
  };

  const handleRemoveUser = React.useCallback(() => {
    if (!deviceIdStr || !suppressDeviceUntilNextReading) return;
    suppressDeviceUntilNextReading(deviceIdStr);
    if (onClose) onClose();
  }, [deviceIdStr, suppressDeviceUntilNextReading, onClose]);

  const canRemoveUser = Boolean(deviceIdStr && suppressDeviceUntilNextReading);

  const renderSettings = () => (
    <>


      <div className="menu-section">

        <h4>Media Visibility</h4>
        <div
          className={`menu-item toggle-item${flashingId === 'sidebarCam' ? ' is-ack-flash' : ''}`}
          onPointerDown={() => handleToggle('sidebarCam')}
        >
          <span>📹 Sidebar Webcam</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={Boolean(visibility.sidebarCam)}
              readOnly
            />
            <span className="toggle-slider"></span>
          </label>
        </div>



        <div
          className={`menu-item toggle-item${flashingId === 'treasureBox' ? ' is-ack-flash' : ''}`}
          onPointerDown={() => handleToggle('treasureBox')}
        >
          <span>💰 Treasure Box</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={visibility.treasureBox}
              readOnly
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div
          className={`menu-item toggle-item${flashingId === 'music' ? ' is-ack-flash' : ''}`}
          onPointerDown={handleMusicToggle}
        >
          <span>🎵 Music</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={musicEnabled}
              disabled={!hasMusicPlaylists && !musicEnabled}
              readOnly
            />
            <span className="toggle-slider"></span>
          </label>
        </div>
        {!hasMusicPlaylists && (
          <div className="menu-item-subtext">Add a fitness playlist to enable music.</div>
        )}
      </div>

      <div className="menu-section">
        <button
          type="button"
          className="menu-item"
          aria-label="Send feedback"
          onClick={() => setFeedbackOpen(true)}
        >
          💬 Send feedback
        </button>
        <FeedbackOverlay
          open={feedbackOpen}
          app="fitness"
          onClose={() => setFeedbackOpen(false)}
          onPauseMusic={onFeedbackPauseMusic}
          onResumeMusic={onFeedbackResumeMusic}
        />
      </div>

      <div className="menu-section">
        <h4>Maintenance</h4>
        <button
          type="button"
          className="menu-item"
          onPointerDown={handleReloadPage}
          aria-label="Hard-reload the app (bypasses cache)"
          title="Hard-reload the app — picks up new versions"
        >
          🔄 Reload App
        </button>
      </div>

      {activeSessionId && onEndSession && (
        <div className="menu-section">
          <h4>Session</h4>
          {endSessionError && (
            <div className="menu-item-subtext fitness-sidebar-end-session-error" role="alert">
              {endSessionError}
            </div>
          )}
          <button
            type="button"
            className="menu-item action-item danger"
            onPointerDown={() => {
              setConfirmEndSession(true);
              ackSelection('end-session');
            }}
            disabled={endingSession}
            aria-label="End current fitness session"
            title="Force end the current session so it won't auto-merge with the next workout"
          >
            {endingSession ? 'Ending…' : '⏹ End Session'}
          </button>
        </div>
      )}

      {appMode === 'player' && (
      <div className="menu-section">
        <h4>Video Controls</h4>
        <div className="menu-item touch-volume-item" role="group" aria-label="Video volume">
          <div className="mix-label" id="video-volume-label">
            Video Volume
          </div>
          <TouchVolumeButtons
            controlId="video-volume"
            currentLevel={videoDisplayLevel}
            disabled={!videoMediaAvailable}
            onSelect={handleVideoLevelSelect}
          />
          {!videoMediaAvailable && (
            <div className="menu-item-subtext">Video player inactive.</div>
          )}
        </div>
        <div className="menu-item touch-volume-item" role="group" aria-label="Video volume">
          <div className="mix-label" id="video-volume-label">
            Video Volume Boost
          </div>
          <div className="volume-boost-controls">
            {[1, 5, 10, 20].map((level) => (
              <button
                key={level}
                type="button"
                className={`boost-btn ${boostLevel === level ? 'active' : ''}${flashingId === `boost-${level}` ? ' is-ack-flash' : ''}`}
                onPointerDown={() => handleBoostSelect(level)}
                disabled={!videoMediaAvailable}
              >
                {level}x
              </button>
            ))}
          </div>
        </div>
      </div>
      )}

    </>
  );

  const renderGuestAssignment = () => {
    if (!deviceIdStr) {
      return (
        <div className="menu-section">
          <div className="menu-item">Select a monitor to assign a guest.</div>
        </div>
      );
    }

    const renderOption = (option) => {
      const avatarClass = ['guest-option-avatar'];
      if (option.isGeneric) avatarClass.push('placeholder');
      return (
        <button
          key={`guest-option-${option.id}`}
          type="button"
          className={`menu-item guest-option ${option.isGeneric ? 'generic' : ''}`}
          onClick={() => handleAssignGuest(option)}
        >
          <div className={avatarClass.join(' ')}>
            <img
              src={DaylightMediaPath(`/static/img/users/${
                option.isGeneric ? genericGuestImageId(option.ageClass) : (option.profileId || option.id)
              }`)}
              alt={`${option.name} avatar`}
              data-generic={option.isGeneric ? '1' : undefined}
              onLoad={(e) => {
                const parent = e.target.closest('.guest-option-avatar');
                if (parent) parent.classList.remove('placeholder');
              }}
              onError={(e) => {
                if (e.target.dataset.fallback) {
                  const parent = e.target.closest('.guest-option-avatar');
                  if (parent) parent.classList.add('placeholder');
                  e.target.style.display = 'none';
                  return;
                }
                e.target.dataset.fallback = '1';
                const parent = e.target.closest('.guest-option-avatar');
                if (parent) parent.classList.add('placeholder');
                e.target.src = DaylightMediaPath('/static/img/users/user');
              }}
            />
          </div>
          <div className="guest-option-details">
            <span className="guest-option-name">{option.name}</span>
            {option.source && <span className="guest-option-source">{option.source}</span>}
          </div>
        </button>
      );
    };

    return (
      <div className="guest-mode-content">
        {!baseName && (
          <div className="guest-menu-hint">
            Unrecognized heart-rate strap <strong>{monitorLabel}</strong>.
            Pick who’s wearing it — or “Guest” if they’re visiting.
          </div>
        )}
        {segmentWillTransfer && (
          <div className="guest-menu-note">
            {currentLabel}’s last {Math.max(1, Math.round(segmentAgeMs / 60000))} min on this
            strap will transfer to whoever you pick.
          </div>
        )}
        {/* Top options: Original and Guest */}
        {guestOptions.topOptions.length > 0 && (
          <div className="menu-section">
            {guestOptions.topOptions.map(renderOption)}
          </div>
        )}
        
        {/* Tabs for filtering */}
        <div className="guest-tabs">
          <button
            type="button"
            className={`guest-tab ${selectedTab === 'friends' ? 'active' : ''}`}
            onClick={() => setSelectedTab('friends')}
          >
            Friends
          </button>
          <button
            type="button"
            className={`guest-tab ${selectedTab === 'family' ? 'active' : ''}`}
            onClick={() => setSelectedTab('family')}
          >
            Family
          </button>
        </div>

        {/* Filtered options based on selected tab */}
        {guestOptions.filteredOptions.length > 0 && (
          <div className="menu-section guest-grid">
            {guestOptions.filteredOptions.map(renderOption)}
          </div>
        )}

        <div className="menu-section">
          <button
            type="button"
            className="menu-item action-item danger"
            onClick={handleRemoveUser}
            disabled={!canRemoveUser}
          >
            ⛔ Ignore This Strap
          </button>
        </div>
      </div>
    );
  };

  const isGuestMode = mode === 'guest';

  return (
    <div
      className={`fitness-sidebar-menu ${isGuestMode ? 'guest-mode' : ''}`}
      {...rootInteractionHandlers}
    >
      <div className="sidebar-menu-header">
        <h3>{isGuestMode ? 'Assign Guest' : 'Settings'}</h3>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="sidebar-menu-content">
        {isGuestMode ? renderGuestAssignment() : renderSettings()}
      </div>
      {confirmEndSession && (
        <div
          className="end-session-confirm-overlay"
          onClick={() => setConfirmEndSession(false)}
        >
          <div
            className="end-session-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-session-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="end-session-confirm-title">End this fitness session?</h3>
            <p>
              Subsequent heart-rate readings will start a new session.
            </p>
            <div className="end-session-confirm-actions">
              <button
                type="button"
                className="end-session-confirm-cancel"
                onClick={() => setConfirmEndSession(false)}
                disabled={endingSession}
              >
                Cancel
              </button>
              <button
                type="button"
                className="end-session-confirm-accept"
                onClick={(event) => {
                  setConfirmEndSession(false);
                  if (typeof onEndSession === 'function') {
                    onEndSession(event);
                  }
                }}
                disabled={endingSession}
              >
                {endingSession ? 'Ending…' : 'End Session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FitnessSidebarMenu;
