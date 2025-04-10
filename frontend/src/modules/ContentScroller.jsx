
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
          {isVideo ? (
            <video
              ref={mainRef}
              src={mainMediaUrl}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={handleEnded}
              style={{ display: "none" }}
            />
          ) : (
            <audio
              ref={mainRef}
              src={mainMediaUrl}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={handleEnded}
            />
          )}
  
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
  function findVolume(verseId) {
    const volumes = { ot: 1, nt: 23146, bom: 31103, dc: 37707, pgp: 41361, lof: 41996 };
    return Object.entries(volumes).reduce((prev, [name, id]) => {
      return verseId >= id ? name : prev;
    }) || "ot";
  }
  
  // This is the default export for Scriptures:
  export function Scriptures(play) {
    const { scripture, version = "redc", advance, clear } = play;
  
    // For computing verseId from reference
    const [{ ref, verse_ids: [verseId] }] = useState(() => lookupReference(scripture));
  
    // Title/Subtitle from scripture headings
    const [titleHeader, setTitleHeader] = useState(ref);
    const [subtitle, setSubtitle] = useState("");
  
    // Scripture text data
    const [scriptureTextData, setScriptureTextData] = useState(null);
  
    // Choose which volume
    const volume = findVolume(verseId);
  
    // Build main media URL
    const mainMediaUrl = DaylightMediaPath(`media/scripture/${volume}/${version}/${verseId}`);
  
    // Optional ambient track (random pick)
    const [music] = useState(
      String(Math.floor(Math.random() * 115) + 1).padStart(3, "0")
    );
    const ambientMediaUrl = DaylightMediaPath(`media/ambient/${music}`);
  
    // Fetch the scripture text data
    useEffect(() => {
      DaylightAPI(`data/scripture/${volume}/${version}/${verseId}`).then((verses) => {
        setScriptureTextData(verses);
        // Typically the first verse object has headings
        if (verses && verses[0]?.headings) {
          const { title, subtitle: st } = verses[0].headings;
          if (title) setTitleHeader(ref);
          setSubtitle([title, st].filter(Boolean).join(" • "));
        }
      });
    }, [verseId, ref, version, volume]);
  

    // Logic to build blocks and paragraphs
    const createBlocks = (data) => {
      return (data || []).reduce((all, verseData, i) => {
        const { headings, verse, text } = verseData || {};
        if (headings) {
          all.push({
            type: "heading",
            heading: headings.heading,
            background: headings.background,
            summary: headings.summary,
            key: `heading-${i}`,
          });
        }
        if (!text) return all;
  
        const plainText = text.replace(/[¶§｟｠]+/g, "");
        const newParagraph = /¶/.test(text);
        all.push({
          type: "verse",
          verse,
          text: plainText,
          newParagraph,
          key: `verse-${i}`,
        });
        return all;
      }, []);
    };
  
    const createChunks = (blocks) => {
      const chunks = [];
      let currentParagraph = [];
      blocks.forEach((b) => {
        if (b.type === "heading") {
          if (currentParagraph.length) {
            chunks.push({ type: "paragraph", content: [...currentParagraph] });
          }
          currentParagraph = [];
          chunks.push(b);
        } else {
          if (b.newParagraph && currentParagraph.length) {
            chunks.push({ type: "paragraph", content: [...currentParagraph] });
            currentParagraph = [b];
          } else {
            currentParagraph.push(b);
          }
        }
      });
      if (currentParagraph.length) {
        chunks.push({ type: "paragraph", content: [...currentParagraph] });
      }
      return chunks;
    };
  
    // parseContent for ContentScroller
    const parseScriptureContent = useCallback((allVerses) => {
      if (!allVerses) return null;
      const blocks = createBlocks(allVerses);
      const chunks = createChunks(blocks);
  
      return (
        <div className="scripture-text" style={{ backgroundImage: `url(${paperBackground})` }}>
          {chunks.map((chunk, i) => {
            if (chunk.type === "heading") {
              return (
                <div key={chunk.key} className="verse-headings">
                  {chunk.background && <p className="background">{chunk.background}</p>}
                  {chunk.summary && <p className="summary">{chunk.summary}</p>}
                  {chunk.heading && <h4 className="heading">{chunk.heading}</h4>}
                </div>
              );
            }
            // paragraph of verses
            return (
              <p key={`paragraph-${i}`}>
                {chunk.content.map((c) => (
                  <span key={c.key} className="verse">
                    <span className="verse-number">{c.verse}</span>
                    <span className="verse-text">{c.text}</span>
                  </span>
                ))}
              </p>
            );
          })}
        </div>
      );
    }, []);
  
    return (
      <ContentScroller
        type="scriptures"
        title={titleHeader}
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
      title,
      subtitle,
      videoUrl,
      ambientMusicUrl,
      transcriptData,
      advance,
      clear
    } = play;
  
    const parseTalkContent = useCallback((lines) => {
      if (!lines) return null;
      return (
        <div className="talk-transcript">
          {lines.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </div>
      );
    }, []);
  
    return (
      <ContentScroller
        type="talk"
        title={title}
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
        parseContent={parseTalkContent}
        onAdvance={advance}
        onClear={clear}
        yStartTime={30}
      />
    );
  }