import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MantineProvider, Paper, Title, Group, Text, Alert, Grid } from '@mantine/core';
import '@mantine/core/styles.css';
import "./FitnessApp.scss";
import { DaylightAPI } from '../lib/api.mjs';
import FitnessUsers from '../modules/Fitness/FitnessUsers.jsx';
import FitnessMenu from '../modules/Fitness/FitnessMenu.jsx';
import FitnessSidebar from '../modules/Fitness/FitnessSidebar.jsx';
import FitnessShow from '../modules/Fitness/FitnessShow.jsx';
import FitnessPlayer from '../modules/Fitness/FitnessPlayer.jsx';
import { FitnessProvider } from '../context/FitnessContext.jsx';

const FitnessApp = () => {
  // NOTE: This app targets a large touchscreen TV device. To reduce perceived latency
  // all interactive controls inside the Fitness modules use onPointerDown instead of onClick.
  // onClick fires after pointerup + potential capture delays; pointerDown gives immediate
  // feedback for tap interactions while we still provide keyboard accessibility (Enter/Space)
  // on focusable elements. If adding new buttons/interactive divs, prefer onPointerDown.
  // Security / compliance: start with empty config; all data must come from /api/fitness
  const [fitnessConfiguration, setFitnessConfiguration] = useState({});
  const [fetchError, setFetchError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('menu'); // 'menu', 'users', 'show'
  const [activeCollection, setActiveCollection] = useState(null);
  const [selectedShow, setSelectedShow] = useState(null);
  const [fitnessPlayQueue, setFitnessPlayQueue] = useState([]);
  const viewportRef = useRef(null);
  
  // Expose the queue setter globally for emergency access
  useEffect(() => {
    if (window) {
      window.addToFitnessQueue = (item) => {
        // silent queue append (debug log removed)
        setFitnessPlayQueue(prev => [...prev, item]);
      };
    }
    return () => {
      if (window && window.addToFitnessQueue) {
        delete window.addToFitnessQueue;
      }
    };
  }, []);
  
  // Derive collections from the API response
  const collections = useMemo(() => {
    const src =
      fitnessConfiguration?.fitness?.plex?.collections ||
      fitnessConfiguration?.plex?.collections ||
      [];
    return Array.isArray(src) ? src : [];
  }, [fitnessConfiguration]);

  const handleContentSelect = (category, value) => {
    switch (category) {
      case 'collection': {
        const id = typeof value === 'object' && value !== null ? value.id : value;
        setActiveCollection(id);
        setCurrentView('menu');
        setSelectedShow(null);
        break;
      }
      case 'show': {
        setSelectedShow(value.plex);
        setCurrentView('show');
        break;
      }
      case 'users': {
        setCurrentView('users');
        break;
      }
      default: {
        // unknown content category (suppressed)
        break;
      }
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
        // Always ensure nested fitness object (the context prefers nested if present)
        if (!response.fitness) response.fitness = {};

        // Normalize: move top-level domain keys into response.fitness if not already nested
        const unifyKeys = ['ant_devices','equipment','users','coin_time_unit_ms','zones','plex'];
        unifyKeys.forEach(k => {
          if (response[k] !== undefined && response.fitness[k] === undefined) {
            response.fitness[k] = response[k];
          }
        });

        // Diagnostics for user + HR color availability
        const primaryLen = response.fitness?.users?.primary?.length || 0;
        const secondaryLen = response.fitness?.users?.secondary?.length || 0;
  // diagnostics removed

        // Provide the normalized config to provider
        setFitnessConfiguration(response);
      } catch (error) {
        console.error('Error fetching fitness data:', error);
        setFetchError(error);
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

  // render diagnostics removed
  
  return (
    <MantineProvider theme={{ colorScheme: 'dark' }}>
      <FitnessProvider 
        fitnessConfiguration={fitnessConfiguration}
        fitnessPlayQueue={fitnessPlayQueue}
        setFitnessPlayQueue={setFitnessPlayQueue}
      >
        <div className="fitness-app-container">
          <div className="fitness-app-viewport" style={{ position: 'relative', height: '100%' }} ref={viewportRef}>
            {loading && (
              <div style={{display:'flex',alignItems:'center',justifyContent:'center',position:'absolute',inset:0}}>
                <Text size="lg">Loading fitness configuration…</Text>
              </div>
            )}
            {fetchError && !loading && (
              <div style={{padding:'1rem',color:'tomato'}}>
                <Text size="sm">Failed to load fitness configuration. Check console / API.</Text>
              </div>
            )}
            {/* Base UI - Always render but hide when player is shown */}
            <div style={{ 
              display: 'flex', 
              height: '100%', 
              width: '100%',
              visibility: fitnessPlayQueue.length > 0 || loading ? 'hidden' : 'visible'
            }}>
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
                    setFitnessPlayQueue={setFitnessPlayQueue}
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
            
            {/* Player overlay - only rendered when needed */}
            {fitnessPlayQueue.length > 0 && (
              <div style={{
                position: 'absolute', 
                top: 0, 
                left: 0, 
                right: 0, 
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.9)',
                zIndex: 1000
              }}>
                <FitnessPlayer 
                  playQueue={fitnessPlayQueue}
                  setPlayQueue={setFitnessPlayQueue}
                  viewportRef={viewportRef}
                />
              </div>
            )}
          </div>
        </div>
      </FitnessProvider>
    </MantineProvider>
  );
};

export default FitnessApp;
