import { useState, useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaDevices' });
  return _logger;
}

/**
 * @param {Object} [options]
 * @param {string} [options.preferredCameraPattern] - Regex pattern to match preferred camera label
 * @param {string} [options.preferredMicPattern] - Regex pattern to match preferred mic label
 */
export const useMediaDevices = (options = {}) => {
  const { preferredCameraPattern, preferredMicPattern } = options;
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState(null);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState(null);

  // Keep patterns in refs so the devicechange handler reads current values
  const cameraPrefRef = useRef(preferredCameraPattern);
  cameraPrefRef.current = preferredCameraPattern;
  const micPrefRef = useRef(preferredMicPattern);
  micPrefRef.current = preferredMicPattern;

  useEffect(() => {
    const getDevices = async () => {
      try {
        // Must call getUserMedia first to grant permissions and get device labels
        // (Android WebView returns empty list from enumerateDevices without this)
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        tempStream.getTracks().forEach(t => t.stop());

        const devicesList = await navigator.mediaDevices.enumerateDevices();
        const vidDevices = devicesList.filter(d => d.kind === "videoinput");
        const audDevices = devicesList.filter(d => d.kind === "audioinput");

        setVideoDevices(vidDevices);
        setAudioDevices(audDevices);

        // Full diagnostics — untruncated IDs, groupIds, and labels
        logger().info('devices-diagnostics', {
          video: vidDevices.map(d => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId })),
          audio: audDevices.map(d => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId })),
          configuredCameraPattern: cameraPrefRef.current || null,
          configuredMicPattern: micPrefRef.current || null,
        });

        // Select camera — config pattern, then first available
        if (vidDevices.length > 0) {
          let camPattern = null;
          try { if (cameraPrefRef.current) camPattern = new RegExp(cameraPrefRef.current, 'i'); } catch { /* invalid regex */ }
          const preferred = camPattern && vidDevices.find(d => camPattern.test(d.label));
          const chosen = preferred || vidDevices[0];
          setSelectedVideoDevice(chosen.deviceId);
          logger().info('video-device-selected', {
            id: chosen.deviceId.slice(0, 8),
            label: chosen.label,
            matchedPattern: !!preferred,
            pattern: cameraPrefRef.current || '(none)',
          });
        }

        // Select mic — config pattern, then hardcoded fallback, then first available
        if (audDevices.length > 0) {
          let micPattern = null;
          try { if (micPrefRef.current) micPattern = new RegExp(micPrefRef.current, 'i'); } catch { /* invalid regex */ }
          const preferred = micPattern
            ? audDevices.find(d => micPattern.test(d.label))
            : audDevices.find(d => /usb audio|angetube|camera/i.test(d.label));
          const chosen = preferred || audDevices[0];
          setSelectedAudioDevice(chosen.deviceId);
          logger().info('audio-device-selected', {
            id: chosen.deviceId.slice(0, 8),
            label: chosen.label,
            matchedPattern: !!preferred,
            pattern: micPrefRef.current || '(default fallback)',
          });
        }
      } catch (error) {
        logger().warn('media-devices.enumerate-error', { error: error.message });
      }
    };

    getDevices();

    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    };
  }, []); // Run once on mount

  // Re-select when config patterns arrive after initial enumeration
  useEffect(() => {
    if (!preferredCameraPattern || videoDevices.length === 0) return;
    try {
      const pattern = new RegExp(preferredCameraPattern, 'i');
      const preferred = videoDevices.find(d => pattern.test(d.label));
      if (preferred && preferred.deviceId !== selectedVideoDevice) {
        setSelectedVideoDevice(preferred.deviceId);
        logger().info('video-device-reselected', {
          id: preferred.deviceId.slice(0, 8),
          label: preferred.label,
          pattern: preferredCameraPattern,
        });
      }
    } catch { /* invalid regex */ }
  }, [preferredCameraPattern, videoDevices]);

  useEffect(() => {
    if (!preferredMicPattern || audioDevices.length === 0) return;
    try {
      const pattern = new RegExp(preferredMicPattern, 'i');
      const preferred = audioDevices.find(d => pattern.test(d.label));
      if (preferred && preferred.deviceId !== selectedAudioDevice) {
        setSelectedAudioDevice(preferred.deviceId);
        logger().info('audio-device-reselected', {
          id: preferred.deviceId.slice(0, 8),
          label: preferred.label,
          pattern: preferredMicPattern,
        });
      }
    } catch { /* invalid regex */ }
  }, [preferredMicPattern, audioDevices]);

  const cycleVideoDevice = (direction = 'next') => {
    if (videoDevices.length <= 1) return;
    const currentIndex = videoDevices.findIndex(d => d.deviceId === selectedVideoDevice);
    if (currentIndex === -1) return;

    let nextIndex;
    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % videoDevices.length;
    } else {
      nextIndex = (currentIndex - 1 + videoDevices.length) % videoDevices.length;
    }
    setSelectedVideoDevice(videoDevices[nextIndex].deviceId);
  };

  const cycleAudioDevice = (direction = 'next') => {
    if (audioDevices.length <= 1) return;
    const currentIndex = audioDevices.findIndex(d => d.deviceId === selectedAudioDevice);
    if (currentIndex === -1) return;

    let nextIndex;
    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % audioDevices.length;
    } else {
      nextIndex = (currentIndex - 1 + audioDevices.length) % audioDevices.length;
    }
    setSelectedAudioDevice(audioDevices[nextIndex].deviceId);
  };

  return {
    videoDevices,
    audioDevices,
    selectedVideoDevice,
    setSelectedVideoDevice,
    selectedAudioDevice,
    setSelectedAudioDevice,
    cycleVideoDevice,
    cycleAudioDevice
  };
};
