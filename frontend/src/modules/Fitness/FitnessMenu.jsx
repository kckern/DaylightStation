import React, { useState, useEffect, useMemo } from 'react';
import { LoadingOverlay, Alert, Text } from '@mantine/core';
import { DaylightAPI } from '../../lib/api.mjs';
import './FitnessMenu.scss';

const FitnessMenu = ({ activeCollection, onContentSelect, setFitnessPlayQueue }) => {
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fitnessConfig, setFitnessConfig] = useState(null);
  const [selectedCollection, setSelectedCollection] = useState(null);

  const collectionsFromConfig = useMemo(() => {
    if (!fitnessConfig) return [];
    const col = fitnessConfig.plex?.collections;
    return Array.isArray(col) ? col : [];
  }, [fitnessConfig]);

  useEffect(() => {
    const fetchFitnessData = async () => {
      try {
        console.log('🎬 DEBUG: Starting fitness data fetch...');
        
        // First get the fitness config to get the collections
        const configResponse = await DaylightAPI('/api/fitness');
        console.log('🎬 DEBUG: Config response:', JSON.stringify(configResponse, null, 2));
        setFitnessConfig(configResponse.fitness || configResponse);
        // Defer show loading to the effect below
      } catch (err) {
        console.error('🎬 ERROR: Error fetching fitness menu data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchFitnessData();
  }, []);

  // Fetch shows when collection selection or config changes
  useEffect(() => {
    const loadShows = async () => {
      try {
        if (!collectionsFromConfig.length) return;

        const collectionToUse = activeCollection
          ? collectionsFromConfig.find(c => String(c.id) === String(activeCollection)) || collectionsFromConfig[0]
          : collectionsFromConfig[0];

        if (!collectionToUse) return;
        setSelectedCollection(collectionToUse);

        const collectionId = collectionToUse.id;
        console.log(`🎬 DEBUG: Making API call to: /media/plex/list/${collectionId}`);
        const showsResponse = await DaylightAPI(`/media/plex/list/${collectionId}`);
        console.log('🎬 DEBUG: Shows response:', JSON.stringify(showsResponse, null, 2));
        setShows(showsResponse.items || []);
      } catch (err) {
        console.error('🎬 ERROR: Error loading shows:', err);
        setError(err.message);
      }
    };

    loadShows();
  }, [activeCollection, collectionsFromConfig]);

  if (loading) {
    return (
      <div style={{ position: 'relative', height:"100%", width:"100%" }}>
        <LoadingOverlay visible={true} />
      </div>
    );
  }

  if (error) {
    return (
      <Alert color="red">
        <Text c="white">Error loading fitness shows: {error}</Text>
      </Alert>
    );
  }

  const collectionName = selectedCollection?.name || 'Fitness Shows';

  const handleShowClick = (show) => {
    console.log('🎬 Show selected:', show);
    if (onContentSelect) {
      onContentSelect('show', show);
    }
  };
  
  const handleAddToQueue = (event, show) => {
    event.stopPropagation(); // Prevent triggering the show click
    console.log('🎬 Adding to queue:', show);
    if (setFitnessPlayQueue) {
      setFitnessPlayQueue(prevQueue => [...prevQueue, {
        id: show.plex || show.id,
        title: show.label,
        videoUrl: show.url || show.videoUrl
      }]);
    }
  };

  return (
    <div className="fitness-menu">
      {shows.length > 0 ? (
        <div className="fitness-grid">
          {shows
            // sort by show.rating DESC
            .sort((a, b) => (b.rating || 0) - (a.rating || 0))
            .map((show, index) => (
              <div 
                key={show.plex || index} 
                className="show-card"
                onClick={() => handleShowClick(show)}
              >
                {show.image && (
                  <img
                    src={show.image}
                    alt={show.label}
                    className="show-image"
                  />
                )}
                {setFitnessPlayQueue && (
                  <button 
                    className="add-to-queue-btn" 
                    onClick={(e) => handleAddToQueue(e, show)}
                    title="Add to play queue"
                  >
                    +
                  </button>
                )}
              </div>
            ))}
        </div>
      ) : (
        <div className="no-shows">
          <div className="no-shows-title">No shows found</div>
          {collectionName && (
            <div className="no-shows-text">
              No shows available in the {collectionName} collection
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FitnessMenu;
