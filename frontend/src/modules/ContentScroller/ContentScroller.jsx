
import React, {
    useState,
    useRef,
    useEffect,
    useCallback,
    useMemo
  } from "react";
  import moment from "moment";
  import "./ContentScroller.scss";
import { DaylightAPI, DaylightMediaPath } from "../../lib/api.mjs";
import { useCenterByWidest } from '../../lib/Player/useCenterByWidest.js';
import paperBackground from "../../assets/backgrounds/paper.jpg";
import { convertVersesToScriptureData, scriptureDataToJSX } from "../../lib/scripture-guide.jsx";
import { useMediaKeyboardHandler } from '../../lib/Player/useMediaKeyboardHandler.js';
import { useDynamicDimensions } from '../../lib/Player/useDynamicDimensions.js';
import { useMediaReporter } from '../Player/hooks/useMediaReporter.js';
  
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
      <div className={`content-scroller ${type} ${className} ${shader}`} style={{ 
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
            className="scrolled-content"
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
  
  /* -----------------------------------------------------------------------
     Subclass / Variant Components
     Each receives (play) => destructured into { advance, clear, ... }
     and then returns <ContentScroller/> with specialized data & parse logic.
     ----------------------------------------------------------------------- */
  
  /**
   * Scriptures
   * ----------
   * Example that uses an ambient background track plus a specialized parseContent
   * for headings and verses. 
   */
  
  // This is the default export for Scriptures:
  export function Scriptures(play) {
      const {
        scripture,
        advance,
        clear,
        volume,
        playbackKeys,
        ignoreKeys,
        queuePosition,
        onPlaybackMetrics,
        onRegisterMediaAccess,
        seekToIntentSeconds,
        onSeekRequestConsumed,
        remountDiagnostics
      } = play;
    const [titleHeader, setTitleHeader] = useState("Loading...");
    const [subtitle, setSubtitle] = useState("");
    const [mainMediaUrl, setMainMediaUrl] = useState(null);
    const [assetId, setMediaKey] = useState(null);
    const [scriptureTextData, setScriptureTextData] = useState(null);
  
    const [music] = useState(
      String(Math.floor(Math.random() * 115) + 1).padStart(3, "0")
    );
    const ambientMediaUrl = DaylightMediaPath(`media/audio/ambient/${music}`);

    // Process volume parameter for both main and ambient audio
    const mainVolume = (() => {
      if (!volume) return 1; // default
      let processedVolume = parseFloat(volume);
      if(processedVolume > 1) {
        processedVolume = processedVolume / 100; // Convert percentage to decimal
      }
      return Math.min(1, Math.max(0, processedVolume));
    })();

    const ambientVolume = (() => {
      if (!volume) return 0.1; // default
      let processedVolume = parseFloat(volume);
      if(processedVolume > 1) {
        processedVolume = processedVolume / 100; // Convert percentage to decimal
      }
      
      // Make ambient volume always 10% of the main volume
      const proportionalAmbient = processedVolume * 0.1; // Always 10% of main volume
      const finalVolume = Math.max(0.001, proportionalAmbient); // Ensure minimum audible volume
      
      return finalVolume;
    })();
    const ambientFadeInDelayMs = 750;
  
    // Fetch the scripture text data
    useEffect(() => {
      console.log('Scriptures useEffect triggered with scripture:', scripture);
      if (!scripture) {
        console.log('No scripture parameter provided');
        return;
      }
      
      console.log('Making API call to:', `api/v1/local-content/scripture/${scripture}`);
      DaylightAPI(`api/v1/local-content/scripture/${scripture}`).then(({reference, assetId,mediaUrl, verses}) => {
        console.log('Scripture API response:', {reference, assetId, mediaUrl, verses: verses?.length});
        setScriptureTextData(verses);
        setTitleHeader(reference);
        setMediaKey(assetId);
        setMainMediaUrl(mediaUrl);
        if (verses && verses[0]?.headings) {
          const { title, subtitle: st } = verses[0].headings;
          setSubtitle([title, st].filter(Boolean).join(" • "));
        }
      }).catch(error => {
        console.error('Scripture API call failed:', error);
      });
    }, [scripture]);
  

  
    // parseContent for ContentScroller
    const parseScriptureContent = useCallback((allVerses) => {
      if (!allVerses) return null;
      const data = convertVersesToScriptureData(allVerses);
  
      return (
        <div className="scripture-text">
          {scriptureDataToJSX(data)}
        </div>
      );
    }, []);
  
    return (
      <ContentScroller
        key={`scripture-${scripture}-${assetId}`} // Force re-render when scripture changes
        type="scriptures"
        title={titleHeader}
        assetId={assetId}
        subtitle={subtitle}
        mainMediaUrl={mainMediaUrl}
        mainVolume={mainVolume}
        shaders={['regular', 'minimal', 'night', 'screensaver', 'dark']}
        ambientMediaUrl={ambientMediaUrl}
        ambientConfig={{
          fadeOutStep: 0.01,
          fadeOutInterval: 400,
          fadeInDelay: ambientFadeInDelayMs,
          ambientVolume: ambientVolume,
        }}
        contentData={scriptureTextData}
        parseContent={parseScriptureContent}
        onAdvance={advance}
        onClear={clear}
        playbackKeys={playbackKeys}
        ignoreKeys={ignoreKeys}
        queuePosition={queuePosition}
        /* Start scrolling after 15 seconds, same as original code */
        yStartTime={15}
        onPlaybackMetrics={onPlaybackMetrics}
        onRegisterMediaAccess={onRegisterMediaAccess}
        seekToIntentSeconds={seekToIntentSeconds}
        onSeekRequestConsumed={onSeekRequestConsumed}
        remountDiagnostics={remountDiagnostics}
      />
    );
  }
  
  /**
   * Hymns
   * -----
   * No ambient track, just a single audio. 
   */
  export function Hymns(play) {
    const {
      hymn,
      advance,
      clear,
      subfolder,
      volume,
      playbackKeys,
      ignoreKeys,
      queuePosition,
      onResolvedMeta,
      onPlaybackMetrics,
      onRegisterMediaAccess,
      seekToIntentSeconds,
      onSeekRequestConsumed,
      remountDiagnostics
    } = play;
    const [title, setTitle] = useState("");
    const [subtitle, setSubtitle] = useState("");
    const [verses, setHymnVerses] = useState([]);
    const [hymnNum, setHymnNum] = useState(null);
    const [mediaUrl, setMediaUrl] = useState(null);
    const [duration, setDuration] = useState(0);
    const [assetId, setMediaKey] = useState(null);
    const hymnTextRef = useRef(null);
    const folder = subfolder || `hymn`;
    // Normalize the incoming hymn identifier by trimming any leading zeros (e.g. "007" -> "7")
    // Keep boolean true (random/next?) untouched. Numbers are already normalized.
    const normalizedHymn = (() => {
      if (hymn === true) return hymn;
      if (hymn === null || hymn === undefined) return hymn;
      if (typeof hymn === 'number') return hymn; // already numeric
      if (typeof hymn === 'string') {
        const trimmed = hymn.replace(/^0+/, '');
        return trimmed === '' ? '0' : trimmed; // safeguard if value was all zeros
      }
      return hymn;
    })();

    useEffect(() => {
        console.log(`Loading hymn: raw=${hymn} normalized=${normalizedHymn} from folder: ${folder}`);
        const path = normalizedHymn === true ? `api/v1/local-content/${folder}` : `api/v1/local-content/${folder}/${normalizedHymn}`;
        DaylightAPI(path).then((response) => {
          console.log(`Hymn API response:`, response);
          const {title, hymn_num, song_number, mediaUrl, verses, duration} = response;
          const num = hymn_num || song_number;
          setHymnVerses(verses);
          setTitle(title);
          setHymnNum(num);
          setMediaUrl(mediaUrl);
          setSubtitle(`${folder==="hymn" ? "Hymn " : "Song "}#${num}`);
          setMediaKey(`${folder}/${num}`);
          setDuration(duration);
        });
    }, [hymn, normalizedHymn, folder]);

    useEffect(() => {
      if (!onResolvedMeta) return;
      if (!assetId || !mediaUrl || !title) return;
      onResolvedMeta({
        assetId,
        mediaType: 'audio',
        title,
        subtitle,
        plex: assetId,
        duration,
        hymnNum: hymnNum,
        type: folder,
        seconds: 0
      });
    }, [onResolvedMeta, assetId, mediaUrl, title, subtitle, hymnNum, duration, folder]);

    // Apply centering behavior once verses/hymnNum change
    useCenterByWidest(hymnTextRef, [verses, hymnNum]);

    const parseHymnContent = useCallback((allVerses) => (
      <div className="hymn-text" ref={hymnTextRef}>
        {allVerses.map((stanza, sIdx) => (
          <div key={`stanza-${sIdx}`} className="stanza">
            {stanza.map((line, lIdx) => (
              <p key={`line-${sIdx}-${lIdx}`} className="line">{line}</p>
            ))}
          </div>
        ))}
      </div>
    ), []);
    if(!hymnNum) return null;
    const verseCount = verses.length;
    const yStartTime = (duration / verseCount) / 1.8;
    
    // Process volume parameter (same logic as in useCommonMediaController)
    const mainVolume = (() => {
      if (!volume) return 1; // default for hymns
      let processedVolume = parseFloat(volume);
      if(processedVolume < 1 && processedVolume > 0) {
        processedVolume = processedVolume * 100;
      }
      if(processedVolume === 1) {
        processedVolume = 100;
      }
      return processedVolume / 100;
    })();
    
    return (
      <ContentScroller
        key={`hymn-${normalizedHymn}-${hymnNum}`} // Force re-render when hymn changes (normalized)
        type="hymn"
        title={title}
        assetId={assetId}
        subtitle={subtitle}
        mainMediaUrl={mediaUrl}
        mainVolume={mainVolume}
        contentData={verses}
        parseContent={parseHymnContent}
        onAdvance={advance}
        onClear={clear}
        playbackKeys={playbackKeys}
        ignoreKeys={ignoreKeys}
        queuePosition={queuePosition}
        yStartTime={yStartTime}
        onPlaybackMetrics={onPlaybackMetrics}
        onRegisterMediaAccess={onRegisterMediaAccess}
        seekToIntentSeconds={seekToIntentSeconds}
        onSeekRequestConsumed={onSeekRequestConsumed}
        remountDiagnostics={remountDiagnostics}
      />
    );
  }
  
  /**
   * Song
   * ----
   * Another single audio, no ambient. Karaoke or standard track.
   */
  export function Song(play) {
    const {
      title,
      subtitle,
      lyricsData,
      mediaUrl,
      advance,
      clear,
      onPlaybackMetrics,
      onRegisterMediaAccess,
      seekToIntentSeconds,
      onSeekRequestConsumed,
      remountDiagnostics
    } = play;
  
    const parseSongContent = useCallback((lyrics) => {
      if (!lyrics) return null;
      return (
        <div className="song-lyrics">
          {lyrics.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      );
    }, []);
  
    return (
      <ContentScroller
        type="song"
        title={title}
        subtitle={subtitle}
        mainMediaUrl={mediaUrl}
        contentData={lyricsData}
        parseContent={parseSongContent}
        onAdvance={advance}
        onClear={clear}
        yStartTime={10}
        onPlaybackMetrics={onPlaybackMetrics}
        onRegisterMediaAccess={onRegisterMediaAccess}
        seekToIntentSeconds={seekToIntentSeconds}
        onSeekRequestConsumed={onSeekRequestConsumed}
        remountDiagnostics={remountDiagnostics}
      />
    );
  }
  
  /**
   * Audiobook
   * ---------
   * Single audio; text could be large paragraphs, entire chapter contents, etc.
   */
  export function Audiobook(play) {
    const {
      title,
      subtitle,
      textData,
      mediaUrl,
      advance,
      clear,
      onPlaybackMetrics,
      onRegisterMediaAccess,
      seekToIntentSeconds,
      onSeekRequestConsumed,
      remountDiagnostics
    } = play;
  
    const parseBookContent = useCallback((paras) => {
      if (!paras) return null;
      return (
        <div className="audiobook-text">
          {paras.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      );
    }, []);
  
    return (
      <ContentScroller
        type="audiobook"
        title={title}
        subtitle={subtitle}
        mainMediaUrl={mediaUrl}
        contentData={textData}
        parseContent={parseBookContent}
        onAdvance={advance}
        onClear={clear}
        yStartTime={20}
        onPlaybackMetrics={onPlaybackMetrics}
        onRegisterMediaAccess={onRegisterMediaAccess}
        seekToIntentSeconds={seekToIntentSeconds}
        onSeekRequestConsumed={onSeekRequestConsumed}
        remountDiagnostics={remountDiagnostics}
      />
    );
  }
  
  /**
   * Talk
   * ----
   * Video-based content with optional ambient track.
   */
  export function Talk(play) {
    const {
      talk,
      advance,
      clear,
      volume,
      playbackKeys,
      ignoreKeys,
      queuePosition,
      onPlaybackMetrics,
      onRegisterMediaAccess,
      seekToIntentSeconds,
      onSeekRequestConsumed,
      remountDiagnostics
    } = play;

    // Fetch the talk data
    const [title, setTitle] = useState("Loading...");
    const [subtitle, setSubtitle] = useState("");
    const [videoUrl, setVideoUrl] = useState(null);
    const [transcriptData, setTranscriptData] = useState(null);
    const [assetId, setMediaKey] = useState(null);
    const [ambientTrack] = useState(
      String(Math.floor(Math.random() * 115) + 1).padStart(3, "0")
    );

    useEffect(() => {

      DaylightAPI(`api/v1/local-content/talk/${talk}`).then(({title, speaker, assetId, mediaUrl, content}) => {
        setTitle(title);
        setSubtitle(speaker);
        setVideoUrl(mediaUrl);
        setTranscriptData(content);
        setMediaKey(assetId);
      });
    }
    , [talk]);

    
    if(!videoUrl) return null;

  const content_jsx = (
    <div className="talk-text">
    {transcriptData.map((line, idx) => {
      if (line.startsWith("##")) {
      return <h4 key={idx}>{line.slice(2).trim()}</h4>;
      }
      if (line.includes("©")) {
      return null;
      }
      return <p key={idx}>{line}</p>;
    })}
    </div>
  );
    const ambientMusicUrl = DaylightMediaPath(`media/audio/ambient/${ambientTrack}`);

    // Process volume parameter for both main video and ambient audio
    const processVolumeForTalk = (defaultValue) => {
      if (!volume) return defaultValue;
      let processedVolume = parseFloat(volume);
      if(processedVolume > 1) {
        processedVolume = processedVolume / 100; // Convert percentage to decimal
      }
      
      // Direct mapping - no complex volume curves
      return Math.min(1, Math.max(0, processedVolume));
    };
    
    const mainVolume = processVolumeForTalk(1); // Default to full volume for main video
    
    // Make ambient volume always 10% of main volume
    const ambientVolume = (() => {
      if (!volume) return 0.1; // default 10% when no volume specified
      const proportionalAmbient = mainVolume * 0.1; // Always 10% of main volume
      return Math.max(0.001, proportionalAmbient); // Ensure minimum audible volume
    })();
    const ambientFadeInDelayMs = 750;
    
    return (
      <ContentScroller
        key={`talk-${talk}-${assetId}`} // Force re-render when talk changes
        type="talk"
        title={title}
        assetId={assetId}
        subtitle={subtitle}
        mainMediaUrl={videoUrl}
        mainVolume={mainVolume}
        isVideo={true}
        shaders={['regular', 'minimal', 'night', 'video', 'text', 'screensaver', 'dark']}
        ambientMediaUrl={ambientMusicUrl}
        ambientConfig={{
          fadeOutStep: 0.01,
          fadeOutInterval: 400,
          fadeInDelay: ambientFadeInDelayMs,
          ambientVolume: ambientVolume
        }}
        contentData={transcriptData}
        parseContent={()=>content_jsx}
        onAdvance={advance}
        onClear={clear}
        playbackKeys={playbackKeys}
        ignoreKeys={ignoreKeys}
        queuePosition={queuePosition}
        yStartTime={30}
        onPlaybackMetrics={onPlaybackMetrics}
        onRegisterMediaAccess={onRegisterMediaAccess}
        seekToIntentSeconds={seekToIntentSeconds}
        onSeekRequestConsumed={onSeekRequestConsumed}
        remountDiagnostics={remountDiagnostics}
      />
    );
  }

  /**
   * Poetry
   * ------
   * Audio-based poetry reading with scrolling text, similar to Hymns.
   */
  export function Poetry(play) {
    console.log('Poetry component called with play:', play);
    const {
      poem,
      advance,
      clear,
      volume,
      playbackKeys,
      ignoreKeys,
      queuePosition,
      onPlaybackMetrics,
      onRegisterMediaAccess,
      seekToIntentSeconds,
      onSeekRequestConsumed,
      remountDiagnostics
    } = play;
    console.log('Poetry destructured values:', { poem, volume, playbackKeys, ignoreKeys, queuePosition });
    
    const [title, setTitle] = useState("");
    const [subtitle, setSubtitle] = useState("");
    const [verses, setPoetryVerses] = useState([]);
    const [poemID, setPoemID] = useState(null);
    const [mediaUrl, setMediaUrl] = useState(null);
    const [duration, setDuration] = useState(0);
    const [assetId, setMediaKey] = useState(null);
    const poetryTextRef = useRef(null);

    useEffect(() => {
      console.log('Poetry useEffect triggered with poem:', poem);
      if (!poem) {
        console.log('No poem parameter provided');
        return;
      }
      
      let poem_id = poem.toString().padStart(3, "0");
      
      // If poem_id doesn't end with a digit, append a random 2-digit number from 01-74
      if (!/\d$/.test(poem_id)) {
        const randomSuffix = String(Math.floor(Math.random() * 74) + 1).padStart(2, "0");
        poem_id = (poem_id + "/" + randomSuffix).replace("//", "/");
      }
      
      console.log('Making API call to:', `api/v1/local-content/poem/${poem_id}`);

      DaylightAPI(`api/v1/local-content/poem/${poem_id}`).then(({title, author, condition, also_suitable_for, poem_id: apiPoemId, verses, duration}) => {
        console.log('Poetry API response:', {title, poem_id: apiPoemId, verses: verses?.length, duration});
        
        // Use the API poem_id if available, otherwise fall back to our calculated poem_id
        const finalPoemId = apiPoemId || poem_id;
        console.log('Using poem ID:', finalPoemId, 'from API:', apiPoemId, 'calculated:', poem_id);
        
        setPoetryVerses(verses);
        setTitle(`${title} (${author})`);
        setPoemID(finalPoemId);
        setMediaUrl(DaylightMediaPath(`media/audio/poetry/${finalPoemId}`));
        setSubtitle([condition, ...(also_suitable_for || [])].filter(Boolean).join(" • "));
        setMediaKey(`audio/poetry/${finalPoemId}`);
        setDuration(duration);
        console.log('Poetry state updated with:', {
          title,
          poemID: finalPoemId,
          mediaUrl: DaylightMediaPath(`media/audio/poetry/${finalPoemId}`),
          subtitle: `Poem #${finalPoemId}`,
          assetId: `audio/poetry/${finalPoemId}`,
          duration,
          versesLength: verses?.length
        });
      }).catch(error => {
        console.error('Poetry API call failed:', error);
      });
    }, [poem]);

    // Apply width + centering when verses / poemID change
    useCenterByWidest(poetryTextRef, [verses, poemID]);

    const parsePoetryContent = useCallback((allVerses) => {
      if (!allVerses || !allVerses.length) return null;
      return (
        <div className="poetry-text" ref={poetryTextRef}>
          {allVerses.map((stanza, sIdx) => (
            <div key={`stanza-${sIdx}`} className="stanza">
              {stanza.map((line, lIdx) => (
                <p
                  key={`line-${sIdx}-${lIdx}`}
                  className="line"
                  style={{ marginLeft: /^[a-z]/.test(line) ? '2rem' : '0' }}
                >
                  {line}
                </p>
              ))}
            </div>
          ))}
        </div>
      );
    }, []);

    console.log('Poetry render check - poemID:', poemID, 'verses:', verses?.length, 'title:', title, 'mediaUrl:', mediaUrl);
    
    if(!poemID) {
      console.log('Poetry returning null - no poemID');
      return null;
    }
    
    // Process volume parameter (same logic as Hymns)
    const mainVolume = (() => {
      if (!volume) return 1; // default for poetry
      let processedVolume = parseFloat(volume);
      if(processedVolume < 1 && processedVolume > 0) {
        processedVolume = processedVolume * 100;
      }
      if(processedVolume === 1) {
        processedVolume = 100;
      }
      return processedVolume / 100;
    })();
    
    console.log('Poetry about to render ContentScroller with:', {
      type: "poetry",
      title,
      assetId,
      subtitle,
      mainMediaUrl: mediaUrl,
      mainVolume,
      contentData: verses
    });
    
    return (
      <ContentScroller
        key={`poetry-${poem}-${poemID}`} // Force re-render when poem changes
        type="poetry"
        title={title}
        assetId={assetId}
        subtitle={subtitle}
        mainMediaUrl={mediaUrl}
        mainVolume={mainVolume}
        contentData={verses}
        parseContent={parsePoetryContent}
        onAdvance={advance}
        onClear={clear}
        playbackKeys={playbackKeys}
        ignoreKeys={ignoreKeys}
        queuePosition={queuePosition}
        yStartTime={15}
        onPlaybackMetrics={onPlaybackMetrics}
        onRegisterMediaAccess={onRegisterMediaAccess}
        seekToIntentSeconds={seekToIntentSeconds}
        onSeekRequestConsumed={onSeekRequestConsumed}
        remountDiagnostics={remountDiagnostics}
      />
    );
  }