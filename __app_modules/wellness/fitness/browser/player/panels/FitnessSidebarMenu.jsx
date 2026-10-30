import React from 'react';
import { useFitnessContext } from "../../context/FitnessContext.jsx";
import { DaylightMediaPath } from '@/lib/api.mjs';
import { TouchVolumeButtons } from "../../../../../../__capabilities/playback/browser/volume/TouchVolumeButtons.jsx";
import { snapToTouchLevel, linearVolumeFromLevel, linearLevelFromVolume } from "../../../../../../__capabilities/playback/browser/volume/touchVolumeModel.js";
import { buildGuestOptions, nextGenericGuestName, zonesMapToArray } from "../../lib/guestOptionsBuilder.js";
import { genericGuestImageId } from "../../lib/guestPlaceholders.js";
import FeedbackOverlay from '@/modules/Feedback/FeedbackOverlay.jsx';
import hardReload from "../../lib/hardReload.js";
import "../FitnessSidebar.scss";
import { menuFocusStops, nextFocusStop, rowNeighbour } from "./sidebarMenuFocus.js";
import { useGamepadKeys } from "../../lib/useGamepadKeys.js";
import RingIcon from '@/lib/icons/RingIcon.jsx';
import getLogger from '@/lib/logging/Logger.js';

// Auto-close behavior for quick-action settings: flash the selected control
// briefly so the user sees their tap was registered, then dismiss the menu.
const ACK_FLASH_MS = 300;
const MENU_IDLE_CLOSE_MS = 5000;

// Note: slugifyId has been removed - we now use explicit IDs from config

