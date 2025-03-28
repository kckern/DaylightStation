import { useState, useEffect, useRef } from "react";
import "./Scriptures.scss";
import { DaylightAPI, DaylightMediaPath } from "../lib/api.mjs";
import { lookupReference } from "scripture-guide";
import moment from "moment";
import paperBackground from "../assets/backgrounds/paper.jpg";

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
  seekProgress: { position: "absolute", top: 0, left: 0, height: "100%", backgroundColor: "#6c584c66", display: "flex", justifyContent: "flex-end" },
  currentTime: {},
  totalTime: { pointerEvents: "none", position: "absolute", right: 0 },
};

function findVolume(verseId) {
  return Object.entries(config.volumes).reduce((prev, curr) => (verseId >= curr[1] ? curr : prev))[0];
}

function textProgress(progress, duration) {
  const cutoff = 15 / duration;
  if (progress < cutoff) return 0;
  if (progress < 1) return (progress - cutoff) / (1 - cutoff);
  return 1;
}

function createBlocks(scriptureTextData) {
  return scriptureTextData.reduce((all, verseData, i) => {
    const { headings, verse, text } = verseData || {};
    if (headings) all.push({ type: "heading", heading: headings.heading, background: headings.background, summary: headings.summary, key: `heading-${i}` });
    const plainText = text.replace(/[¶§｟｠]+/g, "");
    const newParagraph = /¶/.test(text);
    all.push({ type: "verse", verse, text: plainText, newParagraph, key: `verse-${i}` });
    return all;
  }, []);
}

function createChunks(blocks) {
  const chunks = [];
  let currentParagraph = [];
  blocks.forEach((b) => {
    if (b.type === "heading") {
      if (currentParagraph.length) chunks.push({ type: "paragraph", content: [...currentParagraph] });
      currentParagraph = [];
      chunks.push(b);
    } else {
      if (b.newParagraph && currentParagraph.length) {
        chunks.push({ type: "paragraph", content: [...currentParagraph] });
        currentParagraph = [b];
      } else currentParagraph.push(b);
    }
  });
  if (currentParagraph.length) chunks.push({ type: "paragraph", content: [...currentParagraph] });
  return chunks;
}

function ScriptureText({ scriptureTextData, progress, panelHeight }) {
  if (!scriptureTextData) return null;
  const blocks = createBlocks(scriptureTextData);
  const chunks = createChunks(blocks);
  const textRef = useRef(null);

  const [textHeight, setTextHeight] = useState(0);
  useEffect(() => {
    if (textRef.current) setTextHeight(textRef.current.clientHeight);
  }, [chunks]);

  const YPosition = (progress * textHeight) - panelHeight;

return (
    <div
        className="scripture-text"
        ref={textRef}
        style={{
            paddingBottom: `${panelHeight}px`,
            transform: `translateY(-${YPosition}px)`,
            backgroundImage: `url(${config.backgroundImage})`,
        }}
    >{chunks.map((chunk, i) => {
            if (chunk.type === "heading") {
                return (
                    <div key={chunk.key} className="verse-headings">
                        {chunk.background && <p className="background">{chunk.background}</p>}
                        {chunk.summary && <p className="summary">{chunk.summary}</p>}
                        {chunk.heading && <h4 className="heading">{chunk.heading}</h4>}
                    </div>
                );
            }
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
}

function SeekBar({ currentTime, duration, onSeek }) {
  const seekClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - rect.left) / rect.width) * duration);
  };
  return (
    <div className="seek-bar" style={styleConfig.seekBarWrapper} onClick={seekClick}>
      <div className="seek-progress" style={{ ...styleConfig.seekProgress, width: `${(currentTime / duration) * 100}%` }}>
        <div className="current-time" style={styleConfig.currentTime}>{moment.utc(currentTime * 1000).format("mm:ss")}</div>
      </div>
      <div className="total-time" style={styleConfig.totalTime}>{moment.utc(duration * 1000).format("mm:ss")}</div>
    </div>
  );
}

function ScriptureAudioPlayer({ media, setProgress, duration, setDuration, advance }) {
  const [music] = useState(String(Math.floor(Math.random() * config.randomMax) + config.randomMin).padStart(3, "0"));
  const audioRef = useRef(null);
  const musicRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const musicPath = DaylightMediaPath(`media/scripture/ambient/${music}`);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = 1;
    if (musicRef.current) musicRef.current.volume = config.ambientVolume;
    const intervalId = setInterval(() => {
      if (audioRef.current && !audioRef.current.paused) {
        setCurrentTime(audioRef.current.currentTime);
        if (audioRef.current.duration) setProgress(audioRef.current.currentTime / audioRef.current.duration);
      }
    }, 50);
    return () => clearInterval(intervalId);
  }, [media, setProgress]);

  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration);
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
        if (musicRef.current.volume > config.fadeOutStep) musicRef.current.volume -= config.fadeOutStep;
        else {
          musicRef.current.volume = 0;
          clearInterval(fadeOut);
          advance();
        }
      }, config.fadeOutInterval);
    } else advance();
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


  //pause on spacebar (toggle)
    useEffect(() => {
        const handleKeyDown = (event) => {
        if (event.key === " ") {
            if (audioRef.current.paused) audioRef.current.play();
            else audioRef.current.pause();
        }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

  return (
    <div className="controls" style={styleConfig.controls}>
      <SeekBar currentTime={currentTime} duration={duration} onSeek={handleSeek} />
      <audio ref={audioRef} src={media} onEnded={handleEnded} onLoadedMetadata={handleLoadedMetadata} />
      <audio ref={musicRef} autoPlay src={musicPath} style={{ display: "none" }} onLoadedMetadata={startAudioAfterDelay} />
    </div>
  );
}

export default function Scriptures({ media, advance }) {
  const [{ ref, verse_ids: [verseId] }] = useState(() => lookupReference(media));
  const version = media.split("/").length > 1 ? "/" + media.split("/")[0] : "/redc";
  const [titleHeader, setTitleHeader] = useState(ref);
  const [subtitle, setSubtitle] = useState(null);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const volume = findVolume(verseId);
  const mediaPath = DaylightMediaPath(`media/scripture/${volume}${version}/${verseId}`);
  const [scriptureTextData, setScriptureTextData] = useState(null);

  useEffect(() => {
    DaylightAPI(`data/scripture/${volume}${version}/${verseId}`).then((verses) => {
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
        if (panelRef.current) setPanelHeight(panelRef.current.clientHeight);
        setTimeout(() => setInit(false), 100);
    }, [scriptureTextData]);

  return (
    <div className="scriptures" style={styleConfig.scripturesContainer}>
      <h2>{titleHeader}</h2>
      {subtitle && <h3>{subtitle}</h3>}
      <div  ref={panelRef} style={styleConfig.textPanel} className={"textpanel" + (progress > .999 ? " fade-out" : "") + (init? " init" : "")}>
        <ScriptureText scriptureTextData={scriptureTextData} progress={textProgress(progress, duration)} panelHeight={panelHeight} />
      </div>
      <ScriptureAudioPlayer media={mediaPath} setProgress={setProgress} setDuration={setDuration} duration={duration} advance={advance} />
    </div>
  );
}