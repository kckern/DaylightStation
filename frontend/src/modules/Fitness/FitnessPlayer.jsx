import React, { useState, useEffect } from 'react';
import './FitnessPlayer.scss';
import { useFitness } from '../../context/FitnessContext.jsx';
import Player from '../Player/Player.jsx';

const FitnessPlayer = ({ playQueue, setPlayQueue }) => {
  const [currentItem, setCurrentItem] = useState(null);
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

  return (
    <div className="fitness-player">
      <div className="fitness-player-header">
        <h3>{currentItem.title || currentItem.label}</h3>
        <div className="fitness-player-controls">
          <button onClick={handleNext}>Next</button>
          <button onClick={handleClose}>Close</button>
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
  );
};

export default FitnessPlayer;