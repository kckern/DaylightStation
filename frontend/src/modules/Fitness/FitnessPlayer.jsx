import React, { useState, useEffect } from 'react';
import './FitnessPlayer.scss';
import { useFitness } from '../../context/FitnessContext.jsx';

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
      setCurrentItem(queue[0]);
    }
  }, [queue, currentItem]);

  const handleClose = () => {
    if (setQueue) {
      setQueue([]);
    }
    setCurrentItem(null);
  };

  const handleNext = () => {
    const currentIndex = queue.findIndex(item => item.id === currentItem?.id);
    if (currentIndex < queue.length - 1) {
      setCurrentItem(queue[currentIndex + 1]);
    } else {
      // End of queue
      handleClose();
    }
  };

  if (!currentItem) return null;

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
        {/* Display video or other content here */}
        {currentItem.videoUrl && (
          <video 
            src={currentItem.videoUrl} 
            controls 
            autoPlay
            onEnded={handleNext}
            onError={(e) => {
              console.error('🎬 Video error:', e);
              // Optionally show an error message or try to recover
            }}
            className="fitness-player-video"
          />
        )}
      </div>
    </div>
  );
};

export default FitnessPlayer;