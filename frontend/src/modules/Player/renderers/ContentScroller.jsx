
import React, {
    useState,
    useRef,
    useEffect,
    useCallback,
    useMemo
  } from "react";
  import moment from "moment";
  import "../styles/ContentScroller.scss";
import { DaylightAPI } from "../../../lib/api.mjs";
import paperBackground from "../../../assets/backgrounds/paper.jpg";
import { useMediaKeyboardHandler } from '../../../lib/Player/useMediaKeyboardHandler.js';
import { useDynamicDimensions } from '../../../lib/Player/useDynamicDimensions.js';
import { useMediaReporter } from '../hooks/useMediaReporter.js';
  
  /**
   * ContentScroller (superclass)
   * ----------------------------
   * Provides:
   *  - Scrolling text over time
   *  - Main media (audio or video) playback with optional ambient track
   *  - Seek bar (click to seek)
   *  - Keyboard shortcuts for seek, play/pause, exit
   *
   * Props:
   *  - type: string => helps with specific styling (e.g. "scriptures", "hymn", etc.)
   *  - className: optional extra class
   *  - title, subtitle: strings for headings
   *  - mainMediaUrl: string => audio or video source
   *  - isVideo: boolean => if true, uses <video>, else <audio>
   *  - ambientMediaUrl: optional string => background audio
   *  - ambientConfig: optional => { fadeOutStep, fadeOutInterval, fadeInDelay, ambientVolume, ... }
   *  - contentData: data for text content to be scrolled
   *  - parseContent: function(contentData) => JSX
   *  - onAdvance: function => called when main media ends
   *  - onClear: function => called on Escape key
   *  - yStartTime: number => seconds before scrolling starts
   *  - playbackKeys: object => keypad mappings for playback control
   *  - ignoreKeys: boolean => whether to ignore global key handling
   */
  
  export default function ContentScroller({
    type = "generic",
    className = "",
    assetId,
    title,ready,
    subtitle,
    mainMediaUrl,
    isVideo = false,
    mainVolume = 1,
    ambientMediaUrl,
    ambientConfig,
    contentData,
    parseContent,
    onAdvance,
    onClear,
    shaders,
    yStartTime = 15,
    playbackKeys = {},
    ignoreKeys = false,
    queuePosition = 0,  // Accept queuePosition from parent (Player)
    onPlaybackMetrics,
    onRegisterMediaAccess,
    seekToIntentSeconds = null,
    onSeekRequestConsumed,
    remountDiagnostics
  }) {
    // Refs for media elements
    const mainRef = useRef(null);
    const ambientRef = useRef(null);
    const {
      reportPlaybackMetrics,
      applyPendingSeek,
      clearPendingSeek
    } = useMediaReporter({
      mediaRef: mainRef,
      onPlaybackMetrics,
      onRegisterMediaAccess,
      seekToIntentSeconds,
      onSeekRequestConsumed,
      remountDiagnostics,
      mediaIdentityKey: mainMediaUrl
    });
  
    // Playback state
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [progress, setProgress] = useState(0);
    const [isSeeking, setIsSeeking] = useState(false);
    const seekTimerRef = useRef(null);
  
    // Use dynamic dimensions hook for layout measurement
    const {
      panelRef,
      contentRef,
      panelHeight,
      contentHeight
    } = useDynamicDimensions([contentData, duration]);



  const classes = Array.isArray(shaders)? shaders : ['regular', 'minimal', 'night', 'screensaver', 'dark'];
  const [shader, setShader] = useState(classes[0]);
  const cycleThroughClasses = (upOrDownInt) => {
    upOrDownInt = parseInt(upOrDownInt) || 1;
    setShader((prevClass) => {
      const currentIndex = classes.indexOf(prevClass);
      const newIndex = (currentIndex + upOrDownInt + classes.length) % classes.length;
      return classes[newIndex];
    }
    );
  };

    // Fade-in class
    const [init, setInit] = useState(true);
  
    // Ambient audio defaults
    const {
      fadeOutStep = 0.01,
      fadeOutInterval = 400,
      fadeInDelay = 5000,
      ambientVolume = 0.1
    } = ambientConfig || {};
  
    // Once we know main media's duration, we can do the scroll math
    const movingTime = Math.max(0, duration - yStartTime + 2);
    const yProgress =
      currentTime < yStartTime || movingTime <= 0
        ? 0
        : (currentTime - yStartTime) / movingTime;

    // Set init to false after first render
    useEffect(() => {
      setInit(false);
    }, []);

    useEffect(() => {
      reportPlaybackMetrics();
    }, [reportPlaybackMetrics]);

    // Logger for media progress
    const lastLoggedTimeRef = useRef(Date.now());

    const logTime = async (type, assetId, percent, title) => {
      const now = Date.now();
      const timeSinceLastLog = now - lastLoggedTimeRef.current;
      if (timeSinceLastLog > 10000 && parseFloat(percent) > 0) {
      lastLoggedTimeRef.current = now;
      const seconds = Math.round((duration * percent) / 100);
      await DaylightAPI(`api/v1/play/log`, { title, type, assetId, seconds, percent: Math.round(percent) });
      }
    };

    const onTimeUpdate = () => {
      const mainEl = mainRef.current;
      if (!mainEl || !duration) return;
      const percent = (mainEl.currentTime / duration) * 100;
      logTime(type, assetId, percent, title);
    };

    useEffect(() => {
      const mainEl = mainRef.current;
      if (!mainEl) return;

      mainEl.addEventListener('timeupdate', onTimeUpdate);
      return () => mainEl.removeEventListener('timeupdate', onTimeUpdate);
    }, [mainMediaUrl, duration, title]);

  
    // Keep time and progress in sync while playing
    useEffect(() => {
      const mainEl = mainRef.current;
      if (!mainEl) return () => {};

      const syncInterval = setInterval(() => {
        if (!mainEl.paused && !mainEl.ended) {
          setCurrentTime(mainEl.currentTime);
          if (mainEl.duration) {
            setProgress(mainEl.currentTime / mainEl.duration);
          }
          reportPlaybackMetrics();
        }
      }, 100);

      return () => clearInterval(syncInterval);
    }, [reportPlaybackMetrics]);
  
    const handleLoadedMetadata = useCallback(() => {
      const mainEl = mainRef.current;
      if (mainEl) {
        setDuration(mainEl.duration);
        
        // Apply volume using simple direct mapping
        if (mainVolume !== undefined) {
          let processedVolume = parseFloat(mainVolume || 100);
          if(processedVolume > 1) {
            processedVolume = processedVolume / 100; // Convert percentage to decimal
          }
          
          // Direct mapping - no complex volume curves
          const finalVolume = Math.min(1, Math.max(0, processedVolume));
          mainEl.volume = finalVolume;
        }
        if (!ambientMediaUrl) {
          mainEl.play().catch(() => {});
        }
        applyPendingSeek();
        reportPlaybackMetrics();
      }
    }, [mainVolume, applyPendingSeek, reportPlaybackMetrics, isVideo, ambientMediaUrl]);
  
    // Seek bar click => set new currentTime
    const handleSeekBarClick = (e) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const newTime = (offsetX / rect.width) * duration;

      if (mainRef.current) {
        // Disable scroll transition for instant jump
        setIsSeeking(true);
        clearTimeout(seekTimerRef.current);
        seekTimerRef.current = setTimeout(() => setIsSeeking(false), 100);

        mainRef.current.currentTime = newTime;
        setCurrentTime(newTime);
        clearPendingSeek();
        onSeekRequestConsumed?.();
        reportPlaybackMetrics();
      }
    };
  
    // When main media ends => optionally fade out ambient, then call onAdvance
    const handleEnded = useCallback(() => {
      if (ambientRef.current) {
        const fade = setInterval(() => {
          if (ambientRef.current.volume > fadeOutStep) {
            ambientRef.current.volume -= fadeOutStep;
          } else {
            ambientRef.current.volume = 0;
            clearInterval(fade);
            onAdvance && onAdvance();
          }
        }, fadeOutInterval);
      } else {
        onAdvance && onAdvance();
      }
    }, [fadeOutStep, fadeOutInterval, onAdvance]);
  
    // After ambient loaded, wait fadeInDelay before playing main
    const startAudioAfterDelay = useCallback(() => {
      if (!ambientRef.current) return;
      ambientRef.current.volume = ambientVolume;
      ambientRef.current.play().catch(() => {});
      setTimeout(() => {
        if (mainRef.current) {
          mainRef.current.play().catch(() => {});
          ambientRef.current.volume = ambientVolume;
        }
      }, fadeInDelay);
    }, [fadeInDelay, ambientVolume]);
  
    // Use centralized keyboard handler
    useMediaKeyboardHandler({
      mediaRef: mainRef,
      onEnd: onAdvance,
      onClear,
      cycleThroughClasses,
      playbackKeys,
      queuePosition, // Use the queuePosition passed from parent
      ignoreKeys,
      setCurrentTime // Pass state setter for time synchronization
    });    // If no ambient, try to play main right away
    useEffect(() => {
      if (!ambientMediaUrl && mainRef.current) {
        mainRef.current.play().catch(() => {});
      }
    }, [ambientMediaUrl]);
  
    // If user provides parseContent, use it; otherwise a fallback
    const renderedContent = parseContent
      ? parseContent(contentData)
      : (contentData || []).map((line, idx) => <p key={idx}>{line}</p>);
   
    // Final transform for scrolling with safeguards against jitter
    const yOffset = useMemo(() => {
      // Ensure we have valid dimensions before calculating
      if (!contentHeight || !panelHeight) return 0;
      
      // Calculate base offset
      const baseOffset = (yProgress * contentHeight) - (panelHeight * yProgress);
      
      // Clamp to reasonable bounds to prevent over-scrolling
      const maxOffset = Math.max(0, contentHeight - panelHeight);
      return Math.max(0, Math.min(maxOffset, baseOffset));
    }, [yProgress, contentHeight, panelHeight]); 
    return (
      <div className={`content-scroller ${type} ${className} ${shader}${isSeeking ? ' seeking' : ''}`} style={{
        backgroundImage: `url(${paperBackground})`,
        backgroundPosition: `0px ${-yOffset}px`
      }}>
        {(title || subtitle) && (
          <>
            {title && <h2>{title}</h2>}
            {subtitle && <h3>{subtitle}</h3>}
          </>
        )}
        <div className="content-container">

        {!!isVideo && <video
              ref={mainRef}
              src={mainMediaUrl}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={handleEnded}
            />}
        <div
          ref={panelRef}
          className={
            "textpanel" +
            (progress > 0.999 ? " fade-out" : "") +
            (init ? " init" : "")
          }
        >
          <div
            ref={contentRef}
            className={`scrolled-content${isSeeking ? ' seeking' : ''}`}
            style={{ position: "absolute", transform: `translateY(-${yOffset}px)` }}
          >
            {renderedContent}
          </div>
        </div>

        </div>
  
        {/* Seek + Controls */}
        <div className="controls">
          <div className="seek-bar" onClick={handleSeekBarClick}>
            <div
              className="seek-progress"
              style={{
                width: duration ? `${(currentTime / duration) * 100}%` : "0%"
              }}
            >
              <div className="current-time">
                {moment.utc(currentTime * 1000).format("mm:ss")}
              </div>
            </div>
            <div className="total-time" style={{ right: 0, position: "absolute" }}>
              {moment.utc(duration * 1000).format("mm:ss")}
            </div>
          </div>
  
          {/* Main media (audio or video) */}
          {!isVideo ? (
            <audio
              ref={mainRef}
              src={mainMediaUrl}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={handleEnded}
            />) : null }
  
          {/* Ambient media (optional) */}
          {ambientMediaUrl && (
            <audio
              ref={ambientRef}
              className="ambient"
              autoPlay
              src={ambientMediaUrl}
              style={{ display: "none" }}
              onLoadedMetadata={startAudioAfterDelay}
            />
          )}
        </div>
      </div>
    );
  }
