import React, { useEffect } from 'react';
import { useMediaDevices } from '../Input/hooks/useMediaDevices';
import { useWebcamStream } from '../Input/hooks/useWebcamStream';
import { useVolumeMeter } from '../Input/hooks/useVolumeMeter';
import './FitnessCamStage.scss';

const FitnessCamStage = ({ onOpenSettings }) => {
  const {
    videoDevices,
    audioDevices,
    selectedVideoDevice,
    selectedAudioDevice,
    cycleVideoDevice,
    cycleAudioDevice
  } = useMediaDevices();

  const { videoRef, error: videoError } = useWebcamStream(selectedVideoDevice, selectedAudioDevice);
  const { volume } = useVolumeMeter(selectedAudioDevice);

  // Keyboard shortcuts for device switching
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Only handle if not typing in an input
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

      if (event.key === 'c' || event.key === 'C') {
        cycleVideoDevice('next');
      } else if (event.key === 'm' || event.key === 'M') {
        cycleAudioDevice('next');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cycleVideoDevice, cycleAudioDevice]);

  const volumePercentage = Math.min(volume * 1000, 100);

  return (
    <div className="fitness-cam-stage">
      <div className="video-container">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="webcam-video"
        />
        {videoError && (
          <div className="video-error">
            Camera Error: {videoError.message}
          </div>
        )}
      </div>
      <button 
        className="fitness-cam-settings-btn"
        onClick={(e) => {
          e.stopPropagation();
          onOpenSettings?.();
        }}
      >
        ...
      </button>
    </div>
  );
};

export default FitnessCamStage;
