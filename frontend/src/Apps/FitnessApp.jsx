import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { MantineProvider, Paper, Title, Group, Text, Alert, Grid } from '@mantine/core';
import '@mantine/core/styles.css';
import "./FitnessApp.scss";
import { DaylightAPI, DaylightMediaPath } from '../lib/api.mjs';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import FitnessMenu from '../modules/Fitness/nav/FitnessMenu.jsx';
import FitnessNavbar from '../modules/Fitness/nav/FitnessNavbar.jsx';
import FitnessShow from '../modules/Fitness/player/FitnessShow.jsx';
import FitnessPlayer from '../modules/Fitness/player/FitnessPlayer.jsx';
import HRSimTrigger from '../modules/Fitness/nav/HRSimTrigger.jsx';
import FitnessModuleContainer from '../modules/Fitness/player/FitnessModuleContainer.jsx';
import { getModuleManifest } from '../modules/Fitness/index.js';
import { VolumeProvider } from '../modules/Fitness/nav/VolumeProvider.jsx';
import { FitnessProvider } from '../context/FitnessContext.jsx';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import { readHeap, heapFields, heapSnapshotFields, isMemoryMonitoringAvailable, reportMemoryMonitoringAvailability } from '../lib/perf/memoryProbe.js';
import { sortNavItems, filterNavItemsByDay, isNavItemActive } from '../modules/Fitness/lib/navigationUtils.js';
import useDayOfWeek from '../hooks/useDayOfWeek.js';
import VoiceMemoOverlay from '../modules/Fitness/player/overlays/VoiceMemoOverlay.jsx';
import FitnessToast from '../modules/Fitness/player/overlays/FitnessToast.jsx';
import { DeviceStatePublisher } from '../screen-framework/publishers/DeviceStatePublisher.jsx';
import { usePlayerSessionBinding } from '../screen-framework/publishers/usePlayerSessionBinding.js';
import EmergencyLockdownOverlay from '../modules/Fitness/player/overlays/EmergencyLockdownOverlay.jsx';
import { IdentityProvider } from '../modules/Fitness/identity/IdentityProvider';
import { useFitnessContext } from '../context/FitnessContext.jsx';
import { FitnessFrame } from '../modules/Fitness/player/frames';
import { useFitnessUrlParams } from '../hooks/fitness/useFitnessUrlParams.js';
import { useNavigate, useLocation } from 'react-router-dom';
import { ScreenDataProvider } from '../screen-framework/data/ScreenDataProvider.jsx';
import { ScreenProvider } from '../screen-framework/providers/ScreenProvider.jsx';
import { PanelRenderer } from '../screen-framework/panels/PanelRenderer.jsx';
import { FitnessScreenProvider } from '../modules/Fitness/FitnessScreenProvider.jsx';
import { registerBuiltinWidgets } from '../screen-framework/widgets/builtins.js';
// Ensure fitness modules are registered in widget registry
import '../modules/Fitness/index.js';
import { saveActiveSession, loadActiveSession, clearActiveSession } from './fitnessSessionPersistence.js';
import MenuMusicController from '../modules/Fitness/nav/MenuMusicController.jsx';
import EmergencyPlaybackController from '../modules/Fitness/player/EmergencyPlaybackController.jsx';
import { FitnessFeedback, FeedbackCornerButton } from '../modules/Fitness/feedback';

registerBuiltinWidgets();

