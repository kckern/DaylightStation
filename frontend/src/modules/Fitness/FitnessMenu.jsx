import React, { useState, useEffect } from 'react';
import { LoadingOverlay, Alert } from '@mantine/core';
import { DaylightAPI } from '../../lib/api.mjs';
import './FitnessMenu.scss';

const FitnessMenu = () => {
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fitnessConfig, setFitnessConfig] = useState(null);

  useEffect(() => {
    const fetchFitnessData = async () => {
      try {
        console.log('🎬 DEBUG: Starting fitness data fetch...');
        
        // First get the fitness config to get the collections
        const configResponse = await DaylightAPI('/api/fitness');
        console.log('🎬 DEBUG: Config response:', JSON.stringify(configResponse, null, 2));
        setFitnessConfig(configResponse.fitness || configResponse);
        
        // Get the collections list (now an array)
        const collections = configResponse.fitness?.plex?.collections || configResponse.plex?.collections;
        console.log('🎬 DEBUG: Collections found:', collections);
        
        if (collections && Array.isArray(collections) && collections.length > 0) {
          // Get the first collection from the ordered list
          const firstCollection = collections[0];
          const activeCollection = firstCollection.id;
          const collectionName = firstCollection.name;
          
          console.log(`🎬 DEBUG: Loading collection: ${collectionName} (${activeCollection})`);
          console.log(`🎬 DEBUG: Making API call to: /media/plex/list/${activeCollection}`);
          
          // Fetch the shows from the collection
          const showsResponse = await DaylightAPI(`/media/plex/list/${activeCollection}`);
          console.log('🎬 DEBUG: Shows response:', JSON.stringify(showsResponse, null, 2));
          console.log('🎬 DEBUG: Shows items:', showsResponse.items);
          console.log('🎬 DEBUG: Shows items length:', showsResponse.items?.length || 0);
          
          setShows(showsResponse.items || []);
        } else {
          console.log('🎬 DEBUG: No collections found in fitness config or collections is not an array');
          setError('No collections found in fitness configuration');
        }
      } catch (err) {
        console.error('🎬 ERROR: Error fetching fitness menu data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchFitnessData();
  }, []);

  if (loading) {
    return (
      <div style={{ position: 'relative', minHeight: '200px' }}>
        <LoadingOverlay visible={true} />
        <Text c="white">Loading fitness shows...</Text>
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

  const collections = fitnessConfig?.plex?.collections;
  const collectionName = (collections && Array.isArray(collections) && collections.length > 0) 
    ? collections[0].name 
    : 'Fitness Shows';

  return (
    <div className="fitness-menu">
      {shows.length > 0 ? (
        <div className="fitness-grid">
          {shows.map((show, index) => (
            <div 
              key={show.plex || index} 
              className="show-card"
            >
              {show.image && (
                <img
                  src={show.image}
                  alt={show.label}
                  className="show-image"
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="no-shows">
          <div className="no-shows-title">No shows found</div>
          <div className="no-shows-text">
            No shows available in the {collectionName} collection
          </div>
        </div>
      )}
    </div>
  );
};

export default FitnessMenu;