const FitnessSidebarMenu = ({
  onClose,
  visibility,
  onToggleVisibility,
  mode = 'settings',
  appMode = 'player',
  targetDeviceId,
  targetDefaultName,
  assignGuestToDevice,
  guestCandidates = [],
  playerRef,
  onReloadVideo: _onReloadVideo,
  reloadTargetSeconds = 0,
  onSelectMicrophone: _onSelectMicrophone,
  sidebarSizeMode: _sidebarSizeMode = 'regular',
  onToggleChart: _onToggleChart = null,
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
  const feedbackOpenRef = React.useRef(false);
  feedbackOpenRef.current = feedbackOpen;
  const deviceAssignments = React.useMemo(
    () => fitnessContext?.deviceAssignments || [],
    [fitnessContext?.deviceAssignments],
  );
  const getDeviceAssignment = fitnessContext?.getDeviceAssignment;
  const activeHeartRateParticipants = React.useMemo(
    () => fitnessContext?.activeHeartRateParticipants || [],
    [fitnessContext?.activeHeartRateParticipants],
  );
  const [selectedTab, setSelectedTab] = React.useState('friends');
  const [confirmEndSession, setConfirmEndSession] = React.useState(false);
  const suppressDeviceUntilNextReading = fitnessContext?.suppressDeviceUntilNextReading;
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
    const [mediaElement, setMediaElement] = React.useState(() => playerRef?.current?.getMediaElement?.() || null);

  
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
  const focusWithinRef = React.useRef(false);
  React.useEffect(() => () => {
    if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const scheduleIdleClose = React.useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (!focusWithinRef.current && !feedbackOpenRef.current) onClose?.();
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

  const rootRef = React.useRef(null);
  const closeRef = React.useRef(null);
  const programmaticFocusRef = React.useRef(false);
  // Keyboard focus inside the menu holds it open. A tap also focuses the
  // button or checkbox it lands on; that focus must not cancel the idle close.
  const pointerOriginRef = React.useRef(false);
  const rootInteractionHandlers = React.useMemo(() => {
    const onPointer = () => { pointerOriginRef.current = true; scheduleIdleClose(); };
    return {
      onPointerDown: onPointer,
      onTouchStart: onPointer,
      onKeyDown: () => { pointerOriginRef.current = false; scheduleIdleClose(); },
      onChange: scheduleIdleClose,
      onWheel: scheduleIdleClose,
      onTouchMove: scheduleIdleClose,
      onScrollCapture: scheduleIdleClose,
      onFocusCapture: () => {
        // Focusing Close on open is not a user's keyboard focus: no hold, no timer.
        if (programmaticFocusRef.current) return;
        focusWithinRef.current = !pointerOriginRef.current; scheduleIdleClose();
      },
      onBlurCapture: (event) => {
        focusWithinRef.current = !pointerOriginRef.current && event.currentTarget.contains(event.relatedTarget);
        scheduleIdleClose();
      },
    };
  }, [scheduleIdleClose]);

  const handleVideoLevelSelect = React.useCallback((level) => {
    const next = linearVolumeFromLevel(level);
    videoVolume?.setVolume?.(next);
    ackSelection('video-volume');
  }, [videoVolume, ackSelection]);

  const handleReloadPage = () => {
    hardReload('settings-menu');
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

  formatSeconds(reloadTargetSeconds);

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

  const pickerLogger = React.useMemo(() => getLogger().child({ component: 'fitness-guest-picker' }), []);
  // guest_picker.opened — once per (device) open, with what was offered on
  // each tab, so "why couldn't I pick X?" is answerable from the log store.
  const pickerOpenLoggedRef = React.useRef(null);
  React.useEffect(() => {
    if (mode !== 'guest' || !deviceIdStr) return;
    if (pickerOpenLoggedRef.current === deviceIdStr) return;
    pickerOpenLoggedRef.current = deviceIdStr;
    const offered = (tab) => buildGuestOptions({
      guestCandidates, deviceAssignments, activeAssignment, activeHeartRateParticipants,
      baseName, baseUserId: guestOptions.topOptions.find((o) => o.isOriginal)?.id ?? null,
      selectedTab: tab, guestProfiles
    }).filteredOptions.map((o) => o.id);
    pickerLogger.info('guest_picker.opened', {
      deviceId: deviceIdStr,
      occupantId: activeAssignment?.occupantId || activeAssignment?.metadata?.profileId || null,
      occupantName: currentLabel,
      baseName,
      unmapped: !baseName,
      topOptions: guestOptions.topOptions.map((o) => o.id),
      friends: offered('friends'),
      family: offered('family'),
      excludedLive: activeHeartRateParticipants.filter((p) => p?.isActive).map((p) => p.id || p.profileId || null),
      candidateCount: guestCandidates.length
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, deviceIdStr]);

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
    // A household member on a borrowed strap is HIMSELF, not a guest: a
    // governance subject, saved with his own flags, earning his own badge.
    const occupantType = option.isPrimary ? 'member' : 'guest';
    pickerLogger.info('guest_picker.selected', {
      deviceId: deviceIdStr,
      from: activeAssignment?.occupantId || activeAssignment?.metadata?.profileId || null,
      to: profileId,
      candidateId: option.id,
      source: option.source || null,
      tab: selectedTab,
      isGeneric: Boolean(option.isGeneric),
      isPrimary: Boolean(option.isPrimary),
      isOriginal: Boolean(option.isOriginal),
      occupantType,
      ageClass: option.ageClass || null,
      baseName
    });
    assignGuestToDevice(deviceIdStr, {
      name,
      profileId,
      candidateId: option.id,
      source: option.source,
      baseUserName: baseName,
      occupantType,
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

  // Music is background for a video that asks for it (the NoMusic label), so
  // the toggle exists only for such a video. Off = setMusicOverride(false),
  // on = clear the override (null); the context never lets "on" start music
  // on any other video (FitnessContext.setMusicOverrideState).
  const musicAllowed = Boolean(fitnessContext?.musicAllowed);
  const musicOn = musicAllowed && fitnessContext?.musicOverride !== false;
  const handleMusicToggle = () => {
    fitnessContext?.setMusicOverride?.(musicOn ? false : null);
    ackSelection('music');
  };

  // Bottom-anchored, priority bottom-up (2026-10-23): the controls a child
  // needs most sit lowest, within reach; Close is the footer below this list.
  // DOM order = visual order, so Up/Down walk it top to bottom.
  const renderSettings = () => (
    <div className="settings-stack">
      <div className="settings-title" aria-hidden="true">Settings</div>
      {activeSessionId && onEndSession && (
        <section className="menu-section" aria-label="Session">
          {endSessionError && <div className="menu-item-subtext fitness-sidebar-end-session-error" role="alert">{endSessionError}</div>}
          <button type="button" className="menu-item action-item danger"
            onClick={() => { setConfirmEndSession(true); ackSelection('end-session'); }}
            disabled={endingSession} aria-label="End current fitness session"
            title="End the current session so it won't auto-merge with the next workout">
            {endingSession ? 'Ending…' : '⏹ End Session'}
          </button>
        </section>
      )}
      <section className="menu-section settings-tools" aria-label="Tools">
        <button type="button" className="menu-item" aria-label="Send feedback" onClick={() => setFeedbackOpen(true)}>
          💬 Feedback
        </button>
        <button type="button" className="menu-item" onClick={handleReloadPage}
          aria-label="Hard-reload the app (bypasses cache)" title="Hard-reload the app — picks up new versions">
          🔄 Reload
        </button>
      </section>
      <div className="settings-divider" role="presentation" />
      <section className="menu-section visibility-controls" aria-label="Workout settings">
        <label className={`menu-item toggle-item${flashingId === 'sidebarCam' ? ' is-ack-flash' : ''}`}>
          <span>📹 Webcam</span>
          <span className="toggle-switch">
            <input type="checkbox" aria-label="Sidebar Webcam" checked={Boolean(visibility.sidebarCam)}
              onChange={() => handleToggle('sidebarCam')} />
            <span className="toggle-slider" />
          </span>
        </label>
        {appMode === 'player' && (
          <div className="menu-item boost-item" role="group" aria-labelledby="settings-video-boost-label">
            <span className="mix-label" id="settings-video-boost-label">Boost</span>
            <div className="volume-boost-controls">
              {[1, 5, 10, 20].map(level => (
                <button key={level} type="button"
                  className={`boost-btn ${boostLevel === level ? 'active' : ''}${flashingId === `boost-${level}` ? ' is-ack-flash' : ''}`}
                  onClick={() => handleBoostSelect(level)} disabled={!videoMediaAvailable}
                  aria-label={`Video boost ${level} times`} aria-pressed={boostLevel === level}>
                  {level}x
                </button>
              ))}
            </div>
          </div>
        )}
        <label className={`menu-item toggle-item${flashingId === 'treasureBox' ? ' is-ack-flash' : ''}`}>
          <span><RingIcon /> Treasure Box</span>
          <span className="toggle-switch">
            <input type="checkbox" aria-label="Treasure Box" checked={Boolean(visibility.treasureBox)}
              onChange={() => handleToggle('treasureBox')} />
            <span className="toggle-slider" />
          </span>
        </label>
        {appMode === 'player' && musicAllowed && (
          <label className={`menu-item toggle-item${flashingId === 'music' ? ' is-ack-flash' : ''}`}>
            <span>🎵 Music</span>
            <span className="toggle-switch">
              <input type="checkbox" aria-label="Background music" checked={musicOn} onChange={handleMusicToggle} />
              <span className="toggle-slider" />
            </span>
          </label>
        )}
      </section>
      {appMode === 'player' && (
        <section className="menu-section" aria-label="Workout audio">
          <div className="menu-item touch-volume-item">
            <div className="mix-label" id="settings-video-volume-label">Video volume</div>
            <TouchVolumeButtons controlId="settings-video-volume" currentLevel={videoDisplayLevel}
              disabled={!videoMediaAvailable} onSelect={handleVideoLevelSelect} />
            {!videoMediaAvailable && <div className="menu-item-subtext">Video player inactive.</div>}
          </div>
        </section>
      )}
      <FeedbackOverlay open={feedbackOpen} app="fitness" onClose={() => { setFeedbackOpen(false); scheduleIdleClose(); }}
        onPauseMusic={onFeedbackPauseMusic} onResumeMusic={onFeedbackResumeMusic} />
    </div>
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

  // Close is focused on open, so a keyboard or gamepad user starts on the
  // most important control and presses Up to reach volume. Programmatic focus
  // is not "keyboard focus": it must not hold the menu open past idle.
  React.useEffect(() => {
    programmaticFocusRef.current = true;
    closeRef.current?.focus?.({ preventScroll: true });
    programmaticFocusRef.current = false;
  }, []);

  // A tap on the menu's own empty background (above the bottom-anchored
  // stack) closes it, like a tap outside the sidebar does (SidebarMenuScrim).
  const handleBackgroundTap = (event) => {
    if (event.target === event.currentTarget) onClose?.();
  };

  const handleRootKeyDown = (event) => {
    rootInteractionHandlers.onKeyDown(event);
    if (feedbackOpenRef.current) return; // the feedback dialog owns its keys
    if (event.key === 'Escape') {
      event.preventDefault();
      if (confirmEndSession) setConfirmEndSession(false);
      else onClose?.();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const neighbour = rowNeighbour(document.activeElement, event.key === 'ArrowLeft' ? -1 : 1);
      if (neighbour) {
        event.preventDefault();
        neighbour.focus();
        // The volume strip steps on Left/Right; boost waits for Enter.
        if (neighbour.closest('.touch-volume')) neighbour.click();
      }
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const stops = menuFocusStops(rootRef.current);
    const target = nextFocusStop(stops, document.activeElement, event.key === 'ArrowUp' ? -1 : 1);
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };
  useGamepadKeys(true, (key) => {
    const root = rootRef.current;
    if (!root) return;
    const active = root.contains(document.activeElement) ? document.activeElement : closeRef.current;
    if (key === 'Enter') { active?.click?.(); return; }
    active?.dispatchEvent?.(new KeyboardEvent('keydown', { key, bubbles: true }));
  });


  return (
    <div
      ref={rootRef}
      className={`fitness-sidebar-menu ${isGuestMode ? 'guest-mode' : 'settings-mode'}`}
      {...rootInteractionHandlers}
      onKeyDown={handleRootKeyDown}
    >
      {isGuestMode && (
        <div className="sidebar-menu-header">
          <h3>Assign Guest</h3>
        </div>
      )}
      <div className="sidebar-menu-content" onClick={handleBackgroundTap}>
        {isGuestMode ? renderGuestAssignment() : renderSettings()}
      </div>
      <div className="sidebar-menu-footer">
        <button ref={closeRef} type="button" className="close-btn"
          aria-label={isGuestMode ? 'Close guest assignment' : 'Close settings'} onClick={onClose}>
          <span>Close</span><span className="close-glyph" aria-hidden="true">✕</span>
        </button>
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
