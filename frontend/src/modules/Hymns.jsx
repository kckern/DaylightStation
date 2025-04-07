import { useState, useEffect, useRef } from "react";
import "./Scriptures.scss";
import { DaylightAPI, DaylightMediaPath } from "../lib/api.mjs";
import moment from "moment";
import paperBackground from "../assets/backgrounds/paper.jpg";

const config = {
  backgroundImage: paperBackground,
  fadeOutStep: 0.01,
  fadeOutInterval: 400,
};

const styleConfig = {
  hymnContainer: { volume: 0.1 },
  textPanel: { backgroundImage: `url(${config.backgroundImage})` },
  controls: { width: "100%" },
  seekBarWrapper: { position: "relative" },
  totalTime: { pointerEvents: "none", position: "absolute", right: 0 },
};




function HymnText({ verses, panelHeight, yProgress }) {
    const textRef = useRef(null);
    const [textHeight, setTextHeight] = useState(0);

    useEffect(() => {
        if (textRef.current) {
            setTextHeight(textRef.current.clientHeight);
        }
    }, [verses]);

    const YPosition = yProgress * textHeight - panelHeight * yProgress;

    if (!verses || !verses.length) {
        return null;
    }

    return (
      <div
        className="hymn-text"
        ref={textRef}
        style={{
          paddingBottom: `${panelHeight * .5}px`,
          paddingTop: `${panelHeight * .15}px`,
          transform: `translateY(-${YPosition}px)`,
          backgroundImage: `url(${config.backgroundImage})`,
        }}
      >
        {verses.map((stanza, stanzaIndex) => (
          <div key={`stanza-${stanzaIndex}`} className="stanza">
            {stanza.map((line, lineIndex) => (
              <p
                key={`line-${stanzaIndex}-${lineIndex}`}
                className="line"
                style={{
                  marginLeft: /^[a-z]/.test(line) ? "5rem" : "0",
                }}
              >
                {line}
              </p>
            ))}
          </div>
        ))}
      </div>
    );
}

function SeekBar({ currentTime, duration, onSeek }) {
  const handleBarClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const newTime = (offsetX / rect.width) * duration;
    onSeek(newTime);
  };

  return (
    <div className="seek-bar" style={styleConfig.seekBarWrapper} onClick={handleBarClick}>
      <div
        className="seek-progress"
        style={{
          width: currentTime ? `${(currentTime / duration) * 100}%` : "0%",
        }}
      >
        <div className="current-time">
          {moment.utc(currentTime * 1000).format("mm:ss")}
        </div>
      </div>
      <div className="total-time" style={styleConfig.totalTime}>
        {moment.utc(duration * 1000).format("mm:ss")}
      </div>
    </div>
  );
}

function HymnAudioPlayer({
  media,
  setProgress,
  duration,
  setDuration,
  advance,
  currentTime,
  setCurrentTime,
  clear,
}) {
  const audioRef = useRef(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = 1;
    }
    const syncInterval = setInterval(() => {
      if (audioRef.current && !audioRef.current.paused) {
        setCurrentTime(audioRef.current.currentTime);
        if (audioRef.current.duration) {
          setProgress(audioRef.current.currentTime / audioRef.current.duration);
        }
      }
    }, 100);
    return () => clearInterval(syncInterval);
  }, [media, setProgress, setCurrentTime]);

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (newTime) => {
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleEnded = () => {
    // No ambient audio to fade out. Just move on.
    advance();
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!audioRef.current) return;
      const audioDuration = audioRef.current.duration || 0;
      const increment = Math.max(5, audioDuration / 30);

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          {
            const newT = Math.max(audioRef.current.currentTime - increment, 0);
            audioRef.current.currentTime = newT;
            setCurrentTime(newT);
          }
          break;
        case "ArrowRight":
          event.preventDefault();
          {
            const newT = Math.min(audioRef.current.currentTime + increment, audioDuration);
            audioRef.current.currentTime = newT;
            setCurrentTime(newT);
          }
          break;
        case "Enter":
        case " ":
        case "MediaPlayPause":
          event.preventDefault();
          if (audioRef.current.paused) {
            audioRef.current.play();
          } else {
            audioRef.current.pause();
          }
          break;
        case "Escape":
          event.preventDefault();
          clear();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [advance, clear, setCurrentTime]);

  return (
    <div className="controls" style={styleConfig.controls}>
      <SeekBar currentTime={currentTime} duration={duration} onSeek={handleSeek} />
      <audio
        ref={audioRef}
        src={media}
        onEnded={handleEnded}
        onLoadedMetadata={handleLoadedMetadata}
        autoPlay
      />
    </div>
  );
}

export default function Hymns(play) {
  const { hymn, advance, clear } = play;
  const [titleHeader, setTitleHeader] = useState(`Hymn #${hymn}`);
  const [subtitle, setSubtitle] = useState(null);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [hymnVerses, setHymnVerses] = useState(null);
  const [yStartTime, setYStartTime] = useState(15);

  const yProgress = (() => {
    const movingTime = duration - yStartTime;
    return currentTime < yStartTime ? 0 : (currentTime - yStartTime) / movingTime;
  })();

  const hymn_num = hymn.toString().padStart(3, "0");
  const mediaPath = DaylightMediaPath(`media/songs/hymn/${hymn_num}`);


  useEffect(() => {

    const verseCount = hymnVerses?.length || 0;
    if(!!verseCount && !!duration) setYStartTime( (duration / verseCount) / 1.8);

  },[duration,hymnVerses])

  useEffect(() => {
    DaylightAPI(`data/hymn/${hymn}`).then(({title,hymn_num,verses}) => {
      setHymnVerses(verses);
      setTitleHeader(title);
      setSubtitle(`Hymn #${hymn_num}`);
    });
  }, [hymn]);

  const panelRef = useRef(null);
  const [init, setInit] = useState(true);
  const [panelHeight, setPanelHeight] = useState(0);

  useEffect(() => {
    if (panelRef.current) {
      setPanelHeight(panelRef.current.clientHeight);
    }
    setTimeout(() => setInit(false), 100);
  }, [hymnVerses, duration]);

  return (
    <div className="hymn" style={styleConfig.hymnContainer}>
      <h2>{titleHeader}</h2>
      {subtitle && <h3>{subtitle}</h3>}
      <div
        ref={panelRef}
        style={styleConfig.textPanel}
        className={
          "textpanel" +
          (progress > 0.999 ? " fade-out" : "") +
          (init ? " init" : "")
        }
      >
        <HymnText verses={hymnVerses} yProgress={yProgress} panelHeight={panelHeight} />
      </div>
      <HymnAudioPlayer
        media={mediaPath}
        setProgress={setProgress}
        setDuration={setDuration}
        duration={duration}
        advance={advance}
        currentTime={currentTime}
        setCurrentTime={setCurrentTime}
        clear={clear}
      />
    </div>
  );
}