import { useState, useEffect } from 'react';

export const useMediaDevices = () => {
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState(null);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState(null);

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

        // Set defaults if not already set — prefer the webcam's mic over built-in
        if (vidDevices.length > 0 && !selectedVideoDevice) {
          setSelectedVideoDevice(vidDevices[0].deviceId);
        }
        if (audDevices.length > 0 && !selectedAudioDevice) {
          const webcamMic = audDevices.find(d => /usb audio|angetube|camera/i.test(d.label));
          setSelectedAudioDevice((webcamMic || audDevices[0]).deviceId);
        }
      } catch (error) {
        console.error("Error enumerating devices:", error);
      }
    };
    
    getDevices();
    
    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    };
  }, []); // Run once on mount

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
