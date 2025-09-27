import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MantineProvider, Paper, Title, Group, Text, Alert, Grid } from '@mantine/core';
import '@mantine/core/styles.css';
import "./FitnessApp.scss";
import { DaylightAPI } from '../lib/api.mjs';
import FitnessUsers from '../modules/Fitness/FitnessUsers.jsx';
import FitnessMenu from '../modules/Fitness/FitnessMenu.jsx';
import FitnessSidebar from '../modules/Fitness/FitnessSidebar.jsx';
import FitnessShow from '../modules/Fitness/FitnessShow.jsx';
import { FitnessProvider } from '../context/FitnessContext.jsx';

const FitnessApp = () => {
  // Start with default configuration that includes HR colors and equipment to avoid null mapping
  const [fitnessConfiguration, setFitnessConfiguration] = useState({
    fitness: {
      ant_devices: {
        hr: {
          "28812": "red",
          "28688": "yellow",
          "28676": "green",
          "29413": "blue",
          "40475": "watch"
        },
        cadence: {
          "49904": "orange"
        }
      },
      equipment: [
        {
          name: "CycleAce",
          id: "cycle_ace",
          type: "stationary_bike",
          cadence: "49904",
          speed: null
        }
      ]
    }
  });
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('menu'); // 'menu', 'users', 'show'
  const [activeCollection, setActiveCollection] = useState(null);
  const [selectedShow, setSelectedShow] = useState(null);
  const viewportRef = useRef(null);
  
  // Derive collections from the API response
  const collections = useMemo(() => {
    const src =
      fitnessConfiguration?.fitness?.plex?.collections ||
      fitnessConfiguration?.plex?.collections ||
      [];
    return Array.isArray(src) ? src : [];
  }, [fitnessConfiguration]);

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
        console.log('Fetched fitness configuration:', response);
        console.log('Equipment configuration:', response?.fitness?.equipment);
        
        // Preserve hardcoded equipment configuration if not present in API response
        if (!response?.fitness?.equipment) {
          response.fitness = {
            ...response.fitness,
            equipment: fitnessConfiguration.fitness.equipment
          };
          console.log('Using hardcoded equipment configuration');
        }
        
        setFitnessConfiguration(response);
      } catch (error) {
        console.error('Error fetching fitness data:', error);
        setFitnessConfiguration({ message: 'Error loading fitness data', status: 'error' });
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
      <FitnessProvider fitnessConfiguration={fitnessConfiguration}>
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
      </FitnessProvider>
    </MantineProvider>
  );
};

export default FitnessApp;
