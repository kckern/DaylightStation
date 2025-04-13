
import React, {
    useState,
    useRef,
    useEffect,
    useCallback
  } from "react";
  import moment from "moment";
  import "./ContentScroller.scss";
  import { lookupReference } from "scripture-guide";
import { DaylightAPI, DaylightMediaPath } from "../lib/api.mjs";
import paperBackground from "../assets/backgrounds/paper.jpg";
import { convertVersesToScriptureData, scriptureDataToJSX } from "../lib/scripture-guide.jsx";
  
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
   */
  
  export default function ContentScroller({
    type = "generic",
    className = "",
    media_key,
    title,ready,
    subtitle,
    mainMediaUrl,
    isVideo = false,
    ambientMediaUrl,
    ambientConfig,
    contentData,
    parseContent,
    onAdvance,
    onClear,
    yStartTime = 15
  }) {
    // Refs for media elements
    const mainRef = useRef(null);
    const ambientRef = useRef(null);
  
    // Playback state
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [progress, setProgress] = useState(0);
  
    // For measuring scrolled layout
    const panelRef = useRef(null);
    const contentRef = useRef(null);
    const [panelHeight, setPanelHeight] = useState(0);
    const [contentHeight, setContentHeight] = useState(0);

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
  
    // On mount or after data changes, measure the textpanel
    useEffect(() => {
      if (panelRef.current) {
        setPanelHeight(panelRef.current.clientHeight);
      }
      setInit(false);
    }, [panelRef, contentData, duration]);

    // Logger for media progress
    const lastLoggedTimeRef = useRef(Date.now());

    const logTime = async (type, id, percent, title) => {
      const now = Date.now();
      const timeSinceLastLog = now - lastLoggedTimeRef.current;
      if (timeSinceLastLog > 10000 && parseFloat(percent) > 0) {
      lastLoggedTimeRef.current = now;
      await DaylightAPI(`media/log`, { title, type, id:media_key, percent });
      }
    };

    const onTimeUpdate = () => {
      const mainEl = mainRef.current;
      if (!mainEl || !duration) return;
      const percent = (mainEl.currentTime / duration) * 100;
      logTime(type, mainMediaUrl, percent, title);
    };

    useEffect(() => {
      const mainEl = mainRef.current;
      if (!mainEl) return;

      mainEl.addEventListener('timeupdate', onTimeUpdate);
      return () => mainEl.removeEventListener('timeupdate', onTimeUpdate);
    }, [mainMediaUrl, duration, title]);
  
    // After content is rendered, measure the actual content height
    useEffect(() => {
      if (contentRef.current) {
        setContentHeight(contentRef.current.clientHeight);
      }
    }, [contentData]);
  
    // Keep time and progress in sync while playing
    useEffect(() => {
      const mainEl = mainRef.current;
      if (!mainEl) return;
  
      const syncInterval = setInterval(() => {
        if (!mainEl.paused && !mainEl.ended) {
          setCurrentTime(mainEl.currentTime);
          if (mainEl.duration) {
            setProgress(mainEl.currentTime / mainEl.duration);
          }
        }
      }, 100);
  
      return () => clearInterval(syncInterval);
    }, []);
  
    const handleLoadedMetadata = useCallback(() => {
      const mainEl = mainRef.current;
      if (mainEl) {
        setDuration(mainEl.duration);
      }
    }, []);
  
    // Seek bar click => set new currentTime
    const handleSeekBarClick = (e) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const newTime = (offsetX / rect.width) * duration;
  
      if (mainRef.current) {
        mainRef.current.currentTime = newTime;
        setCurrentTime(newTime);
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
      setTimeout(() => {
        if (mainRef.current) {
          mainRef.current.play().catch(() => {});
          ambientRef.current.volume = ambientVolume;
        }
      }, fadeInDelay);
    }, [fadeInDelay, ambientVolume]);
  
    // Keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (event) => {
        const mainEl = mainRef.current;
        if (!mainEl) return;
  
        const mainDuration = mainEl.duration || 0;
        const increment = Math.max(5, mainDuration / 30);
  
        switch (event.key) {
          case "ArrowLeft":
            event.preventDefault();
            {
              const newT = Math.max(mainEl.currentTime - increment, 0);
              mainEl.currentTime = newT;
              setCurrentTime(newT);
            }
            break;
          case "ArrowRight":
            event.preventDefault();
            {
              const newT = Math.min(mainEl.currentTime + increment, mainDuration);
              mainEl.currentTime = newT;
              setCurrentTime(newT);
            }
            break;
          case "Enter":
          case " ":
          case "MediaPlayPause":
            event.preventDefault();
            if (mainEl.paused) {
              mainEl.play().catch(() => {});
            } else {
              mainEl.pause();
            }
            break;
          case "Escape":
            event.preventDefault();
            onClear && onClear();
            break;
          default:
            break;
        }
      };
  
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClear]);
  
    // If no ambient, try to play main right away
    useEffect(() => {
      if (!ambientMediaUrl && mainRef.current) {
        mainRef.current.play().catch(() => {});
      }
    }, [ambientMediaUrl]);
  
    // If user provides parseContent, use it; otherwise a fallback
    const renderedContent = parseContent
      ? parseContent(contentData)
      : (contentData || []).map((line, idx) => <p key={idx}>{line}</p>);
  
    // Final transform for scrolling
    const yOffset = (yProgress * contentHeight) - (panelHeight * yProgress); 
    return (
      <div className={`content-scroller ${type} ${className}`} >
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
    const { scripture, advance, clear } = play;
    const [titleHeader, setTitleHeader] = useState("Loading...");
    const [subtitle, setSubtitle] = useState("");
    const [mainMediaUrl, setMainMediaUrl] = useState(null);
    const [media_key, setMediaKey] = useState(null);
    const [scriptureTextData, setScriptureTextData] = useState(null);
  
    const [music] = useState(
      String(Math.floor(Math.random() * 115) + 1).padStart(3, "0")
    );
    const ambientMediaUrl = DaylightMediaPath(`media/ambient/${music}`);
  
    // Fetch the scripture text data
    useEffect(() => {
      DaylightAPI(`data/scripture/${scripture}`).then(({reference, media_key,mediaUrl, verses}) => {
        setScriptureTextData(verses);
        setTitleHeader(reference);
        setMediaKey(media_key);
        setMainMediaUrl(mediaUrl);
        if (verses && verses[0]?.headings) {
          const { title, subtitle: st } = verses[0].headings;
          setSubtitle([title, st].filter(Boolean).join(" • "));
        }
      });
    }, [scripture]);
  

  
    // parseContent for ContentScroller
    const parseScriptureContent = useCallback((allVerses) => {
      if (!allVerses) return null;
      const data = convertVersesToScriptureData(allVerses);
  
      return (
        <div className="scripture-text" style={{ backgroundImage: `url(${paperBackground})` }}>
          {scriptureDataToJSX(data)}
        </div>
      );
    }, []);
  
    return (
      <ContentScroller
        type="scriptures"
        title={titleHeader}
        media_key={media_key}
        subtitle={subtitle}
        mainMediaUrl={mainMediaUrl}
        ambientMediaUrl={ambientMediaUrl}
        ambientConfig={{
          fadeOutStep: 0.01,
          fadeOutInterval: 400,
          fadeInDelay: 5000,
          ambientVolume: 0.1,
        }}
        contentData={scriptureTextData}
        parseContent={parseScriptureContent}
        onAdvance={advance}
        onClear={clear}
        /* Start scrolling after 15 seconds, same as original code */
        yStartTime={15}
      />
    );
  }
  
  /**
   * Hymns
   * -----
   * No ambient track, just a single audio. 
   */
  export function Hymns(play) {
    const { hymn, advance, clear } = play;
    const [title, setTitle] = useState("");
    const [subtitle, setSubtitle] = useState("");
    const [verses, setHymnVerses] = useState([]);
    const [hymnNum, setHymnNum] = useState(null);
    const [mediaUrl, setMediaUrl] = useState(null);
    const [duration, setDuration] = useState(0);
    const hymnTextRef = useRef(null);

    useEffect(() => {
        const path = hymn === true ? "data/hymn" : `data/hymn/${hymn}`;
        DaylightAPI(path).then(({title, hymn_num, mediaUrl, verses, duration}) => {
          setHymnVerses(verses);
          setTitle(title);
          setHymnNum(hymn_num);
          setMediaUrl(mediaUrl);
          setSubtitle(`Hymn #${hymn_num}`);
          setDuration(duration);
        });
    }, [hymn]);

    const parseHymnContent = useCallback((allVerses) => {
        useEffect(() => {
            const panelWidth = hymnTextRef.current.closest(".textpanel").offsetWidth; 
            const hymnTextWidth = hymnTextRef.current.offsetWidth;
            const diff = panelWidth - hymnTextWidth;
            const marginLeft = (diff) / 2;
            hymnTextRef.current.style.marginLeft = `${marginLeft}px`;
            },
         [allVerses]);

        return (
            <div className="hymn-text" ref={hymnTextRef}>
                {allVerses.map((stanza, sIdx) => (
                    <div key={`stanza-${sIdx}`} className="stanza">
                        {stanza.map((line, lIdx) => (
                            <p key={`line-${sIdx}-${lIdx}`} className="line">{line}</p>
                        ))}
                    </div>
                ))}
            </div>
        );
    }, []);
    if(!hymnNum) return null;
    const verseCount = verses.length;
    const yStartTime = (duration / verseCount) / 1.8;
    return (
      <ContentScroller
        type="hymn"
        title={title}
        subtitle={subtitle}
        mainMediaUrl={mediaUrl}
        contentData={verses}
        parseContent={parseHymnContent}
        onAdvance={advance}
        onClear={clear}
        yStartTime={yStartTime}
      />
    );
  }
  
  /**
   * Song
   * ----
   * Another single audio, no ambient. Karaoke or standard track.
   */
  export function Song(play) {
    const { title, subtitle, lyricsData, mediaUrl, advance, clear } = play;
  
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
      />
    );
  }
  
  /**
   * Audiobook
   * ---------
   * Single audio; text could be large paragraphs, entire chapter contents, etc.
   */
  export function Audiobook(play) {
    const { title, subtitle, textData, mediaUrl, advance, clear } = play;
  
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
      clear
    } = play;

    // Fetch the talk data
    const [title, setTitle] = useState("Loading...");
    const [subtitle, setSubtitle] = useState("");
    const [videoUrl, setVideoUrl] = useState(null);
    // Removed unused ambientMusicUrl state
    const [transcriptData, setTranscriptData] = useState(null);
    const [media_key, setMediaKey] = useState(null);

    useEffect(() => {

      DaylightAPI(`data/talk/${talk}`).then(({title, speaker, media_key, mediaUrl, content}) => {
        setTitle(title);
        setSubtitle(speaker);
        setVideoUrl(mediaUrl);
        setTranscriptData(content);
        setMediaKey(media_key);
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
    const ambientMusicUrl = `${DaylightMediaPath(`media/ambient/${String(Math.floor(Math.random() * 115) + 1).padStart(3, "0")}`)}`;
    return (
      <ContentScroller
        type="talk"
        title={title}
        media_key={media_key}
        subtitle={subtitle}
        mainMediaUrl={videoUrl}
        isVideo={true}
        ambientMediaUrl={ambientMusicUrl}
        ambientConfig={{
          fadeOutStep: 0.01,
          fadeOutInterval: 400,
          fadeInDelay: 3000,
          ambientVolume: 0.05
        }}
        contentData={transcriptData}
        parseContent={()=>content_jsx}
        onAdvance={advance}
        onClear={clear}
        yStartTime={30}
      />
    );
  }