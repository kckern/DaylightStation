import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MantineProvider, Paper, Title, Group, Text, Alert, Grid } from '@mantine/core';
import '@mantine/core/styles.css';
import "./FitnessApp.scss";
import { DaylightAPI } from '../lib/api.mjs';
import FitnessCam from "../modules/Fitness/FitnessCam.jsx";
import FitnessMenu from '../modules/Fitness/FitnessMenu.jsx';
import FitnessNavbar from '../modules/Fitness/FitnessNavbar.jsx';
import FitnessShow from '../modules/Fitness/FitnessShow.jsx';
import FitnessPlayer from '../modules/Fitness/FitnessPlayer.jsx';
import { VolumeProvider } from '../modules/Fitness/VolumeProvider.jsx';
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
  const [kioskUI, setKioskUI] = useState(() => {
    // Check if Firefox on initial load - use more robust detection
    const isFirefox = typeof InstallTrigger !== 'undefined' || 
                     (navigator.userAgent && navigator.userAgent.toLowerCase().indexOf('firefox') > -1);
    return isFirefox;
  });
  const viewportRef = useRef(null);
  
  // In kiosk mode, block right-click/context menu and secondary button actions
  useEffect(() => {
    if (!kioskUI) return;
    const preventContext = (e) => {
      try {
        e.preventDefault();
        e.stopPropagation();
        return false;
      } catch (err) {
        // Firefox sometimes throws on preventDefault in certain contexts
        console.warn('Context menu prevention failed:', err);
        return false;
      }
    };
    const preventSecondary = (e) => {
      try {
        // 2 = secondary button for mouse; also cover auxiliary (1) just in case
        if (e.button === 2 || e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      } catch (err) {
        // Firefox compatibility
        console.warn('Secondary button prevention failed:', err);
        return false;
      }
    };
    
    // Disable tooltips and alt text popups in kiosk mode
    const disableTooltips = () => {
      try {
        // Add CSS to hide all tooltips and alt text
        const style = document.createElement('style');
        style.textContent = `
          /* Hide all tooltips and title attributes */
          *[title] { 
            --tooltip-display: none !important; 
          }
          *[title]:hover::after,
          *[title]:focus::after { 
            display: none !important; 
          }
          /* Hide video controls tooltips - WebKit browsers */
          video::-webkit-media-controls,
          video::-webkit-media-controls-enclosure,
          video::-webkit-media-controls-panel,
          video::-webkit-media-controls-play-button,
          video::-webkit-media-controls-timeline,
          video::-webkit-media-controls-current-time-display,
          video::-webkit-media-controls-time-remaining-display,
          video::-webkit-media-controls-mute-button,
          video::-webkit-media-controls-volume-slider,
          video::-webkit-media-controls-fullscreen-button {
            -webkit-appearance: none !important;
          }
          /* Hide Firefox video controls and tooltips */
          video::-moz-media-controls {
            display: none !important;
          }
          video {
            -moz-user-select: none;
            user-select: none;
          }
        `;
        if (document.head) {
          document.head.appendChild(style);
        } else {
          // Fallback for edge cases where head isn't ready
          document.documentElement.appendChild(style);
        }
      } catch (err) {
        console.warn('Failed to add tooltip hiding styles:', err);
      }
      
      // Remove title attributes from all elements to prevent alt text popups
      const removeTooltips = () => {
        try {
          // Use more conservative approach for Firefox
          const titleElements = document.querySelectorAll('*[title]');
          titleElements.forEach(el => {
            try {
              el.removeAttribute('title');
            } catch (e) {
              // Ignore errors on individual elements
            }
          });
          
          const altElements = document.querySelectorAll('*[alt]');
          altElements.forEach(el => {
            try {
              el.setAttribute('alt', '');
            } catch (e) {
              // Ignore errors on individual elements
            }
          });
        } catch (err) {
          console.warn('Failed to remove tooltips:', err);
        }
      };
      
      // Run immediately and on DOM changes
      removeTooltips();
      
      let observer = null;
      try {
        observer = new MutationObserver(() => {
          // Debounce the tooltip removal to avoid performance issues
          setTimeout(removeTooltips, 100);
        });
        
        if (document.body) {
          observer.observe(document.body, { 
            childList: true, 
            subtree: true, 
            attributes: true, 
            attributeFilter: ['title', 'alt'] 
          });
        }
      } catch (err) {
        console.warn('Failed to set up MutationObserver:', err);
      }
      
      return () => {
        if (observer) {
          try {
            observer.disconnect();
          } catch (e) {
            // Ignore disconnect errors
          }
        }
      };
    };
    
    const cleanupTooltips = disableTooltips();
    
    // Add event listeners with Firefox-compatible error handling
    try {
      window.addEventListener('contextmenu', preventContext, { capture: true, passive: false });
      window.addEventListener('mousedown', preventSecondary, { capture: true, passive: false });
      
      // Only add pointer events if supported (Firefox has some quirks)
      if ('onpointerdown' in window) {
        window.addEventListener('pointerdown', preventSecondary, { capture: true, passive: false });
      }
    } catch (err) {
      console.warn('Failed to add event listeners:', err);
    }
    
    return () => {
      try {
        window.removeEventListener('contextmenu', preventContext, { capture: true });
        window.removeEventListener('mousedown', preventSecondary, { capture: true });
        if ('onpointerdown' in window) {
          window.removeEventListener('pointerdown', preventSecondary, { capture: true });
        }
      } catch (err) {
        console.warn('Failed to remove event listeners:', err);
      }
      
      if (cleanupTooltips) {
        try {
          cleanupTooltips();
        } catch (err) {
          console.warn('Failed to cleanup tooltips:', err);
        }
      }
    };
  }, [kioskUI]);
  
  // Detect touch events and switch to kiosk mode (hides cursor)
  useEffect(() => {
    const handleFirstTouch = () => {
      try {
        setKioskUI(true);
        // Remove listener after first touch detected
        window.removeEventListener('touchstart', handleFirstTouch);
      } catch (err) {
        console.warn('Failed to handle touch event:', err);
      }
    };
    
    try {
      window.addEventListener('touchstart', handleFirstTouch, { passive: true });
    } catch (err) {
      console.warn('Failed to add touch listener:', err);
    }
    
    return () => {
      try {
        window.removeEventListener('touchstart', handleFirstTouch);
      } catch (err) {
        console.warn('Failed to remove touch listener:', err);
      }
    };
  }, []);
  
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
        const normalizedId = Array.isArray(id) ? [...id] : id;
        setActiveCollection(normalizedId);
        setCurrentView('menu');
        setSelectedShow(null);
        break;
      }
      case 'show': {
        setSelectedShow(value.plex);
        setCurrentView('show');
        break;
      }
      case 'movie': {
        //send directly to player queue
        setFitnessPlayQueue(prev => [...prev, value]);
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
        
        // Validate response structure
        if (!response || typeof response !== 'object') {
          throw new Error('Invalid API response format');
        }
        
        // Always ensure nested fitness object (the context prefers nested if present)
        if (!response.fitness) response.fitness = {};

        // Normalize: move top-level domain keys into response.fitness if not already nested
        const unifyKeys = ['ant_devices','equipment','users','coin_time_unit_ms','zones','plex','governance'];
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
        
        // Enhanced error logging for Firefox debugging
        if (error.name === 'TypeError' && error.message.includes('NetworkError')) {
          console.error('Firefox NetworkError detected - check CORS/SSL/network settings');
        } else if (error.name === 'AbortError') {
          console.error('Request was aborted - possibly due to Firefox security restrictions');
        }
        
        setFetchError(error);
      } finally {
        setLoading(false);
      }
    };

    // Add a small delay to ensure DOM is ready in Firefox
    const timeoutId = setTimeout(() => {
      fetchFitnessData();
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, []);

  // Initialize the active collection once collections arrive
  useEffect(() => {
    if (activeCollection == null && collections.length > 0) {
      const initialId = collections[0].id;
      setActiveCollection(Array.isArray(initialId) ? [...initialId] : initialId);
    }
  }, [collections, activeCollection]);

  // render diagnostics removed
  
  return (
    <MantineProvider theme={{ colorScheme: 'dark' }}>
      <VolumeProvider>
        <FitnessProvider 
          fitnessConfiguration={fitnessConfiguration}
          fitnessPlayQueue={fitnessPlayQueue}
          setFitnessPlayQueue={setFitnessPlayQueue}
        >
          <div className={`fitness-app-container ${kioskUI ? 'kiosk-ui' : ''}`}>
            <div className="fitness-app-viewport" style={{ position: 'relative', height: '100%' }} ref={viewportRef}>
              {loading && (
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',position:'absolute',inset:0}}>
                  <Text size="lg">Loading fitness configuration…</Text>
                  <Text size="sm" style={{marginTop: '0.5rem', opacity: 0.7}}>
                    {kioskUI ? 'Firefox detected - optimized for kiosk mode' : 'Preparing application...'}
                  </Text>
                  <button 
                    style={{
                      marginTop: '1rem',
                      padding: '0.75rem 1.5rem',
                      fontSize: '1rem',
                      backgroundColor: '#228be6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.5rem',
                      cursor: 'pointer',
                      fontWeight: 'bold'
                    }}
                    onPointerDown={(e) => {
                      try {
                        e.preventDefault();
                        window.location.reload();
                      } catch (err) {
                        console.warn('Reload failed, trying alternative method:', err);
                        window.location.href = window.location.href;
                      }
                    }}
                    onClick={(e) => {
                      // Fallback for browsers that don't support pointerdown properly
                      try {
                        e.preventDefault();
                        window.location.reload();
                      } catch (err) {
                        console.warn('Reload failed, trying alternative method:', err);
                        window.location.href = window.location.href;
                      }
                    }}
                    onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      try {
                        e.preventDefault();
                        window.location.reload();
                      } catch (err) {
                        console.warn('Reload failed, trying alternative method:', err);
                        window.location.href = window.location.href;
                      }
                    }
                  }}
                  tabIndex={0}
                >
                  Reload App
                </button>
              </div>
            )}
            {fetchError && !loading && (
              <div style={{padding:'2rem',color:'tomato',textAlign:'center'}}>
                <Text size="lg" style={{marginBottom:'1rem'}}>Failed to load fitness configuration</Text>
                <Text size="sm" style={{marginBottom:'0.5rem'}}>
                  {fetchError.message || 'Unknown error occurred'}
                </Text>
                {fetchError.name === 'TypeError' && fetchError.message.includes('NetworkError') && (
                  <Text size="xs" style={{marginBottom:'1rem',opacity:0.8}}>
                    Firefox NetworkError: Check CORS settings, SSL certificates, or network connectivity
                  </Text>
                )}
                <button 
                  style={{
                    marginTop: '1rem',
                    padding: '0.75rem 1.5rem',
                    fontSize: '1rem',
                    backgroundColor: '#fa5252',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                  }}
                  onClick={() => {
                    try {
                      window.location.reload();
                    } catch (err) {
                      window.location.href = window.location.href;
                    }
                  }}
                >
                  Retry
                </button>
              </div>
            )}
            {/* Base UI - Always render but hide when player is shown */}
            <div style={{ 
              display: 'flex', 
              height: '100%', 
              width: '100%',
              visibility: fitnessPlayQueue.length > 0 || loading ? 'hidden' : 'visible'
            }}>
              <FitnessNavbar 
                collections={collections}
                activeCollection={activeCollection}
                onContentSelect={handleContentSelect}
              />
              <div className={`fitness-main-content ${currentView === 'users' ? 'fitness-cam-active' : ''}`}>
                {currentView === 'users' && (
                  <FitnessCam />
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
    </VolumeProvider>
    </MantineProvider>
  );
};

export default FitnessApp;
