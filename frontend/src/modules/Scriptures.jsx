import { useState, useEffect, useRef } from "react";
import "./Scriptures.scss";
import { DaylightAPI, DaylightMediaPath } from "../lib/api.mjs";
import { lookupReference } from "scripture-guide";
import moment from "moment";
import paperBackground from "../assets/backgrounds/paper.jpg";
import { convertVersesToScriptureData } from "../lib/scripture-guide.jsx";

const config = {
  volumes: { ot: 1, nt: 23146, bom: 31103, dc: 37707, pgp: 41361, lof: 41996 },
  backgroundImage: paperBackground,
  randomMin: 1,
  randomMax: 115,
  fadeOutStep: 0.01,
  fadeOutInterval: 400,
  fadeInDelay: 5000,
  ambientVolume: 0.1,
};

const styleConfig = {
  scripturesContainer: { volume: 0.1 },
  textPanel: { backgroundImage: `url(${config.backgroundImage})` },
  controls: { width: "100%" },
  seekBarWrapper: { position: "relative" },
  totalTime: { pointerEvents: "none", position: "absolute", right: 0 },
};



function ScriptureText({ scriptureTextData, panelHeight, yProgress }) {
  const textRef = useRef(null);
  const [textHeight, setTextHeight] = useState(0);

  const scriptureData = convertVersesToScriptureData(scriptureTextData);

  useEffect(() => {
    if (textRef.current) {
      setTextHeight(textRef.current.clientHeight);
    }
  }, [blocks]);

  const YPosition = (yProgress * textHeight) - (panelHeight * yProgress);

  if (!scriptureTextData) {
    return null;
  }

  return (
    <div
      className="scripture-text"
      ref={textRef}
      style={{
        paddingBottom: `${panelHeight}px`,
        transform: `translateY(-${YPosition}px)`,
        backgroundImage: `url(${config.backgroundImage})`,
      }}
    >
      <pre>
        {JSON.stringify(scriptureData, null, 2)}
      </pre>
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

function ScriptureAudioPlayer({
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
  const musicRef = useRef(null);
  const [music] = useState(
    String(Math.floor(Math.random() * config.randomMax) + config.randomMin).padStart(3, "0")
  );
  const musicPath = DaylightMediaPath(`media/ambient/${music}`);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = 1;
    }
    if (musicRef.current) {
      musicRef.current.volume = config.ambientVolume;
    }
    const syncInterval = setInterval(() => {
      if (audioRef.current && !audioRef.current.paused) {
        setCurrentTime(audioRef.current.currentTime);
        if (audioRef.current.duration) {
          setProgress(audioRef.current.currentTime / audioRef.current.duration);
        }
      }
    }, 50);
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
    if (musicRef.current) {
      const fadeOut = setInterval(() => {
        if (musicRef.current.volume > config.fadeOutStep) {
          musicRef.current.volume -= config.fadeOutStep;
        } else {
          musicRef.current.volume = 0;
          clearInterval(fadeOut);
          advance();
        }
      }, config.fadeOutInterval);
    } else {
      advance();
    }
  };

  const startAudioAfterDelay = () => {
    if (musicRef.current) {
      musicRef.current.volume = config.ambientVolume;
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.play();
          musicRef.current.volume = config.ambientVolume;
        }
      }, config.fadeInDelay);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!audioRef.current) return;
      const duration = audioRef.current.duration;
      const increment = Math.max(5, duration / 30);
      event.preventDefault();
      if (event.key === "ArrowLeft") {
      const newT = Math.max(audioRef.current.currentTime - increment, 0);
      audioRef.current.currentTime = newT;
      setCurrentTime(newT);
      } else if (event.key === "ArrowRight") {
      const newT = Math.min(audioRef.current.currentTime + increment, duration);
      audioRef.current.currentTime = newT;
      setCurrentTime(newT);
      } else if (["Enter", " ","MediaPlayPause"].includes(event.key)) {
      if (audioRef.current.paused) {
        audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
      } else if (event.key === "Escape") {
      clear();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [duration, clear, setCurrentTime]);

  return (
    <div className="controls" style={styleConfig.controls}>
      <SeekBar currentTime={currentTime} duration={duration} onSeek={handleSeek} />
      <audio
        ref={audioRef}
        src={media}
        onEnded={handleEnded}
        onLoadedMetadata={handleLoadedMetadata}
      />
      <audio
        ref={musicRef}
        autoPlay
        src={musicPath}
        style={{ display: "none" }}
        onLoadedMetadata={startAudioAfterDelay}
      />
    </div>
  );
}

export default function Scriptures(play) {
  const { scripture, version = "redc", advance, clear } = play;
  const [{ ref, verse_ids: [verseId] }] = useState(() => lookupReference(scripture));
  const [titleHeader, setTitleHeader] = useState(ref);
  const [subtitle, setSubtitle] = useState(null);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const mediaPath = DaylightMediaPath(`media/scripture/${volume}/${version}/${verseId}`);
  const [scriptureTextData, setScriptureTextData] = useState(null);

  const yStartTime = 15;
  const movingTime = duration - yStartTime;
  const yProgress = currentTime < yStartTime ? 0 : (currentTime - yStartTime) / movingTime;

  useEffect(() => {
    //setBackFunction(()=>clear());
    DaylightAPI(`data/scripture/${volume}/${version}/${verseId}`).then((verses) => {
      setScriptureTextData(verses);
      const [{ headings: { title, subtitle: st } }] = verses;
      if (title) setTitleHeader(ref);
      setSubtitle([title, st].filter(Boolean).join(" • "));
    });
  }, [verseId, ref, version, volume]);

  const panelRef = useRef(null);
  const [init, setInit] = useState(true);
  const [panelHeight, setPanelHeight] = useState(0);

  useEffect(() => {
    if (panelRef.current) {
      setPanelHeight(panelRef.current.clientHeight);
    }
    setTimeout(() => setInit(false), 100);
  }, [scriptureTextData, duration]);

  return (
    <div className="scriptures" style={styleConfig.scripturesContainer}>
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
        <ScriptureText
          scriptureTextData={scriptureTextData}
          yProgress={yProgress}
          panelHeight={panelHeight}
        />
      </div>
      <ScriptureAudioPlayer
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
