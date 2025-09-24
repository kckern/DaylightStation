import React, { useState, useEffect } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import './FitnessSidebar.scss';

const FitnessSidebar = ({ activeCollection, onCollectionChange }) => {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCollections = async () => {
      try {
        const response = await DaylightAPI('/api/fitness');
        const fitnessCollections = response.fitness?.plex?.collections || response.plex?.collections || [];
        setCollections(fitnessCollections);
      } catch (error) {
        console.error('Error fetching fitness collections:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCollections();
  }, []);

  const getCollectionIcon = (name) => {
    switch (name.toLowerCase()) {
      case 'favorites':
        return '⭐';
      case 'kids':
        return '👶';
      case 'cardio':
        return '❤️';
      default:
        return '📺';
    }
  };

  return (
    <div className="fitness-sidebar">
      <div className="sidebar-header">
        
      </div>
      
      <nav className="sidebar-nav">
        {loading ? (
          <div className="loading-state">
            <div className="loading-icon">⏳</div>
          </div>
        ) : (
          collections.map((collection, index) => (
            <button
              key={collection.id || index}
              className={`nav-item ${activeCollection === collection.id ? 'active' : ''}`}
              onClick={() => onCollectionChange && onCollectionChange(collection)}
            >
              <div className="nav-icon">{getCollectionIcon(collection.name)}</div>
              <span className="nav-label">{collection.name}</span>
            </button>
          ))
        )}
      </nav>
      
    </div>
  );
};

export default FitnessSidebar;