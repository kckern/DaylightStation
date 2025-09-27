import React, { useState, useEffect } from 'react';
import './FitnessPlayer.scss';
import { useFitness } from '../../context/FitnessContext.jsx';
import Player from '../Player/Player.jsx';

// Helper function to format time in MM:SS or HH:MM:SS format
const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '00:00';
  
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const FitnessPlayer = ({ playQueue, setPlayQueue }) => {
  const [currentItem, setCurrentItem] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const { fitnessPlayQueue, setFitnessPlayQueue } = useFitness() || {};
  
  // Use props if provided, otherwise fall back to context
  const queue = playQueue || fitnessPlayQueue || [];
  const setQueue = setPlayQueue || setFitnessPlayQueue;
  
  console.log('🎬 FitnessPlayer: Queue state:', { 
    propsQueue: playQueue, 
    contextQueue: fitnessPlayQueue, 
    resolvedQueue: queue, 
    currentItem 
  });
  
  useEffect(() => {
    console.log('🎬 FitnessPlayer useEffect: Queue length:', queue.length, 'Current item:', currentItem);
    // Queue initialization logic
    if (queue.length > 0 && !currentItem) {
      console.log('🎬 FitnessPlayer: Setting current item to first in queue:', queue[0]);
      // Prepare the media item with proper URL structure
      const firstItem = queue[0];
      // Ensure the video URL is properly formatted
      if (firstItem && !firstItem.media_url && firstItem.videoUrl) {
        firstItem.media_url = firstItem.videoUrl;
      }
      setCurrentItem(firstItem);
    }
    
    // No need to track progress if there's no current item
    if (!currentItem) return;
    
    // Progress tracking logic
    const updateVideoProgress = () => {
      const mediaElement = document.querySelector('.fitness-player-content video') || 
                          document.querySelector('.fitness-player-content dash-video') ||
                          document.querySelector('.fitness-player-content .video-element');
      
      if (mediaElement) {
        setCurrentTime(mediaElement.currentTime || 0);
        if (mediaElement.duration && !isNaN(mediaElement.duration)) {
          setDuration(mediaElement.duration || 0);
        }
      }
    };
    
    // Update every second
    const interval = setInterval(updateVideoProgress, 1000);
    
    // Call once immediately to initialize
    updateVideoProgress();
    
    // Clean up the interval when the component unmounts or currentItem changes
    return () => clearInterval(interval);
  }, [queue, currentItem]);

  const handleClose = () => {
    console.log('🎬 FitnessPlayer: Closing player');
    if (setQueue) {
      setQueue([]);
    }
    setCurrentItem(null);
  };

  const handleNext = () => {
    console.log('🎬 FitnessPlayer: Next item requested');
    const currentIndex = queue.findIndex(item => item.id === currentItem?.id);
    if (currentIndex < queue.length - 1) {
      const nextItem = queue[currentIndex + 1];
      // Ensure the video URL is properly formatted
      if (nextItem && !nextItem.media_url && nextItem.videoUrl) {
        nextItem.media_url = nextItem.videoUrl;
      }
      console.log('🎬 FitnessPlayer: Moving to next item:', nextItem);
      setCurrentItem(nextItem);
    } else {
      // End of queue
      console.log('🎬 FitnessPlayer: End of queue reached');
      handleClose();
    }
  };

  if (!currentItem) return null;

  // Prepare additional metadata that might be useful for the Player
  const enhancedCurrentItem = {
    ...currentItem,
    plex: currentItem.id || currentItem.plex,
    media_url: currentItem.media_url || currentItem.videoUrl,
    title: currentItem.title || currentItem.label,
    media_type: 'video',
    type: 'video',
    media_key: currentItem.id || `fitness-${Date.now()}`,
    // Additional properties that might help the Player component
    show: currentItem.show || 'Fitness',
    season: currentItem.season || 'Workout',
    percent: 0, // Start from beginning
    seconds: 0, // Start from beginning
    continuous: false // Don't loop videos
  };
  
  console.log('🎬 FitnessPlayer: Enhanced item for Player:', enhancedCurrentItem);
  
  // Track current time and duration will be handled in the first useEffect

  // Function to handle seeking to a specific point in the video
  const handleSeek = (seconds) => {
    console.log(`🎬 FitnessPlayer: Seeking to ${seconds} seconds`);
    // Access the media element directly
    const mediaElement = document.querySelector('.fitness-player-content video') || 
                          document.querySelector('.fitness-player-content dash-video') ||
                          document.querySelector('.fitness-player-content .video-element');
    
    if (mediaElement) {
      // Set the currentTime property to seek to the specified position
      mediaElement.currentTime = seconds;
      console.log(`🎬 FitnessPlayer: Seek executed to ${seconds} seconds`);
    } else {
      console.error('🎬 FitnessPlayer: Could not find video element to seek');
    }
  };

  // Create 10 seek buttons at different intervals
  const generateSeekButtons = () => {
    const buttons = [];
    // Use a default of 10 minutes if no duration is available
    // Try to get duration from various possible sources
    const totalDuration = currentItem.duration || 
                          currentItem.length || 
                          (currentItem.metadata && currentItem.metadata.duration) || 
                          600;
    
    // Create a button to go back to the beginning
    buttons.push(
      <button 
        key="seek-start" 
        className="seek-button"
        onClick={() => handleSeek(0)}
      >
        Start
      </button>
    );
    
    // Create 8 evenly spaced seek buttons
    for (let i = 1; i <= 8; i++) {
      // Calculate position as a percentage of the total duration
      const position = Math.floor((i / 9) * totalDuration);
      const minutes = Math.floor(position / 60);
      const seconds = position % 60;
      const label = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      
      buttons.push(
        <button 
          key={`seek-${i}`} 
          className="seek-button"
          onClick={() => handleSeek(position)}
          title={`Jump to ${minutes} min ${seconds} sec`}
        >
          {label}
        </button>
      );
    }
    
    // Create a button to jump to near the end (95%)
    const endPosition = Math.floor(totalDuration * 0.95);
    const endMinutes = Math.floor(endPosition / 60);
    const endSeconds = endPosition % 60;
    
    buttons.push(
      <button 
        key="seek-end" 
        className="seek-button"
        onClick={() => handleSeek(endPosition)}
      >
        {`${endMinutes}:${endSeconds.toString().padStart(2, '0')}`}
      </button>
    );
    
    return buttons;
  };

  return (
    <div className="fitness-player">
      <div className="fitness-player-header">
        <h3>{currentItem.title || currentItem.label}</h3>
        <div className="fitness-player-controls">
          <button onClick={handleNext}>Next</button>
          <button onClick={handleClose}>Close</button>
        </div>
      </div>
      
      <div className="fitness-player-main">
        <div className="fitness-player-sidebar">
          <h4>Workout Details</h4>
          <div className="sidebar-placeholder">
            {currentItem.description && (
              <div className="workout-description">
                <h5>Description</h5>
                <p>{currentItem.description}</p>
              </div>
            )}
            
            <div className="workout-details">
              <h5>Information</h5>
              <ul>
                <li><span>Type:</span> {currentItem.type || currentItem.show || 'Workout'}</li>
                <li><span>Duration:</span> {formatTime(currentItem.duration || duration || 600)}</li>
                <li><span>Instructor:</span> {currentItem.instructor || currentItem.author || 'Unknown'}</li>
                <li><span>Difficulty:</span> {currentItem.difficulty || 'Intermediate'}</li>
                <li><span>Equipment:</span> {currentItem.equipment || 'Basic'}</li>
              </ul>
            </div>
            
            <div className="queue-info">
              <h5>Queue</h5>
              <p>{queue.length} item{queue.length !== 1 ? 's' : ''} in queue</p>
              <p>Currently playing {queue.findIndex(item => item.id === currentItem?.id) + 1} of {queue.length}</p>
            </div>
          </div>
        </div>
        
        <div className="fitness-player-content">
          <Player 
            key={enhancedCurrentItem.media_key || enhancedCurrentItem.plex || Date.now()}
            play={{
              plex: enhancedCurrentItem.plex,
              media_url: enhancedCurrentItem.media_url,
              media_type: 'video',
              media_key: enhancedCurrentItem.media_key,
              title: enhancedCurrentItem.title,
              shader: 'regular',
              volume: currentItem.volume || 1.0,
              playbackRate: currentItem.playbackRate || 1.0,
              type: 'video',
              continuous: false
            }}
            clear={handleClose}
            advance={handleNext}
            playerType="fitness-video"
          />
        </div>
      </div>
      
      <div className="fitness-player-footer">
        <div className="player-time-info">
          {formatTime(currentTime)} / {formatTime(duration || (currentItem.duration || 600))}
        </div>
        <div className="progress-bar" onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const percent = clickX / rect.width;
          const seekTime = percent * (duration || currentItem.duration || 600);
          handleSeek(seekTime);
        }}>
          <div className="progress" style={{ width: `${((currentTime / (duration || currentItem.duration || 600)) * 100)}%` }}></div>
        </div>
        <div className="seek-buttons">
          {generateSeekButtons()}
        </div>
      </div>
    </div>
  );
};

export default FitnessPlayer;