const FitnessApp = () => {
  useDocumentTitle('Fitness');
  // NOTE: This app targets a large touchscreen TV device. To reduce perceived latency
  // all interactive controls inside the Fitness modules use onPointerDown instead of onClick.
  // onClick fires after pointerup + potential capture delays; pointerDown gives immediate
  // feedback for tap interactions while we still provide keyboard accessibility (Enter/Space)
  // on focusable elements. If adding new buttons/interactive divs, prefer onPointerDown.
  // Security / compliance: start with empty config; all data must come from /api/fitness
  // Sticky governance bypass — persists across route changes within the session
  const [nogovern] = useState(() => new URLSearchParams(window.location.search).has('nogovern'));
  const [fitnessConfiguration, setFitnessConfiguration] = useState({});
  const [fetchError, setFetchError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('menu'); // 'screen', 'menu', 'users', 'show', 'module'
  const [activeCollection, setActiveCollection] = useState(null);
  const [selectedShow, setSelectedShow] = useState(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(null);
  const [activeModule, setActiveModule] = useState(null); // { id, ...manifest }
  const [moduleReturnTo, setModuleReturnTo] = useState(null); // collection/menu a module was launched from
  const [activeScreen, setActiveScreen] = useState(null); // screen_id from screens config
  const [pendingSelectedSessionId, setPendingSelectedSessionId] = useState(null); // pre-select just-ended session on home
  const [fitnessPlayQueue, setFitnessPlayQueue] = useState([]);
  const [menuMusicTracks, setMenuMusicTracks] = useState([]);
  // Quiet pre-fetch default: the configured menu_music.volume arrives async from
  // /menu-music. Defaulting low means a fetch failure/latency degrades quieter
  // rather than blasting at the old 0.15. useMenuMusic re-applies the real value
  // live once it arrives.
  const [menuMusicVolume, setMenuMusicVolume] = useState(0.05);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Mirror the active play queue to sessionStorage so an F5 reload can resume it.
  useEffect(() => {
    if (fitnessPlayQueue.length > 0) saveActiveSession(fitnessPlayQueue);
    else clearActiveSession();
  }, [fitnessPlayQueue]);
  const [kioskUI, setKioskUI] = useState(() => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost) return false;
    // Check if Firefox on initial load - use more robust detection
    const isFirefox = typeof InstallTrigger !== 'undefined' ||
                     (navigator.userAgent && navigator.userAgent.toLowerCase().indexOf('firefox') > -1);
    return isFirefox;
  });
  const viewportRef = useRef(null);
  const logger = useMemo(() => getLogger().child({ app: 'fitness', sessionLog: true }), []);

  // URL-based navigation
  const { urlState } = useFitnessUrlParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [urlInitialized, setUrlInitialized] = useState(false);

  // Configure root logger so child components using getLogger() directly
  // also get sessionLog: true (routes their events to the JSONL session file)
  useEffect(() => {
    // Session logging runs at 'info'. Per-component debug can be enabled at
    // runtime via window.DAYLIGHT_LOG_LEVEL='debug' when investigating.
    configureLogger({ level: 'info', context: { app: 'fitness', sessionLog: true } });
    return () => {
      configureLogger({ level: 'info', context: { sessionLog: false } });
    };
  }, []);

  useEffect(() => {
    logger.info('fitness-app-mount');
  }, [logger]);
  useEffect(() => {
    logger.info('fitness-kiosk-state', { kiosk: kioskUI });
  }, [kioskUI, logger]);

  // Reload diagnostics - capture what triggers page unloads
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBeforeUnload = () => {
      logger.error('page_unload_triggered', {
        timestamp: Date.now(),
        url: window.location.href,
        stack: new Error('Unload stack trace').stack,
        governancePhase: window.__fitnessGovernance?.phase || null,
        sessionStats: window.__fitnessSession?.getMemoryStats?.() || null,
        performanceMemory: heapSnapshotFields({ precision: 1 })
      });
    };

    const handleVisibilityChange = () => {
      logger.info('page_visibility_changed', {
        hidden: document.hidden,
        visibilityState: document.visibilityState,
        governancePhase: window.__fitnessGovernance?.phase || null
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [logger]);

  // Memory/timer/FPS profiling for crash debugging and performance correlation
  useEffect(() => {
    const startTime = Date.now();
    let sampleCount = 0;
    let baselineMemory = null;
    let baselineTimers = null;
    let lastFpsCheck = { timestamp: 0, totalFrames: 0, droppedFrames: 0 };
    let currentIntervalId = null;
    let heapSamples = []; // For growth rate calculation

    // Count active intervals (approximate via window inspection)
    const countTimers = () => {
      if (window.__timerTracker) {
        return window.__timerTracker.getStats?.() || { activeIntervals: -1, activeTimeouts: -1 };
      }
      return { activeIntervals: -1, activeTimeouts: -1 };
    };

    // Announce once whether heap monitoring works at all in this browser. The
    // garage kiosk is Firefox, which implements neither performance.memory nor
    // (outside cross-origin isolation) measureUserAgentSpecificMemory — so the
    // growth thresholds below can never fire. Saying so beats logging a null
    // that reads like "no growth".
    const memoryAvailable = reportMemoryMonitoringAvailability({ monitor: 'fitness-profile' });

    const getMemoryMB = () => {
      const { heapMB, heapTotalMB, heapLimitMB, heapSource } = readHeap({ precision: 1 });
      if (heapMB === null) return null;
      return {
        usedMB: heapMB,
        totalMB: heapTotalMB,
        limitMB: heapLimitMB === null ? null : Math.round(heapLimitMB),
        source: heapSource
      };
    };

    // Get video FPS metrics using getVideoPlaybackQuality API
    const getVideoFps = () => {
      const globalVideo = typeof window !== 'undefined' ? window.__fitnessVideoElement : null;
      const video = globalVideo || document.querySelector('video, dash-video');
      if (!video) return null;

      const quality = video.getVideoPlaybackQuality?.();
      if (!quality) return null;

      const now = performance.now();
      const elapsed = (now - lastFpsCheck.timestamp) / 1000;
      const framesDelta = quality.totalVideoFrames - lastFpsCheck.totalFrames;
      const droppedDelta = quality.droppedVideoFrames - lastFpsCheck.droppedFrames;

      // Guard: video element was reloaded/reset — frame counter went backwards
      // Reset tracking and skip this sample
      if (framesDelta < 0) {
        lastFpsCheck = {
          timestamp: now,
          totalFrames: quality.totalVideoFrames,
          droppedFrames: quality.droppedVideoFrames
        };
        return null;
      }

      // Calculate FPS only if we have a previous sample
      let fps = null;
      let dropRate = null;
      if (lastFpsCheck.timestamp > 0 && elapsed > 0) {
        fps = Math.round(framesDelta / elapsed * 10) / 10;
        dropRate = framesDelta > 0 ? Math.round(droppedDelta / framesDelta * 1000) / 10 : 0;
      }

      // Update last check
      lastFpsCheck = {
        timestamp: now,
        totalFrames: quality.totalVideoFrames,
        droppedFrames: quality.droppedVideoFrames
      };

      return {
        fps,
        totalFrames: quality.totalVideoFrames,
        droppedFrames: quality.droppedVideoFrames,
        corruptedFrames: quality.corruptedVideoFrames || 0,
        dropRate,
        videoState: video.paused ? 'paused' : (video.readyState < 3 ? 'stalled' : 'playing')
      };
    };

    // Calculate heap growth rate from recent samples
    const calculateHeapGrowthRate = () => {
      if (heapSamples.length < 2) return null;
      const oldest = heapSamples[0];
      const newest = heapSamples[heapSamples.length - 1];
      const durationMin = (newest.ts - oldest.ts) / 60000;
      if (durationMin < 0.5) return null;
      return Math.round((newest.heap - oldest.heap) / durationMin * 10) / 10;
    };

    const logProfile = () => {
      sampleCount++;
      const now = Date.now();
      const elapsed = Math.round((now - startTime) / 1000);
      const mem = getMemoryMB();
      const timers = countTimers();
      const videoFps = getVideoFps();

      // Capture baseline on first sample
      if (!baselineMemory && mem) baselineMemory = mem.usedMB;
      if (!baselineTimers) baselineTimers = timers.activeIntervals;

      const growthMB = mem ? Math.round((mem.usedMB - baselineMemory) * 10) / 10 : null;
      const timerGrowth = timers.activeIntervals >= 0 ? timers.activeIntervals - baselineTimers : null;

      // Track heap samples for growth rate (keep last 10 samples)
      if (mem) {
        heapSamples.push({ ts: now, heap: mem.usedMB });
        if (heapSamples.length > 10) heapSamples.shift();
      }
      const heapGrowthRateMBperMin = calculateHeapGrowthRate();

      // Get governance state from global exposure
      const governance = window.__fitnessGovernance || {};
      const governancePhase = governance.phase || null;
      const governanceWarningDurationMs = governance.warningDuration || 0;
      const challengeActive = !!governance.activeChallenge;

      // Get session-level stats
      const sessionStats = window.__fitnessSession?.getMemoryStats?.() || {};
      const chartStats = window.__fitnessChartStats?.() || {};
      const renderStats = window.__fitnessRenderStats?.() || {};

      // Determine video state with governance awareness
      let videoState = videoFps?.videoState || null;
      if (governance.videoLocked) {
        videoState = 'governance-locked';
      }

      // Dynamic rate limiting - more frequent during warning phase
      const maxPerMinute = governancePhase === 'warning' ? 12 : 2;

      logger.sampled('fitness-profile', {
        sample: sampleCount,
        elapsedSec: elapsed,
        heapMB: mem?.usedMB ?? null,
        heapSource: mem?.source ?? 'unavailable',
        heapGrowthMB: growthMB,
        heapGrowthRateMBperMin,
        timers: timers.activeIntervals,
        timerGrowth,
        timeouts: timers.activeTimeouts,
        // Governance correlation
        governancePhase,
        governanceWarningDurationMs,
        challengeActive,
        // Video FPS correlation
        videoFps: videoFps?.fps,
        videoDroppedFrames: videoFps?.droppedFrames,
        videoDropRate: videoFps?.dropRate,
        videoState,
        // Session stats
        sessionActive: sessionStats.sessionActive,
        tickTimerRunning: sessionStats.tickTimerRunning,
        rosterSize: sessionStats.rosterSize,
        deviceCount: sessionStats.deviceCount,
        seriesCount: sessionStats.seriesCount,
        totalSeriesPoints: sessionStats.totalSeriesPoints,
        maxSeriesLength: sessionStats.maxSeriesLength,
        eventLogSize: sessionStats.eventLogSize,
        // Snapshot series stats
        snapshotSeriesPoints: sessionStats.snapshotSeriesPoints,
        maxSnapshotSeriesLength: sessionStats.maxSnapshotSeriesLength,
        // TreasureBox stats
        treasureBoxCumulativeLen: sessionStats.treasureBoxCumulativeLen,
        treasureBoxPerColorPoints: sessionStats.treasureBoxPerColorPoints,
        voiceMemoCount: sessionStats.voiceMemoCount,
        // Cumulative trackers
        cumulativeBeatsSize: sessionStats.cumulativeBeatsSize,
        cumulativeRotationsSize: sessionStats.cumulativeRotationsSize,
        // Chart stats
        chartCacheSize: chartStats.participantCacheSize,
        chartDropoutMarkers: chartStats.dropoutMarkerCount,
        // Render stats
        forceUpdateCount: renderStats.forceUpdateCount,
        renderCount: renderStats.renderCount,
        renderRatePer5s: renderStats.ratePer5s
      }, { maxPerMinute });

      // === WARNING THRESHOLDS ===

      // Memory warnings. Guarded on availability so the absence of a warning
      // means "measured, and fine" rather than "never measured" — the
      // distinction the Firefox kiosk logs could not previously express.
      if (memoryAvailable && growthMB > 20) {
        logger.warn('fitness-profile-memory-warning', { growthMB, elapsed, ...heapFields() });
      }
      if (timerGrowth > 5) {
        logger.warn('fitness-profile-timer-warning', { timerGrowth, elapsed });
      }

      // FPS + Governance correlation warning (key diagnostic)
      if (videoFps && videoFps.fps !== null && videoFps.fps < 24 && governancePhase === 'warning') {
        logger.warn('fitness.video_fps_warning_correlation', {
          fps: videoFps.fps,
          dropRate: videoFps.dropRate,
          droppedFrames: videoFps.droppedFrames,
          governancePhase,
          governanceWarningDurationMs,
          heapMB: mem?.usedMB ?? null,
          heapSource: mem?.source ?? 'unavailable',
          rosterSize: sessionStats.rosterSize,
          forceUpdateCount: renderStats.forceUpdateCount
        });
      }

      // FPS degradation warning (regardless of governance)
      if (videoFps && videoFps.fps !== null && videoFps.fps < 20 && videoState === 'playing') {
        logger.warn('fitness.video_fps_degraded', {
          fps: videoFps.fps,
          dropRate: videoFps.dropRate,
          videoState,
          governancePhase,
          heapMB: mem?.usedMB ?? null,
          heapSource: mem?.source ?? 'unavailable'
        });
      }

      // Memory + Governance correlation
      if (memoryAvailable && growthMB > 15 && governancePhase === 'warning') {
        logger.warn('fitness-profile-memory-governance-correlation', {
          growthMB,
          heapGrowthRateMBperMin,
          governancePhase,
          governanceWarningDurationMs,
          elapsed
        });
      }

      // Memory + Render correlation
      if (memoryAvailable && growthMB > 15 && (renderStats.ratePer5s || 0) > 50) {
        logger.warn('fitness-profile-memory-render-correlation', {
          growthMB,
          heapGrowthRateMBperMin,
          renderRatePer5s: renderStats.ratePer5s,
          forceUpdateCount: renderStats.forceUpdateCount,
          elapsed
        });
      }

      // Session data warnings
      if (sessionStats.maxSeriesLength > 1500) {
        logger.warn('fitness-profile-series-warning', {
          maxSeriesLength: sessionStats.maxSeriesLength,
          seriesCount: sessionStats.seriesCount
        });
      }
      if (sessionStats.maxSnapshotSeriesLength > 2500) {
        logger.warn('fitness-profile-snapshot-series-warning', {
          maxSnapshotSeriesLength: sessionStats.maxSnapshotSeriesLength,
          snapshotSeriesPoints: sessionStats.snapshotSeriesPoints
        });
      }
      if (sessionStats.treasureBoxCumulativeLen > 800) {
        logger.warn('fitness-profile-treasurebox-warning', {
          cumulativeLen: sessionStats.treasureBoxCumulativeLen,
          perColorPoints: sessionStats.treasureBoxPerColorPoints
        });
      }
      if (sessionStats.tickTimerRunning && !sessionStats.sessionActive) {
        logger.error('fitness-profile-orphan-timer', {
          tickTimerRunning: true,
          sessionActive: false,
          elapsed
        });
      }
      if (renderStats.forceUpdateCount > 100) {
        logger.warn('fitness-profile-excessive-renders', {
          forceUpdateCount: renderStats.forceUpdateCount,
          renderCount: renderStats.renderCount,
          elapsed
        });
      }
    };

    // Adaptive interval: 5s during warning phase, 30s otherwise
    const updateInterval = () => {
      const governance = window.__fitnessGovernance || {};
      const isWarning = governance.phase === 'warning';
      const targetInterval = isWarning ? 5000 : 30000;

      // Only recreate interval if needed
      if (currentIntervalId) {
        clearInterval(currentIntervalId);
      }
      currentIntervalId = setInterval(() => {
        logProfile();
        // Check if we need to change interval
        const nowGov = window.__fitnessGovernance || {};
        const nowWarning = nowGov.phase === 'warning';
        const currentTarget = nowWarning ? 5000 : 30000;
        if (currentTarget !== targetInterval) {
          updateInterval(); // Recursively update interval
        }
      }, targetInterval);
    };

    // Log immediately, then start adaptive interval
    logProfile();
    updateInterval();

    logger.info('fitness-profile-started', { intervalSec: 30, adaptiveWarningIntervalSec: 5 });

    return () => {
      if (currentIntervalId) {
        clearInterval(currentIntervalId);
      }
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
        // Boundary normalize: caller may not set contentId; derive from plex/id if absent.
        const normalized = item && item.contentId
          ? item
          : { ...item, contentId: item?.plex
              ? `plex:${item.plex}`
              : (item?.id != null && /^[0-9]+$/.test(String(item.id)) ? `plex:${item.id}` : null) };
        setFitnessPlayQueue(prev => [...prev, normalized]);
      };
    }
    return () => {
      if (window && window.addToFitnessQueue) {
        delete window.addToFitnessQueue;
      }
    };
  }, []);

  // Sim-panel seam: let the simulation popup open a module (e.g. the cycle game)
  // via SPA navigation — NO page reload, so window.__fitnessSimController and the
  // popup's reference to it survive.
  useEffect(() => {
    const launch = (moduleId) => {
      if (!moduleId) return;
      setActiveModule({ id: moduleId });
      setActiveCollection(null);
      setSelectedShow(null);
      setCurrentView('module');
      navigate(`/fitness/module/${moduleId}`, { replace: true });
    };
    window.__fitnessLaunchModule = launch;
    return () => {
      // Only clear if it's still ours (guards a StrictMode/remount interleave).
      if (window.__fitnessLaunchModule === launch) delete window.__fitnessLaunchModule;
    };
  }, [navigate]);

  // Extract content source from config (default: 'plex')
  const contentSource = useMemo(() => {
    const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
    return root?.content_source || 'plex';
  }, [fitnessConfiguration]);

  // Best-effort primary user id for feedback context (don't over-couple — null is fine).
  const primaryUserId = useMemo(() => {
    const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
    const primary = root?.users?.primary?.[0];
    return primary?.id || primary?.profileId || null;
  }, [fitnessConfiguration]);

  // Roster + household label for the Momentum widget (same config object the
  // primaryUserId memo reads `users.primary` from, honoring the optional `.fitness` wrapper).
  const momentumRoster = useMemo(() => {
    const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
    const primary = root?.users?.primary;
    return Array.isArray(primary)
      ? primary.map((u) => ({
          id: u.id,
          name: u.name || u.display_name || u.id,
          groupLabel: u.group_label || u.groupLabel || null,
        }))
      : [];
  }, [fitnessConfiguration]);
  const householdLabel = useMemo(() => {
    const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
    return root?.household_label || '';
  }, [fitnessConfiguration]);
  // Momentum measurement window (days). Config-driven; defaults to 7.
  const momentumWindowDays = useMemo(() => {
    const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
    const n = Number(root?.momentum?.window_days);
    return Number.isFinite(n) && n > 0 ? n : 7;
  }, [fitnessConfiguration]);
  // Number of weekly bars to compare (one per window). Config-driven; defaults to 4.
  const momentumCompareWeeks = useMemo(() => {
    const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
    const n = Number(root?.momentum?.compare_weeks);
    return Number.isFinite(n) && n > 0 ? n : 4;
  }, [fitnessConfiguration]);
  // Fullscreen modules (e.g. the Game Boy emulator) render as a full app-viewport
  // overlay — like the player — instead of inside the frame.
  const activeModuleFullscreen = useMemo(() => {
    if (currentView !== 'module' || !activeModule?.id) return false;
    return !!getModuleManifest(activeModule.id)?.fullscreen;
  }, [currentView, activeModule]);

  // Reactive day-of-week — updates itself at local midnight WITHOUT a reload, so
  // day-gated nav items re-evaluate live on a long-running kiosk session.
  const dayOfWeek = useDayOfWeek();

  // Derive navItems from the API response (source-agnostic: uses contentConfig section)
  // Items may carry a `days` array (0=Sun..6=Sat) to gate them to certain days
  // of the week — e.g. a "TV Shows" tab that only appears on Saturdays. The
  // filter applies to both the rendered navbar and the default-first-item
  // auto-init below, so a hidden tab is never auto-selected. Keyed on dayOfWeek
  // so the tab disappears the instant the clock rolls past midnight — no stale
  // overnight "stowaway" tab.
  const navItems = useMemo(() => {
    const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
    const contentConfig = root?.content || root?.plex || root?.[contentSource] || {};
    const src = contentConfig?.nav_items || [];
    return filterNavItemsByDay(Array.isArray(src) ? src : [], dayOfWeek);
  }, [fitnessConfiguration, contentSource, dayOfWeek]);

  // Derive screens config map from fitness configuration
  const screensConfig = useMemo(() => {
    const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
    return root?.screens || {};
  }, [fitnessConfiguration]);

  // Resolve data sources for active screen, injecting dashboard URL with primary userId
  const screenSources = useMemo(() => {
    const screenCfg = activeScreen ? screensConfig[activeScreen] : null;
    if (!screenCfg?.data) return {};
    const sources = { ...screenCfg.data };
    const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
    const primaryUser = root?.users?.primary?.[0];
    if (primaryUser) {
      const userId = primaryUser.id || primaryUser.profileId;
      sources.dashboard = { source: `/api/v1/health-dashboard/${userId}`, refresh: 300 };
    }
    return sources;
  }, [activeScreen, screensConfig, fitnessConfiguration]);

  // Derive sequential labels config for route-based play blocking
  const sequentialLabelSet = useMemo(() => {
    const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
    const contentConfig = root?.content || root?.plex || root?.[contentSource] || {};
    const labels = contentConfig?.sequential_labels;
    return Array.isArray(labels)
      ? new Set(labels.map(l => l.toLowerCase()))
      : new Set();
  }, [fitnessConfiguration, contentSource]);

  // Handle /fitness/play/:id route
  const handlePlayFromUrl = async (episodeId, { nogovern = false } = {}) => {
    try {
      // Fetch episode metadata from API to get labels for governance
      const response = await DaylightAPI(`api/v1/info/${contentSource}/${episodeId}`);

      if (!response || response.error) {
        logger.warn('fitness-play-url-no-metadata', { episodeId, error: response?.error });
        // Fallback to basic queue item without labels
        const contentId = String(episodeId);
        const fallbackItem = {
          id: contentId,
          contentId: contentSource ? `${contentSource}:${contentId}` : null,
          contentSource,
          type: 'episode',
          title: `Episode ${episodeId}`,
          videoUrl: DaylightMediaPath(`api/v1/play/${contentSource}/${episodeId}`),
          thumbId: episodeId,
          image: DaylightMediaPath(`api/v1/display/${contentSource}/${episodeId}`)
        };
        setFitnessPlayQueue([fallbackItem]);
        logger.info('fitness-play-url-started-fallback', { episodeId, contentSource });
        return;
      }

      // Block route-based play for sequential shows — redirect to show UI
      const episodeLabels = (response.labels || response.metadata?.labels || [])
        .map(l => typeof l === 'string' ? l.toLowerCase() : '');
      const isInSequentialShow = sequentialLabelSet.size > 0 &&
        episodeLabels.some(l => sequentialLabelSet.has(l));
      if (isInSequentialShow && !nogovern) {
        const showId = response.metadata?.grandparentId || response.metadata?.grandparentRatingKey;
        if (showId) {
          logger.info('fitness-play-url-sequential-blocked', { episodeId, showId });
          setSelectedShow(String(showId));
          setCurrentView('show');
          navigate(`/fitness/show/${showId}`, { replace: true });
          return;
        }
      }

      // Build queue item from API response (includes labels for governance)
      const contentId = String(response.key || episodeId);
      const queueItem = {
        id: contentId,
        contentId: contentSource ? `${contentSource}:${contentId}` : null,
        contentSource,
        type: response.type || 'episode',
        title: response.title || `Episode ${episodeId}`,
        grandparentTitle: response.metadata?.grandparentTitle || null,
        parentTitle: response.metadata?.parentTitle || null,
        videoUrl: response.mediaUrl || DaylightMediaPath(`api/v1/play/${contentSource}/${episodeId}`),
        thumbId: response.metadata?.thumbId || response.thumbId || episodeId,
        image: response.image || DaylightMediaPath(`api/v1/display/${contentSource}/${episodeId}`),
        labels: response.labels || response.metadata?.labels || [],
        summary: response.metadata?.summary || null
      };

      setFitnessPlayQueue([queueItem]);
      logger.info('fitness-play-url-started', { episodeId, contentSource, hasLabels: queueItem.labels.length > 0 });
    } catch (err) {
      logger.error('fitness-play-url-error', { episodeId, contentSource, error: err.message });
      navigate('/fitness', { replace: true });
    }
  };

  const handleHomePlay = useCallback((queueItem) => {
    // Boundary normalize: queueItem comes from upstream caller (widgets that
    // parse compound contentIds). Use queueItem.contentSource when present —
    // do NOT hardcode 'plex:' since widgets are source-agnostic.
    const src = queueItem?.contentSource || 'plex';
    const normalized = queueItem && queueItem.contentId
      ? queueItem
      : {
          ...queueItem,
          contentId:
            (typeof queueItem?.id === 'string' && /^[a-z]+:/i.test(queueItem.id))
              ? queueItem.id
              : (queueItem?.plex
                  ? `plex:${queueItem.plex}`
                  : (queueItem?.id != null && /^[0-9]+$/.test(String(queueItem.id))
                      ? `${src}:${queueItem.id}`
                      : null))
        };
    setFitnessPlayQueue(prev => [...prev, normalized]);
    const episodeId = String(queueItem.id).replace(/^[a-z]+:/i, '');
    if (episodeId) {
      navigate(`/fitness/play/${episodeId}`, { replace: true });
    }
  }, [navigate]);

  const handleNavigate = (type, target, item) => {
    logger.info('fitness-navigate', { type, target });

    switch (type) {
      case 'collection':
      case 'plex_collection':
        setActiveCollection(target.collection_id);
        setActiveModule(null);
        setCurrentView('menu');
        setSelectedShow(null);
        navigate(`/fitness/menu/${target.collection_id}`, { replace: true });
        break;

      case 'collection_group':
      case 'plex_collection_group':
        setActiveCollection(target.collection_ids);
        setActiveModule(null);
        setCurrentView('menu');
        setSelectedShow(null);
        navigate(`/fitness/menu/${target.collection_ids.join(',')}`, { replace: true });
        break;

      case 'module_menu':
        setActiveCollection(target.menu_id);
        setActiveModule(null);
        setCurrentView('menu');
        setSelectedShow(null);
        navigate(`/fitness/menu/${target.menu_id}`, { replace: true });
        break;

      case 'module_direct':
        setActiveModule({
          id: target.module_id,
          ...(target.config || {})
        });
        setActiveCollection(null);
        setCurrentView('module');
        setSelectedShow(null);
        navigate(`/fitness/module/${target.module_id}`, { replace: true });
        break;

      case 'module':
        // Launched from FitnessModuleMenu — remember the menu we came from so the
        // module's exit returns there (e.g. app_menu1), not the default home.
        setModuleReturnTo(target.return_to ?? activeCollection ?? null);
        setActiveModule({
          id: target.id,
          ...(target || {})
        });
        setActiveCollection(null);
        setCurrentView('module');
        setSelectedShow(null);
        navigate(`/fitness/module/${target.id}`, { replace: true });
        break;

      case 'screen':
        setActiveScreen(target.screen_id);
        setActiveCollection(null);
        setActiveModule(null);
        setSelectedShow(null);
        setCurrentView('screen');
        navigate(`/fitness/${target.screen_id}`, { replace: true });
        break;

      case 'view_direct':
        setActiveCollection(null);
        setActiveModule(null);
        setSelectedShow(null);
        if (target.view === 'users') {
          setCurrentView('users');
          navigate('/fitness/users', { replace: true });
        } else if (target.view === 'home') {
          // Backward compat: view_direct home → screen
          setActiveScreen('home');
          setCurrentView('screen');
          navigate('/fitness/home', { replace: true });
        } else {
          setCurrentView(target.view);
        }
        break;

      case 'show':
        // Extract local ID from contentId or legacy plex key
        const showId = String(target.contentId || target.plex || target.id).replace(/^[a-z]+:/i, '');
        setSelectedShow(showId);
        setSelectedEpisodeId(target.episodeId || null);
        setCurrentView('show');
        navigate(`/fitness/show/${showId}`, { replace: true });
        break;

      case 'movie': {
        //send directly to player queue
        const movieId = String(target.contentId || target.plex || target.id).replace(/^[a-z]+:/i, '');
        // Boundary normalize: prefer existing prefixed id, else synthesize from plex
        // field, else from a bare numeric id. Otherwise leave null and rely on the
        // read-side fallback chain.
        const movieNormalized = target?.contentId
          ? target
          : {
              ...target,
              contentId:
                (typeof target?.id === 'string' && /^[a-z]+:/i.test(target.id))
                  ? target.id
                  : (target?.plex
                      ? `plex:${target.plex}`
                      : (target?.id != null && /^[0-9]+$/.test(String(target.id))
                          ? `plex:${target.id}`
                          : null))
            };
        setFitnessPlayQueue(prev => [...prev, movieNormalized]);
        navigate(`/fitness/play/${movieId}`, { replace: true });
        break;
      }

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

  // Close an active module and return to the menu it was launched from (e.g. the
  // Game Boy emulator's exit goes back to app_menu1), falling back to home.
  const handleModuleClose = () => {
    setActiveModule(null);
    setSelectedShow(null);
    setCurrentView('menu');
    if (moduleReturnTo) {
      setActiveCollection(moduleReturnTo);
      const colId = Array.isArray(moduleReturnTo) ? moduleReturnTo.join(',') : moduleReturnTo;
      navigate(`/fitness/menu/${colId}`, { replace: true });
    } else {
      navigate('/fitness', { replace: true });
    }
    setModuleReturnTo(null);
  };

  useEffect(() => {
    const fetchFitnessData = async () => {
      try {
        logger.info('fitness-config-request');
        const response = await DaylightAPI('/api/v1/fitness');
        
        // Validate response structure
        if (!response || typeof response !== 'object') {
          throw new Error('Invalid API response format');
        }
        
        // Always ensure nested fitness object (the context prefers nested if present)
        if (!response.fitness) response.fitness = {};

        // Normalize: move top-level domain keys into response.fitness if not already nested
        // NOTE: every top-level fitness.yml block consumed by the frontend MUST
        // be listed here, or FitnessContext (which roots at response.fitness)
        // will never see it — that's how dance_party silently went missing.
        const unifyKeys = ['ant_devices','equipment','users','coin_time_unit_ms','zones','plex','governance','ambient_led','device_colors','devices','home_screen','screens','cycle_game','dance_party','sessions','voice_memo_eligibility','content','content_source','guest_profiles','locks','emergency','household_label','momentum'];
        unifyKeys.forEach(k => {
          if (response[k] !== undefined && response.fitness[k] === undefined) {
            response.fitness[k] = response[k];
          }
        });

        // Backward compat: wrap legacy home_screen into screens map
        if (response.fitness.home_screen && !response.fitness.screens) {
          response.fitness.screens = { home: response.fitness.home_screen };
        }
        if (response.fitness.screens) {
          delete response.fitness.home_screen;
        }

        // Backward compat: normalize legacy nav item types
        const contentSection = response.fitness.content || response.fitness.plex || {};
        if (Array.isArray(contentSection.nav_items)) {
          contentSection.nav_items.forEach(item => {
            if (item.type === 'plugin_direct') {
              item.type = 'screen';
              if (item.target?.plugin_id && !item.target.screen_id) {
                item.target = { screen_id: item.target.plugin_id };
              }
            } else if (item.type === 'plugin_menu') {
              item.type = 'module_menu';
              if (item.target?.plugin_id && !item.target.menu_id) {
                item.target = { menu_id: item.target.plugin_id };
              }
            }
          });
        }

        // Diagnostics for user + HR color availability
        const primaryLen = response.fitness?.users?.primary?.length || 0;
        const secondaryLen = response.fitness?.users?.secondary?.length || 0;
        // diagnostics removed

        // Provide the normalized config to provider
        setFitnessConfiguration(response);
        // Fetch menu music track list (non-blocking — silent on failure)
        DaylightAPI('/api/v1/fitness/menu-music').then(music => {
          if (!music || !Array.isArray(music.tracks)) return;
          setMenuMusicTracks(music.tracks.map(t => DaylightMediaPath(t)));
          if (typeof music.volume === 'number') setMenuMusicVolume(music.volume);
        }).catch(() => {});
        logger.info('fitness-config-loaded', {
          navItems: (response?.fitness?.content?.nav_items || response?.fitness?.plex?.nav_items || []).length || 0,
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

  // After init: ensure a /fitness/play/{id} URL with an empty queue gets a queue.
  // Two paths feed this effect:
  //   1. Restore-on-mount (F5 reload of an in-progress session): if sessionStorage
  //      holds an active session, restore it directly via setFitnessPlayQueue — this
  //      bypasses the sequential-show redirect because the session was already vetted.
  //   2. In-app navigation (e.g. cycle-demo launcher, show-list onPlay) to a play URL
  //      without a pre-populated queue: fall back to handlePlayFromUrl, which still
  //      applies governance (including the sequential-show redirect).
  useEffect(() => {
    if (!urlInitialized || loading) return;
    if (urlState.view !== 'play' || !urlState.id) return;
    if (fitnessPlayQueue.length > 0) return;
    const restored = loadActiveSession();
    if (restored) {
      setFitnessPlayQueue(restored);
      logger.info('fitness-session-restored-from-storage', { id: restored[0]?.id, size: restored.length });
      return;
    }
    handlePlayFromUrl(urlState.id, { nogovern });
  }, [urlState.view, urlState.id, urlInitialized, loading, fitnessPlayQueue.length]);

  // Initialize state from URL on mount
  useEffect(() => {
    if (urlInitialized || loading) return;

    const { view, id, ids, music, fullscreen, simulate } = urlState;

    logger.info('fitness-url-init', { view, id, ids, music, fullscreen, simulate });

    // Handle simulation trigger
    if (simulate) {
      if (simulate.stop) {
        fetch('/api/v1/fitness/simulate', { method: 'DELETE' })
          .then(r => r.json())
          .then(data => logger.info('fitness-simulate-stopped', data))
          .catch(err => logger.error('fitness-simulate-stop-failed', { error: err.message }));
      } else {
        fetch('/api/v1/fitness/simulate', {
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

    // /fitness/cycle-demo — pick a random episode from cycling show 674139
    // (VirtualCycling) via /api/v1/fitness/show/674139/playable, then
    // redirect to /fitness/play/{id}?cycle-demo=1 so the demo overlay
    // mounts on top of a real video.
    if (view === 'cycle-demo') {
      (async () => {
        try {
          const resp = await fetch('/api/v1/fitness/show/674139/playable')
            .then((r) => r.json())
            .catch(() => null);
          const episodes = (resp?.items || resp?.episodes || []).filter((e) => e?.id || e?.key);
          if (episodes.length === 0) {
            logger.warn('cycle-demo-no-episodes', { showId: 674139 });
            navigate('/fitness', { replace: true });
            return;
          }
          const pick = episodes[Math.floor(Math.random() * episodes.length)];
          const episodeId = String(pick.id || pick.key).replace(/^[a-z]+:/i, '');
          logger.info('cycle-demo-redirect', { episodeId, showId: 674139, title: pick.title, choices: episodes.length });
          navigate(`/fitness/play/${episodeId}?cycle-demo=1&nogovern`, { replace: true });
        } catch (err) {
          logger.error('cycle-demo-discover-failed', { error: err?.message });
          navigate('/fitness', { replace: true });
        }
      })();
      setUrlInitialized(true);
      return;
    }

    // Set view based on URL
    if (view === 'users') {
      setCurrentView('users');
    } else if (screensConfig[view]) {
      setActiveScreen(view);
      setCurrentView('screen');
      // Deep link: /fitness/{screen}/session-{id} pre-opens that session's detail.
      const sessionMatch = typeof id === 'string' && id.match(/^session-(.+)$/);
      if (sessionMatch) setPendingSelectedSessionId(sessionMatch[1]);
    } else if (view === 'show' && id) {
      setSelectedShow(id);
      setCurrentView('show');
    } else if (view === 'module' && id) {
      setActiveModule({ id });
      setCurrentView('module');
    } else if (view === 'play' && id) {
      handlePlayFromUrl(id, { nogovern });
    } else if (view === 'menu' && ids) {
      if (ids.length === 1) {
        setActiveCollection(ids[0]);
      } else {
        setActiveCollection(ids);
      }
      setCurrentView('menu');
    }

    setUrlInitialized(true);
  }, [urlState, loading, urlInitialized, navigate, location, screensConfig]);

  // Initialize to the first nav item once navItems arrive
  useEffect(() => {
    // Don't auto-navigate if we're on a special view like 'users', 'show', or 'screen'
    if (currentView === 'users' || currentView === 'show' || currentView === 'screen') {
      return;
    }
    // Don't auto-navigate if URL already set up the initial state
    // Skip auto-redirect whenever the URL clearly specifies a non-default
    // intent. Don't gate on urlInitialized — that races with the URL-init
    // effect and causes /fitness/menu/{id} to bounce to /fitness/home on
    // first render before activeCollection gets set.
    if (urlState.view !== 'menu' || urlState.id || urlState.ids) {
      return;
    }
    // Default to first screen if screens config exists and nothing else is active
    const screenIds = Object.keys(screensConfig);
    if (screenIds.length > 0 && activeCollection == null && activeModule == null && activeScreen == null && currentView === 'menu') {
      setActiveScreen(screenIds[0]);
      setCurrentView('screen');
      navigate(`/fitness/${screenIds[0]}`, { replace: true });
      return;
    }
    if (activeCollection == null && activeModule == null && navItems.length > 0) {
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
  }, [navItems, activeCollection, activeModule, activeScreen, currentView, urlInitialized, urlState, screensConfig, navigate]);

  // Stowaway guard: when the day rolls over at midnight, a day-gated collection
  // the user is already sitting in (e.g. a Saturday-only "TV Shows" menu) gets
  // filtered out of navItems but its content stays on screen — the auto-init
  // above won't recover it because activeCollection is still set. So on any day
  // change, if the active menu collection no longer maps to a visible nav item,
  // bounce to the first available tab. Bounded to menu view; module/screen/users
  // views are untouched. Fires only on actual day transitions, never on config
  // reloads (guarded by prevDayRef).
  const prevDayRef = useRef(dayOfWeek);
  useEffect(() => {
    if (prevDayRef.current === dayOfWeek) return;
    prevDayRef.current = dayOfWeek;
    if (currentView !== 'menu' || activeCollection == null) return;
    const stillVisible = navItems.some((item) =>
      isNavItemActive(item, { currentView, activeCollection, activeModule, activeScreen })
    );
    if (stillVisible) return;
    const first = sortNavItems(navItems)[0];
    if (first) {
      logger.info('fitness-nav-day-rollover-redirect', { day: dayOfWeek });
      handleNavigate(first.type, first.target, first);
    }
  }, [dayOfWeek, navItems, currentView, activeCollection, activeModule, activeScreen]);

  const queueSize = fitnessPlayQueue.length;
  useEffect(() => {
    logger.debug('fitness-view-state', { view: currentView, queueSize });
  }, [currentView, queueSize, logger]);

  // Menu music: active while browsing (not playing a video, not in a module)
  const menuMusicActive = (
    (currentView === 'menu' || currentView === 'show' || currentView === 'screen') &&
    fitnessPlayQueue.length === 0 &&
    activeModule == null &&
    !loading &&
    menuMusicTracks.length > 0
  );

  // Track changes on collection nav; stays stable when entering FitnessShow so music plays through.
  // Normalize to a primitive so an array activeCollection (collection_group) can't mint a
  // same-contents-new-reference key that triggers a spurious crossfade.
  const menuMusicTrackKey = Array.isArray(activeCollection) ? activeCollection.join(',') : activeCollection;

  // Menu music is driven by <MenuMusicController> (rendered inside FitnessProvider)
  // so it can read the voice-memo overlay state and duck while a memo is up.

  // render diagnostics removed
  
  return (
    <MantineProvider theme={{ colorScheme: 'dark' }}>
      <VolumeProvider>
        <FitnessProvider
          fitnessConfiguration={fitnessConfiguration}
          fitnessPlayQueue={fitnessPlayQueue}
          setFitnessPlayQueue={setFitnessPlayQueue}
          kioskMode={kioskUI}
        >
          <IdentityProvider>
          <GlobalOverlays />
          <FitnessFleetPublisher />
          {feedbackOpen && (
            <FitnessFeedback
              onClose={() => setFeedbackOpen(false)}
              view={currentView}
              userId={primaryUserId}
            />
          )}
          <EmergencyLockdownOverlay />
          <MenuMusicController
            isActive={menuMusicActive}
            trackChangeKey={menuMusicTrackKey}
            volume={menuMusicVolume}
            trackUrls={menuMusicTracks}
          />
          <EmergencyPlaybackController />
          {/* HR simulation panel trigger — available across the entire fitness
              app (history, suggestions, chart, menu, player). Self-gated to
              localhost or Chrome UA; hidden everywhere else. */}
          <HRSimTrigger />
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
                    activeModule,
                    activeScreen
                  }}
                  onNavigate={handleNavigate}
                />
              }
              hideNav={fitnessPlayQueue.length > 0 || loading}
              className={fitnessPlayQueue.length > 0 || loading ? 'fitness-frame--hidden' : ''}
            >
              <div className={`fitness-main-content ${currentView === 'users' ? 'fitness-cam-active' : ''}`}>
                {currentView === 'screen' && activeScreen && screensConfig[activeScreen] && (
                  <div className="screen-app">
                    <FitnessScreenProvider
                      onPlay={handleHomePlay}
                      onNavigate={handleNavigate}
                      onCtaAction={(cta) => logger.info('fitness-cta-action', { action: cta.action })}
                      initialSelectedSessionId={pendingSelectedSessionId}
                      onSelectedSessionConsumed={() => setPendingSelectedSessionId(null)}
                      roster={momentumRoster}
                      householdLabel={householdLabel}
                      windowDays={momentumWindowDays}
                      compareWeeks={momentumCompareWeeks}
                    >
                      <ScreenDataProvider sources={screenSources}>
                        <ScreenProvider config={{ ...screensConfig[activeScreen].layout, theme: screensConfig[activeScreen].theme }}>
                          <PanelRenderer />
                        </ScreenProvider>
                      </ScreenDataProvider>
                    </FitnessScreenProvider>
                  </div>
                )}
                {currentView === 'users' && (
                  <FitnessModuleContainer moduleId="fitness_session" mode="standalone" />
                )}
                {currentView === 'show' && selectedShow && (
                  <FitnessShow
                    showId={selectedShow}
                    episodeId={selectedEpisodeId}
                    onBack={handleBackToMenu}
                    viewportRef={viewportRef}
                    setFitnessPlayQueue={setFitnessPlayQueue}
                    onPlay={(episode) => {
                      const episodeId = String(episode.contentId || episode.plex || episode.id).replace(/^[a-z]+:/i, '');
                      if (episodeId) {
                        navigate(`/fitness/play/${episodeId}`, { replace: true });
                      }
                    }}
                  />
                )}
                {currentView === 'menu' && (
                  <>
                    <FitnessMenu
                      activeCollection={activeCollection}
                      onContentSelect={handleNavigate}
                    />
                    {/* Unobtrusive corner mic — opens the voice-feedback overlay.
                        Only on the home/menu view so it never overlaps player or
                        screen controls. */}
                    <FeedbackCornerButton onOpen={() => setFeedbackOpen(true)} />
                  </>
                )}
                {currentView === 'module' && activeModule && !activeModuleFullscreen && (
                  <FitnessModuleContainer
                    moduleId={activeModule.id}
                    mode="standalone"
                    onClose={handleModuleClose}
                  />
                )}
              </div>
            </FitnessFrame>

            {/* Fullscreen module overlay (e.g. the Game Boy emulator) — fills the
                whole .fitness-app-viewport over the nav, mirroring the player. */}
            {currentView === 'module' && activeModule && activeModuleFullscreen && (
              <div className="fitness-module-fullscreen-overlay" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }}>
                <FitnessModuleContainer
                  moduleId={activeModule.id}
                  mode="standalone"
                  onClose={handleModuleClose}
                />
              </div>
            )}

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
                  nogovern={nogovern}
                  onSessionEndRedirect={(redirect) => {
                    if (!redirect) return;
                    // Short browse-out from a show: the FitnessShow is still mounted
                    // behind the player overlay (currentView stayed 'show'), so just
                    // drop the player and reveal it with its preserved season/scroll
                    // state instead of clearing selectedShow and bouncing to home.
                    if (redirect.returnToShow && currentView === 'show' && selectedShow) {
                      navigate(`/fitness/show/${selectedShow}`, { replace: true });
                      return;
                    }
                    if (redirect.clearActiveModule) setActiveModule(null);
                    if (redirect.clearActiveCollection) setActiveCollection(null);
                    if (redirect.clearSelectedShow) {
                      setSelectedShow(null);
                      setSelectedEpisodeId(null);
                    }
                    setCurrentView(redirect.view);
                    if (redirect.view === 'screen' && redirect.screenId) {
                      setActiveScreen(redirect.screenId);
                      if (redirect.sessionId) {
                        setPendingSelectedSessionId(redirect.sessionId);
                      }
                      navigate(`/fitness/${redirect.screenId}`, { replace: true });
                    } else if (redirect.view === 'users') {
                      navigate('/fitness/users', { replace: true });
                    }
                  }}
                />
              </div>
            )}
          </div>
        </div>
          </IdentityProvider>
      </FitnessProvider>
    </VolumeProvider>
    </MantineProvider>
  );
};

// Fleet visibility: when the kiosk URL carries ?device=<id> (garage display:
// ?device=garage-tv, set in start-browser-kiosk.sh), publish live
// device-state so the /media Devices view shows what's playing here. The id
// must be explicit — a laptop opening /fitness must not impersonate the
// garage display. The binding reads the FitnessPlayer's registered Player
// ref via context; when no player is mounted the published state is idle.
// Device identity is captured at MODULE LOAD and persisted: the router
// immediately rewrites the URL to /fitness/home, dropping ?device=…, and
// every subsequent same-tab reload starts from the rewritten URL — reading
// location.search at mount time therefore silently loses the identity
// (2026-07-14: garage display connected but never published). localStorage
// re-asserts it across reloads; the kiosk launch URL re-asserts it across
// browser restarts.
const FLEET_DEVICE_KEY = 'fitness.fleetDeviceId';
const FLEET_DEVICE_ID = (() => {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('device');
    if (fromUrl) {
      localStorage.setItem(FLEET_DEVICE_KEY, fromUrl);
      return fromUrl;
    }
    return localStorage.getItem(FLEET_DEVICE_KEY);
  } catch {
    return null;
  }
})();

const FitnessFleetPublisher = () => {
  const fitnessCtx = useFitnessContext();
  const playerRefObj = fitnessCtx?.videoPlayerRef ?? null;
  usePlayerSessionBinding(() => playerRefObj?.current ?? null);
  return <DeviceStatePublisher deviceId={FLEET_DEVICE_ID} />;
};

const GlobalOverlays = () => {
  const fitnessCtx = useFitnessContext();
  if (!fitnessCtx) return null;

  return (
    <>
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
      <FitnessToast toast={fitnessCtx.fitnessToast} onDone={fitnessCtx.dismissFitnessToast} />
    </>
  );
};

export default FitnessApp;
