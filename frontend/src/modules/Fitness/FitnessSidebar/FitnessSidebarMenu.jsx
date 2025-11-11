import React from 'react';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import '../FitnessUsers.scss';

const slugifyId = (value, fallback = 'user') => {
  if (!value) return fallback;
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
};

const FitnessSidebarMenu = ({
  onClose,
  visibility,
  onToggleVisibility,
  selectedPlaylistId,
  onPlaylistChange,
  mode = 'settings',
  targetDeviceId,
  targetDefaultName,
  guestAssignments = {},
  assignGuestToDevice,
  clearGuestAssignment,
  guestCandidates = [],
  playerRef,
  onReloadVideo,
  reloadTargetSeconds = 0,
  preferredMicrophoneId = '',
  onSelectMicrophone
}) => {
  const fitnessContext = useFitnessContext();
  const [selectedTab, setSelectedTab] = React.useState('friends');
  const playlists = fitnessContext?.plexConfig?.music_playlists || [];
  const deviceIdStr = targetDeviceId ? String(targetDeviceId) : null;
  const activeAssignment = deviceIdStr ? guestAssignments[deviceIdStr] : null;
  const baseUser = deviceIdStr ? fitnessContext?.getUserByDevice?.(deviceIdStr) : null;
  const baseName = activeAssignment?.baseUserName || targetDefaultName || baseUser?.name || null;
  const monitorLabel = deviceIdStr ? `#${deviceIdStr}` : 'Unknown';
  const currentLabel = activeAssignment?.name || baseName || 'Unassigned';
  const currentSummaryClass = `guest-summary-value${activeAssignment ? ' guest-summary-value--active' : ''}`;
  const [videoVolume, setVideoVolume] = React.useState(() => {
    const media = playerRef?.current?.getMediaElement?.();
    if (media && typeof media.volume === 'number') {
      return media.volume;
    }
    return 1;
  });
  const [microphones, setMicrophones] = React.useState([]);
  const [microphonesLoading, setMicrophonesLoading] = React.useState(false);
  const [microphoneError, setMicrophoneError] = React.useState(null);

  const clampVolume = React.useCallback((value) => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }, []);

  const videoMediaAvailable = Boolean(playerRef?.current?.getMediaElement?.());

  React.useEffect(() => {
    const media = playerRef?.current?.getMediaElement?.();
    if (!media || typeof media.volume !== 'number') {
      return undefined;
    }
    const syncVolume = () => {
      setVideoVolume(media.volume ?? 1);
    };
    syncVolume();
    media.addEventListener('volumechange', syncVolume);
    return () => {
      media.removeEventListener('volumechange', syncVolume);
    };
  }, [playerRef]);

  const handleVideoVolumeChange = (event) => {
    const next = clampVolume(parseFloat(event.target.value));
    setVideoVolume(next);
    const media = playerRef?.current?.getMediaElement?.();
    if (media && typeof media.volume === 'number') {
      media.volume = next;
    }
  };

  const enumerateMicrophones = React.useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setMicrophoneError('Device enumeration not supported in this browser.');
      setMicrophones([]);
      return;
    }
    try {
      setMicrophonesLoading(true);
      setMicrophoneError(null);
      const devices = await navigator.mediaDevices.enumerateDevices();
      const seen = new Set();
      const micList = [];
      devices.forEach((device, index) => {
        if (device.kind !== 'audioinput') return;
        const id = device.deviceId && device.deviceId.length ? device.deviceId : 'default';
        if (id === 'default') return;
        if (seen.has(id)) return;
        seen.add(id);
        const label = device.label && device.label.length
          ? device.label
          : `Microphone ${micList.length + 1}`;
        micList.push({ id, label });
      });
      setMicrophones(micList);
    } catch (err) {
      console.error('Failed to enumerate microphones', err);
      setMicrophones([]);
      setMicrophoneError(err?.message || 'Failed to list microphones.');
    } finally {
      setMicrophonesLoading(false);
    }
  }, []);

  React.useEffect(() => {
    enumerateMicrophones();
  }, [enumerateMicrophones]);

  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return undefined;
    const mediaDevices = navigator.mediaDevices;
    const handleDeviceChange = () => {
      enumerateMicrophones();
    };
    if (mediaDevices.addEventListener) {
      mediaDevices.addEventListener('devicechange', handleDeviceChange);
      return () => {
        mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      };
    }
    const originalHandler = mediaDevices.ondevicechange;
    mediaDevices.ondevicechange = handleDeviceChange;
    return () => {
      if (mediaDevices.ondevicechange === handleDeviceChange) {
        mediaDevices.ondevicechange = originalHandler || null;
      }
    };
  }, [enumerateMicrophones]);

  const effectiveMicrophones = React.useMemo(() => {
    const seen = new Set();
    const deduped = [];
    microphones.forEach((mic) => {
      if (!mic?.id) return;
      if (seen.has(mic.id)) return;
      seen.add(mic.id);
      deduped.push(mic);
    });
    if (preferredMicrophoneId && !seen.has(preferredMicrophoneId)) {
      deduped.push({ id: preferredMicrophoneId, label: 'Previously selected (unavailable)' });
    }
    return deduped;
  }, [microphones, preferredMicrophoneId]);

  const handleMicrophoneChange = (event) => {
    const next = event.target.value;
    if (onSelectMicrophone) {
      onSelectMicrophone(next);
    }
  };

  const handleRefreshMicrophones = () => {
    enumerateMicrophones();
  };

  const handleReloadPage = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
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
  const volumePercent = Math.round(clampVolume(videoVolume) * 100);

  const guestOptions = React.useMemo(() => {
    const seen = new Set();
    const topOptions = [];
    
    // Track the currently selected user to exclude them from the list
    const currentlySelectedId = activeAssignment?.candidateId || activeAssignment?.profileId;
    if (currentlySelectedId) {
      seen.add(currentlySelectedId);
    }
    
    // Exclude users already assigned to OTHER devices (not the current one)
    Object.entries(guestAssignments).forEach(([assignedDeviceId, assignment]) => {
      // Skip the current device we're editing
      if (assignedDeviceId === deviceIdStr) return;
      
      // Mark this user as unavailable
      if (assignment?.candidateId) {
        seen.add(assignment.candidateId);
      }
      if (assignment?.profileId) {
        seen.add(assignment.profileId);
      }
      // Also block by name to catch edge cases
      if (assignment?.name) {
        seen.add(slugifyId(assignment.name));
      }
    });
    
    // Add original owner as first option if a guest is currently assigned
    if (activeAssignment && baseName && activeAssignment.name !== baseName) {
      const baseId = slugifyId(baseName);
      if (!seen.has(baseId)) {
        seen.add(baseId);
        topOptions.push({
          id: baseId,
          name: baseName,
          profileId: slugifyId(baseName),
          source: 'Original',
          isOriginal: true
        });
      }
    }
    
    // Add generic guest at the top (unless it's currently selected)
    if (!seen.has('guest')) {
      seen.add('guest');
      topOptions.push({ id: 'guest', name: 'Guest', profileId: 'guest', source: 'Guest', isGeneric: true });
    }
    
    // Filter candidates based on selected tab
    const filteredCandidates = guestCandidates.filter((candidate) => {
      if (!candidate || !candidate.name) return false;
      const category = (candidate.category || '').toLowerCase();
      if (selectedTab === 'friends') {
        return category === 'friend';
      } else if (selectedTab === 'family') {
        return category === 'family';
      }
      return false;
    });
    
    // Separate candidates with and without avatars
    const withAvatars = [];
    const withoutAvatars = [];
    
    filteredCandidates.forEach((candidate) => {
      const id = candidate.id || slugifyId(candidate.name);
      if (seen.has(id)) return;
      seen.add(id);
      
      const option = {
        id,
        name: candidate.name,
        profileId: candidate.id || slugifyId(candidate.name),
        source: candidate.source || candidate.category || candidate.group || candidate.group_label || candidate.type || null,
        hasAvatar: true // We'll determine this during render
      };
      
      // Put in withAvatars for now, will be sorted during render
      withAvatars.push(option);
    });
    
    return {
      topOptions,
      filteredOptions: [...withAvatars, ...withoutAvatars]
    };
  }, [guestCandidates, activeAssignment, baseName, deviceIdStr, selectedTab, guestAssignments]);

  // Auto-switch to Family tab if Friends tab is empty or all used up
  React.useEffect(() => {
    if (selectedTab === 'friends' && guestOptions.filteredOptions.length === 0) {
      setSelectedTab('family');
    }
  }, [selectedTab, guestOptions.filteredOptions.length]);

  const handleToggle = (component) => {
    onToggleVisibility(component);
  };

  const handlePlaylistChange = (e) => {
    const playlistId = e.target.value;
    if (onPlaylistChange) {
      onPlaylistChange(playlistId || null);
    }
  };

  const handleAssignGuest = (option) => {
    if (!assignGuestToDevice || !deviceIdStr) return;
    assignGuestToDevice(deviceIdStr, {
      name: option.name,
      profileId: option.profileId,
      candidateId: option.id,
      source: option.source,
      baseUserName: baseName
    });
    if (onClose) onClose();
  };

  const handleClearGuest = () => {
    if (!deviceIdStr || !clearGuestAssignment) return;
    clearGuestAssignment(deviceIdStr);
    if (onClose) onClose();
  };

  const renderSettings = () => (
    <>
      <div className="menu-section">
        <div className="menu-item toggle-item">
          <span>💰 Treasure Box</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={visibility.treasureBox}
              onChange={() => handleToggle('treasureBox')}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div className="menu-item toggle-item">
          <span>🏁 Race Chart</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={visibility.raceChart}
              onChange={() => handleToggle('raceChart')}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div className="menu-item toggle-item">
          <span>🎵 Playlist</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={visibility.playlist}
              onChange={() => handleToggle('playlist')}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        {visibility.playlist && playlists.length > 0 && (
          <div className="menu-item playlist-dropdown">
            <select 
              value={selectedPlaylistId || ''} 
              onChange={handlePlaylistChange}
              className="playlist-select"
            >
              <option value="">Select a playlist...</option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {playlist.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="menu-section">
        <h4>Video Controls</h4>
        <div className="menu-item slider-item" role="group" aria-label="Video volume">
          <div className="slider-label">
            <span>Video Volume</span>
            <span className="slider-value">{`${volumePercent}%`}</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={videoVolume}
            onChange={handleVideoVolumeChange}
            disabled={!videoMediaAvailable}
          />
          {!videoMediaAvailable && (
            <div className="menu-item-subtext">Video player inactive.</div>
          )}
        </div>
      </div>

      <div className="menu-section">
        <h4>Quick Actions</h4>
        <button type="button" className="menu-item action-item" onClick={handleReloadPage}>
          <span>🔄 Reload Page</span>
        </button>
        <button
          type="button"
          className="menu-item action-item"
          onClick={handleReloadVideo}
          disabled={!onReloadVideo || !videoMediaAvailable}
        >
          <span>↺ Reload Video ({reloadLabel})</span>
        </button>
      </div>

      <div className="menu-section">
        <h4>Microphone</h4>
        <div className="menu-item mic-select" role="group" aria-label="Microphone selection">
          <label htmlFor="microphone-select">Input Source</label>
          <div className="mic-select-row">
            <select
              id="microphone-select"
              value={preferredMicrophoneId}
              onChange={handleMicrophoneChange}
              disabled={microphonesLoading && effectiveMicrophones.length === 0}
            >
              <option value="">Use browser default</option>
              {effectiveMicrophones.map((mic) => (
                <option key={`${mic.id}-${mic.label}`} value={mic.id}>
                  {mic.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="mic-refresh-btn"
              onClick={handleRefreshMicrophones}
              title="Refresh device list"
            >
              ↻
            </button>
          </div>
          {microphonesLoading && (
            <div className="menu-item-subtext loading">Scanning for microphones…</div>
          )}
          {microphoneError && (
            <div className="menu-item-subtext error">{microphoneError}</div>
          )}
        </div>
      </div>
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
              src={DaylightMediaPath(`/media/img/users/${option.profileId}`)}
              alt={`${option.name} avatar`}
              data-generic={option.isGeneric ? '1' : undefined}
              onLoad={(e) => {
                if (e.target.dataset.generic === '1') return;
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
                e.target.src = DaylightMediaPath('/media/img/users/user');
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
          <div className="menu-section">
            {guestOptions.filteredOptions.map(renderOption)}
          </div>
        )}
      </div>
    );
  };

  const isGuestMode = mode === 'guest';

  return (
    <div className={`fitness-sidebar-menu ${isGuestMode ? 'guest-mode' : ''}`}>
      <div className="sidebar-menu-header">
        <h3>{isGuestMode ? 'Assign Guest' : 'Settings'}</h3>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="sidebar-menu-content">
        {isGuestMode ? renderGuestAssignment() : renderSettings()}
      </div>
    </div>
  );
};

export default FitnessSidebarMenu;
