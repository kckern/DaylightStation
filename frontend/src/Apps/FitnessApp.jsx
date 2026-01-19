import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MantineProvider, Paper, Title, Group, Text, Alert, Grid } from '@mantine/core';
import '@mantine/core/styles.css';
import "./FitnessApp.scss";
import { DaylightAPI } from '../lib/api.mjs';
import FitnessMenu from '../modules/Fitness/FitnessMenu.jsx';
import FitnessNavbar from '../modules/Fitness/FitnessNavbar.jsx';
import FitnessShow from '../modules/Fitness/FitnessShow.jsx';
import FitnessPlayer from '../modules/Fitness/FitnessPlayer.jsx';
import FitnessPluginContainer from '../modules/Fitness/FitnessPlugins/FitnessPluginContainer.jsx';
import { VolumeProvider } from '../modules/Fitness/VolumeProvider.jsx';
import { FitnessProvider } from '../context/FitnessContext.jsx';
import getLogger from '../lib/logging/Logger.js';
import { sortNavItems } from '../modules/Fitness/lib/navigationUtils.js';
import VoiceMemoOverlay from '../modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx';
import { useFitnessContext } from '../context/FitnessContext.jsx';
import { FitnessFrame } from '../modules/Fitness/frames';
import { useFitnessUrlParams } from '../hooks/fitness/useFitnessUrlParams.js';
import { useNavigate, useLocation } from 'react-router-dom';

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
  const [currentView, setCurrentView] = useState('menu'); // 'menu', 'users', 'show', 'plugin'
  const [activeCollection, setActiveCollection] = useState(null);
  const [selectedShow, setSelectedShow] = useState(null);
  const [activePlugin, setActivePlugin] = useState(null); // { id, ...manifest }
  const [fitnessPlayQueue, setFitnessPlayQueue] = useState([]);
  const [kioskUI, setKioskUI] = useState(() => {
    // Check if Firefox on initial load - use more robust detection
    const isFirefox = typeof InstallTrigger !== 'undefined' || 
                     (navigator.userAgent && navigator.userAgent.toLowerCase().indexOf('firefox') > -1);
    return isFirefox;
  });
  const viewportRef = useRef(null);
  const logger = useMemo(() => getLogger().child({ app: 'fitness' }), []);

  // URL-based navigation
  const { urlState } = useFitnessUrlParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [urlInitialized, setUrlInitialized] = useState(false);

  useEffect(() => {
    logger.info('fitness-app-mount');
  }, [logger]);
  useEffect(() => {
    logger.info('fitness-kiosk-state', { kiosk: kioskUI });
  }, [kioskUI, logger]);

  // Memory/timer profiling for crash debugging
  useEffect(() => {
    const startTime = Date.now();
    let sampleCount = 0;
    let baselineMemory = null;
    let baselineTimers = null;

    // Count active intervals (approximate via window inspection)
    const countTimers = () => {
      // Use timer tracker if available, otherwise estimate
      if (window.__timerTracker) {
        return window.__timerTracker.getStats?.() || { activeIntervals: -1, activeTimeouts: -1 };
      }
      return { activeIntervals: -1, activeTimeouts: -1 };
    };

    const getMemoryMB = () => {
      const mem = performance.memory;
      if (!mem) return null;
      return {
        usedMB: Math.round(mem.usedJSHeapSize / 1024 / 1024 * 10) / 10,
        totalMB: Math.round(mem.totalJSHeapSize / 1024 / 1024 * 10) / 10,
        limitMB: Math.round(mem.jsHeapSizeLimit / 1024 / 1024)
      };
    };

    const logProfile = () => {
      sampleCount++;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const mem = getMemoryMB();
      const timers = countTimers();

      // Capture baseline on first sample
      if (!baselineMemory && mem) baselineMemory = mem.usedMB;
      if (!baselineTimers) baselineTimers = timers.activeIntervals;

      const growthMB = mem ? Math.round((mem.usedMB - baselineMemory) * 10) / 10 : null;
      const timerGrowth = timers.activeIntervals >= 0 ? timers.activeIntervals - baselineTimers : null;

      // Get session-level stats (exposed via window for cross-component access)
      const sessionStats = window.__fitnessSession?.getMemoryStats?.() || {};
      const chartStats = window.__fitnessChartStats?.() || {};
      
      // React render frequency tracking (exposed by FitnessContext if available)
      const renderStats = window.__fitnessRenderStats?.() || {};

      logger.sampled('fitness-profile', {
        sample: sampleCount,
        elapsedSec: elapsed,
        heapMB: mem?.usedMB,
        heapGrowthMB: growthMB,
        timers: timers.activeIntervals,
        timerGrowth,
        timeouts: timers.activeTimeouts,
        // Session stats
        sessionActive: sessionStats.sessionActive,
        tickTimerRunning: sessionStats.tickTimerRunning,
        rosterSize: sessionStats.rosterSize,
        deviceCount: sessionStats.deviceCount,
        seriesCount: sessionStats.seriesCount,
        totalSeriesPoints: sessionStats.totalSeriesPoints,
        maxSeriesLength: sessionStats.maxSeriesLength,
        eventLogSize: sessionStats.eventLogSize,
        // Snapshot series stats (memory leak indicator)
        snapshotSeriesPoints: sessionStats.snapshotSeriesPoints,
        maxSnapshotSeriesLength: sessionStats.maxSnapshotSeriesLength,
        // TreasureBox stats (memory leak indicator)
        treasureBoxCumulativeLen: sessionStats.treasureBoxCumulativeLen,
        treasureBoxPerColorPoints: sessionStats.treasureBoxPerColorPoints,
        voiceMemoCount: sessionStats.voiceMemoCount,
        // Cumulative trackers
        cumulativeBeatsSize: sessionStats.cumulativeBeatsSize,
        cumulativeRotationsSize: sessionStats.cumulativeRotationsSize,
        // Chart stats (if exposed)
        chartCacheSize: chartStats.participantCacheSize,
        chartDropoutMarkers: chartStats.dropoutMarkerCount,
        // React render stats (if exposed)
        forceUpdateCount: renderStats.forceUpdateCount,
        renderCount: renderStats.renderCount
      }, { maxPerMinute: 2 });

      // Warn if growth is concerning
      if (growthMB > 20) {
        logger.warn('fitness-profile-memory-warning', { growthMB, elapsed });
      }
      if (timerGrowth > 5) {
        logger.warn('fitness-profile-timer-warning', { timerGrowth, elapsed });
      }
      // Warn if session data growing unexpectedly
      if (sessionStats.maxSeriesLength > 1500) {
        logger.warn('fitness-profile-series-warning', {
          maxSeriesLength: sessionStats.maxSeriesLength,
          seriesCount: sessionStats.seriesCount
        });
      }
      // Warn if snapshot series growing unexpectedly (indicates pruning not working)
      if (sessionStats.maxSnapshotSeriesLength > 2500) {
        logger.warn('fitness-profile-snapshot-series-warning', {
          maxSnapshotSeriesLength: sessionStats.maxSnapshotSeriesLength,
          snapshotSeriesPoints: sessionStats.snapshotSeriesPoints
        });
      }
      // Warn if TreasureBox timeline growing unexpectedly
      if (sessionStats.treasureBoxCumulativeLen > 800) {
        logger.warn('fitness-profile-treasurebox-warning', {
          cumulativeLen: sessionStats.treasureBoxCumulativeLen,
          perColorPoints: sessionStats.treasureBoxPerColorPoints
        });
      }
      // Warn if tick timer running without active session (potential leak)
      if (sessionStats.tickTimerRunning && !sessionStats.sessionActive) {
        logger.error('fitness-profile-orphan-timer', {
          tickTimerRunning: true,
          sessionActive: false,
          elapsed
        });
      }
      // Warn if forceUpdate rate is excessive (>100 in 30s = ~3/sec)
      if (renderStats.forceUpdateCount > 100) {
        logger.warn('fitness-profile-excessive-renders', {
          forceUpdateCount: renderStats.forceUpdateCount,
          renderCount: renderStats.renderCount,
          elapsed
        });
      }
    };

    // Log immediately, then every 30 seconds
    logProfile();
    const intervalId = setInterval(logProfile, 30000);

    logger.info('fitness-profile-started', { intervalSec: 30 });

    return () => {
      clearInterval(intervalId);
      logger.info('fitness-profile-stopped', { samples: sampleCount });
    };
  }, [logger]);
  
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
        logger.warn('fitness-contextmenu-prevention-failed', { message: err?.message });
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
        logger.warn('fitness-secondary-button-prevention-failed', { message: err?.message });
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
        logger.warn('fitness-tooltip-style-failed', { message: err?.message });
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
          logger.warn('fitness-tooltip-remove-failed', { message: err?.message });
        }
      };
      
      // Run immediately and on DOM changes
      removeTooltips();
      
      // MEMORY LEAK FIX: Properly track debounce timer to prevent stacking timeouts
      let observer = null;
      let debounceTimer = null;
      try {
        observer = new MutationObserver(() => {
          // Skip if already pending to prevent timeout stacking
          if (debounceTimer) return;
          
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            removeTooltips();
          }, 500);
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
        logger.warn('fitness-tooltip-observer-failed', { message: err?.message });
      }
      
      return () => {
        if (debounceTimer) {
          try {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          } catch (e) {
            // Ignore clear errors
          }
        }
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
      logger.warn('fitness-event-listener-add-failed', { message: err?.message });
    }
    
    return () => {
      try {
        window.removeEventListener('contextmenu', preventContext, { capture: true });
        window.removeEventListener('mousedown', preventSecondary, { capture: true });
        if ('onpointerdown' in window) {
          window.removeEventListener('pointerdown', preventSecondary, { capture: true });
        }
      } catch (err) {
        logger.warn('fitness-event-listener-remove-failed', { message: err?.message });
      }
      
      if (cleanupTooltips) {
        try {
          cleanupTooltips();
        } catch (err) {
          logger.warn('fitness-tooltip-cleanup-failed', { message: err?.message });
        }
      }
    };
  }, [kioskUI]);
  
  // Detect touch events and switch to kiosk mode (hides cursor)
  useEffect(() => {
    const handleFirstTouch = () => {
      try {
        setKioskUI(true);
        logger.info('fitness-kiosk-touch-detected');
        // Remove listener after first touch detected
        window.removeEventListener('touchstart', handleFirstTouch);
      } catch (err) {
        logger.warn('fitness-touch-handle-failed', { message: err?.message });
      }
    };
    
    try {
      window.addEventListener('touchstart', handleFirstTouch, { passive: true });
    } catch (err) {
      logger.warn('fitness-touch-listener-add-failed', { message: err?.message });
    }
    
    return () => {
      try {
        window.removeEventListener('touchstart', handleFirstTouch);
      } catch (err) {
        logger.warn('fitness-touch-listener-remove-failed', { message: err?.message });
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
  
  // Derive navItems from the API response
  const navItems = useMemo(() => {
    const src =
      fitnessConfiguration?.fitness?.plex?.nav_items ||
      fitnessConfiguration?.plex?.nav_items ||
      [];
    return Array.isArray(src) ? src : [];
  }, [fitnessConfiguration]);

  // Handle /fitness/play/:id route
  const handlePlayFromUrl = async (episodeId) => {
    try {
      const response = await fetch(`/api/plex/metadata/${episodeId}`);
      if (!response.ok) {
        logger.error('fitness-play-url-fetch-failed', { episodeId, status: response.status });
        navigate('/fitness', { replace: true });
        return;
      }

      const metadata = await response.json();
      const queueItem = {
        id: episodeId,
        plex: episodeId,
        type: metadata.type || 'episode',
        title: metadata.title,
        showId: metadata.grandparentRatingKey || metadata.parentRatingKey,
        thumb: metadata.thumb
      };

      setFitnessPlayQueue([queueItem]);
      logger.info('fitness-play-url-started', { episodeId, showId: queueItem.showId });
    } catch (err) {
      logger.error('fitness-play-url-error', { episodeId, error: err.message });
      navigate('/fitness', { replace: true });
    }
  };

  const handleNavigate = (type, target, item) => {
    logger.info('fitness-navigate', { type, target });

    switch (type) {
      case 'plex_collection':
        setActiveCollection(target.collection_id);
        setActivePlugin(null);
        setCurrentView('menu');
        setSelectedShow(null);
        navigate(`/fitness/menu/${target.collection_id}`, { replace: true });
        break;

      case 'plex_collection_group':
        setActiveCollection(target.collection_ids);
        setActivePlugin(null);
        setCurrentView('menu');
        setSelectedShow(null);
        navigate(`/fitness/menu/${target.collection_ids.join(',')}`, { replace: true });
        break;

      case 'plugin_menu':
        setActiveCollection(target.menu_id);
        setActivePlugin(null);
        setCurrentView('menu');
        setSelectedShow(null);
        navigate(`/fitness/menu/${target.menu_id}`, { replace: true });
        break;

      case 'plugin_direct':
        setActivePlugin({
          id: target.plugin_id,
          ...(target.config || {})
        });
        setActiveCollection(null);
        setCurrentView('plugin');
        setSelectedShow(null);
        navigate(`/fitness/plugin/${target.plugin_id}`, { replace: true });
        break;

      case 'plugin':
        // Launched from FitnessPluginMenu
        setActivePlugin({
          id: target.id,
          ...(target || {})
        });
        setActiveCollection(null);
        setCurrentView('plugin');
        setSelectedShow(null);
        navigate(`/fitness/plugin/${target.id}`, { replace: true });
        break;

      case 'view_direct':
        setActiveCollection(null);
        setActivePlugin(null);
        setCurrentView(target.view);
        setSelectedShow(null);
        if (target.view === 'users') {
          navigate('/fitness/users', { replace: true });
        }
        break;

      case 'show':
        setSelectedShow(target.plex || target.id);
        setCurrentView('show');
        navigate(`/fitness/show/${target.plex || target.id}`, { replace: true });
        break;

      case 'movie':
        //send directly to player queue
        setFitnessPlayQueue(prev => [...prev, target]);
        navigate(`/fitness/play/${target.plex || target.id}`, { replace: true });
        break;

      case 'custom_action':
        logger.warn('custom_action not implemented', { action: target.action });
        break;

      default:
        logger.warn('fitness-navigate-unknown', { type });
    }
  };

  const handleBackToMenu = () => {
    setCurrentView('menu');
    setSelectedShow(null);
    if (activeCollection) {
      const colId = Array.isArray(activeCollection) ? activeCollection.join(',') : activeCollection;
      navigate(`/fitness/menu/${colId}`, { replace: true });
    } else {
      navigate('/fitness', { replace: true });
    }
  };

  useEffect(() => {
    const fetchFitnessData = async () => {
      try {
        logger.info('fitness-config-request');
        const response = await DaylightAPI('/api/fitness');
        
        // Validate response structure
        if (!response || typeof response !== 'object') {
          throw new Error('Invalid API response format');
        }
        
        // Always ensure nested fitness object (the context prefers nested if present)
        if (!response.fitness) response.fitness = {};

        // Normalize: move top-level domain keys into response.fitness if not already nested
        const unifyKeys = ['ant_devices','equipment','users','coin_time_unit_ms','zones','plex','governance','ambient_led','device_colors','devices'];
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
        logger.info('fitness-config-loaded', {
          navItems: (response?.fitness?.plex?.nav_items || []).length || 0,
          users: (response?.fitness?.users?.primary || []).length || 0,
          sensors: Array.isArray(response?.fitness?.ant_devices) ? response.fitness.ant_devices.length : 0
        });
        const antDevices = Array.isArray(response?.fitness?.ant_devices) ? response.fitness.ant_devices : [];
        if (antDevices.length) {
          logger.info('fitness-sensor-connected', { count: antDevices.length });
        } else {
          logger.debug('fitness-sensor-none-detected');
        }
      } catch (error) {
        logger.error('fitness-config-failed', { name: error?.name, message: error?.message });
        
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
  }, [logger]);

  // Initialize state from URL on mount
  useEffect(() => {
    if (urlInitialized || loading) return;

    const { view, id, ids, music, fullscreen, simulate } = urlState;

    logger.info('fitness-url-init', { view, id, ids, music, fullscreen, simulate });

    // Handle simulation trigger
    if (simulate) {
      if (simulate.stop) {
        fetch('/api/fitness/simulate', { method: 'DELETE' })
          .then(r => r.json())
          .then(data => logger.info('fitness-simulate-stopped', data))
          .catch(err => logger.error('fitness-simulate-stop-failed', { error: err.message }));
      } else {
        fetch('/api/fitness/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(simulate)
        })
          .then(r => r.json())
          .then(data => logger.info('fitness-simulate-started', data))
          .catch(err => logger.error('fitness-simulate-start-failed', { error: err.message }));
      }

      // Clear simulate param from URL after triggering
      const newParams = new URLSearchParams(location.search);
      newParams.delete('simulate');
      const newUrl = newParams.toString() ? `${location.pathname}?${newParams}` : location.pathname;
      navigate(newUrl, { replace: true });
    }

    // Handle fullscreen
    if (fullscreen && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }

    // Set view based on URL
    if (view === 'users') {
      setCurrentView('users');
    } else if (view === 'show' && id) {
      setSelectedShow(id);
      setCurrentView('show');
    } else if (view === 'plugin' && id) {
      setActivePlugin({ id });
      setCurrentView('plugin');
    } else if (view === 'play' && id) {
      handlePlayFromUrl(id);
    } else if (view === 'menu' && ids) {
      if (ids.length === 1) {
        setActiveCollection(ids[0]);
      } else {
        setActiveCollection(ids);
      }
      setCurrentView('menu');
    }

    setUrlInitialized(true);
  }, [urlState, loading, urlInitialized, navigate, location]);

  // Initialize to the first nav item once navItems arrive
  useEffect(() => {
    // Don't auto-navigate if we're on a special view like 'users' or 'show'
    if (currentView === 'users' || currentView === 'show') {
      return;
    }
    // Don't auto-navigate if URL already set up the initial state
    if (urlInitialized && (urlState.view !== 'menu' || urlState.id || urlState.ids)) {
      return;
    }
    if (activeCollection == null && activePlugin == null && navItems.length > 0) {
      // Sort items to match navbar display order
      const sortedItems = sortNavItems(navItems);
      const firstItem = sortedItems[0];

      if (firstItem) {
        logger.info('fitness-nav-init', {
          type: firstItem.type,
          name: firstItem.name,
          target: firstItem.target
        });
        handleNavigate(firstItem.type, firstItem.target, firstItem);
      }
    }
  }, [navItems, activeCollection, activePlugin, currentView, urlInitialized, urlState]);

  const queueSize = fitnessPlayQueue.length;
  useEffect(() => {
    logger.debug('fitness-view-state', { view: currentView, queueSize });
  }, [currentView, queueSize, logger]);

  // render diagnostics removed
  
  return (
    <MantineProvider theme={{ colorScheme: 'dark' }}>
      <VolumeProvider>
        <FitnessProvider 
          fitnessConfiguration={fitnessConfiguration}
          fitnessPlayQueue={fitnessPlayQueue}
          setFitnessPlayQueue={setFitnessPlayQueue}
        >
          <GlobalOverlays />
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
                        logger.warn('fitness-reload-fallback', { message: err?.message });
                        window.location.href = window.location.href;
                      }
                    }}
                    onClick={(e) => {
                      // Fallback for browsers that don't support pointerdown properly
                      try {
                        e.preventDefault();
                        window.location.reload();
                      } catch (err) {
                        logger.warn('fitness-reload-fallback', { message: err?.message });
                        window.location.href = window.location.href;
                      }
                    }}
                    onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      try {
                        e.preventDefault();
                        window.location.reload();
                      } catch (err) {
                        logger.warn('fitness-reload-fallback', { message: err?.message });
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
            {/* Base UI - Using FitnessFrame layout shell */}
            <FitnessFrame
              nav={
                <FitnessNavbar 
                  navItems={navItems}
                  currentState={{
                    currentView,
                    activeCollection,
                    activePlugin
                  }}
                  onNavigate={handleNavigate}
                />
              }
              hideNav={fitnessPlayQueue.length > 0 || loading}
              className={fitnessPlayQueue.length > 0 || loading ? 'fitness-frame--hidden' : ''}
            >
              <div className={`fitness-main-content ${currentView === 'users' ? 'fitness-cam-active' : ''}`}>
                {currentView === 'users' && (
                  <FitnessPluginContainer pluginId="fitness_session" mode="standalone" />
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
                    activeCollection={activeCollection} 
                    onContentSelect={handleNavigate}
                  />
                )}
                {currentView === 'plugin' && activePlugin && (
                  <FitnessPluginContainer
                    pluginId={activePlugin.id}
                    mode="standalone"
                    onClose={() => {
                      setActivePlugin(null);
                      setCurrentView('menu');
                    }}
                  />
                )}
              </div>
            </FitnessFrame>
            
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

const GlobalOverlays = () => {
  const fitnessCtx = useFitnessContext();
  if (!fitnessCtx) return null;

  return (
    <VoiceMemoOverlay
      overlayState={fitnessCtx.voiceMemoOverlayState}
      voiceMemos={fitnessCtx.voiceMemos}
      onClose={fitnessCtx.closeVoiceMemoOverlay}
      onOpenReview={fitnessCtx.openVoiceMemoReview}
      onOpenList={fitnessCtx.openVoiceMemoList}
      onOpenRedo={fitnessCtx.openVoiceMemoCapture}
      onRemoveMemo={fitnessCtx.removeVoiceMemoFromSession}
      onAddMemo={fitnessCtx.addVoiceMemoToSession}
      onReplaceMemo={fitnessCtx.replaceVoiceMemoInSession}
      sessionId={fitnessCtx.fitnessSession?.sessionId || fitnessCtx.fitnessSessionInstance?.sessionId}
      playerRef={fitnessCtx.videoPlayerRef}
      preferredMicrophoneId={fitnessCtx.preferredMicrophoneId}
    />
  );
};

export default FitnessApp;
