import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MantineProvider, Paper, Title, Group, Text, Alert, Grid } from '@mantine/core';
import '@mantine/core/styles.css';
import "./FitnessApp.scss";
import { DaylightAPI } from '../lib/api.mjs';
import FitnessUsers from '../modules/Fitness/FitnessUsers.jsx';
import FitnessMenu from '../modules/Fitness/FitnessMenu.jsx';
import FitnessSidebar from '../modules/Fitness/FitnessSidebar.jsx';
import FitnessShow from '../modules/Fitness/FitnessShow.jsx';

const FitnessApp = () => {
  const [fitnessMessage, setFitnessMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('menu'); // 'menu', 'users', 'show'
  const [activeCollection, setActiveCollection] = useState(null);
  const [selectedShow, setSelectedShow] = useState(null);
  const viewportRef = useRef(null);
  
  // Derive collections from the API response
  const collections = useMemo(() => {
    const src =
      fitnessMessage?.fitness?.plex?.collections ||
      fitnessMessage?.plex?.collections ||
      [];
    return Array.isArray(src) ? src : [];
  }, [fitnessMessage]);

  const handleContentSelect = (category, value) => {
    console.log('📱 FitnessApp: Content selected:', { category, value });
    
    switch (category) {
      case 'collection':
        const id = typeof value === 'object' && value !== null ? value.id : value;
        setActiveCollection(id);
        setCurrentView('menu');
        setSelectedShow(null);
        break;
        
      case 'show':
        setSelectedShow(value.plex);
        setCurrentView('show');
        break;
        
      case 'users':
        setCurrentView('users');
        break;
        
      default:
        console.warn('Unknown content category:', category);
    }
  };

  const handleBackToMenu = () => {
    setCurrentView('menu'); // Switch back to menu view
    setSelectedShow(null);
  };

  useEffect(() => {
    const fetchFitnessData = async () => {
      try {
        const response = await DaylightAPI('/api/fitness');
        setFitnessMessage(response);
      } catch (error) {
        console.error('Error fetching fitness data:', error);
        setFitnessMessage({ message: 'Error loading fitness data', status: 'error' });
      } finally {
        setLoading(false);
      }
    };

    fetchFitnessData();
  }, []);

  // Initialize the active collection once collections arrive
  useEffect(() => {
    if (!activeCollection && collections.length > 0) {
      setActiveCollection(collections[0].id);
    }
  }, [collections, activeCollection]);

  return (
    <MantineProvider theme={{ colorScheme: 'dark' }}>
      <div className="fitness-app-container">
        <div className="fitness-app-viewport" style={{ position: 'relative' }} ref={viewportRef}>
          <FitnessSidebar 
            collections={collections}
            activeCollection={activeCollection}
            onContentSelect={handleContentSelect}
          />
          <div className="fitness-main-content">
            {currentView === 'users' && (
              <FitnessUsers />
            )}
            {currentView === 'show' && selectedShow && (
              <FitnessShow 
                showId={selectedShow} 
                onBack={handleBackToMenu}
                viewportRef={viewportRef}
              />
            )}
            {currentView === 'menu' && (
              <FitnessMenu 
                collections={collections} 
                activeCollection={activeCollection} 
                onContentSelect={handleContentSelect}
              />
            )}
          </div>
        </div>
      </div>
    </MantineProvider>
  );
};

export default FitnessApp;
