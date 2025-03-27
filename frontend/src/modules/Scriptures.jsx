import { useState, useEffect, useRef } from "react";
import "./Scriptures.scss";
import { DaylightAPI, DaylightMediaPath } from "../lib/api.mjs";
import { lookupReference } from "scripture-guide";
import moment from "moment";
import paperBackground from "../assets/backgrounds/paper.jpg";

const volumes = {
    "ot": 1,
    "nt": 23146,
    "bom": 31103,
    "dc": 37707,
    "pgp": 41361,
    "lof": 41996
};

const findVolume = (verse_id) => {
    const vols = Object.entries(volumes);
    const [volume] = vols.reduce((prev, curr) => {
        return verse_id >= curr[1] ? curr : prev;
    });
    return volume;
};

export default function Scriptures({ media, advance }) {
    //random 1 to 115, 3 digit pad
    const [{ ref,verse_ids: [verse_id] }] = useState(()=>lookupReference(media));
    const version = media.split('/').length > 1 ? "/" + media.split('/')[0] : '/redc';
    const [titleHeader, setTitleHeader] = useState(ref);
    const [subtitle, setSubtitle] = useState(null);
    const [duration, setDuration] = useState(0);

    const [progress, setProgress] = useState(0);
    
    const volume = findVolume(verse_id);
    const mediaPath = DaylightMediaPath(`media/scripture/${volume}${version}/${verse_id}`);
    
    const [scriptureTextData, setScriptureTextData] = useState(null);
    useEffect(() => {
        DaylightAPI(`data/scripture/${volume}${version}/${verse_id}`)
            .then((verses) => {
                const [{headings:{title, subtitle}}] = verses;
                setScriptureTextData(verses);
                title && setTitleHeader(ref);
                setSubtitle([title, subtitle].filter(Boolean).join(' • '));
            }
            );
    }, [verse_id]);


    const textProgress = (progress, duration) => {
        const tenSeconds = 10 / duration;
        if (progress < tenSeconds) return 0;
        if (progress >= tenSeconds && progress < 1) return (progress - tenSeconds) / (1 - tenSeconds);
        return 1;
    }


    return (
        <div className="scriptures" style={{ volume: 0.1 }}>
            <h2>{titleHeader}</h2>
            {subtitle && <h3>{subtitle}</h3>}
            <div 
            style={{
                backgroundImage: `url(${paperBackground})`,
            }}
            className="textpanel">
                <ScriptureText scriptureTextData={scriptureTextData}  progress={textProgress(progress, duration)} />
            </div>
            <ScriptureAudioPlayer media={mediaPath} setProgress={setProgress} setDuration={setDuration} duration={duration} />
            
        </div>
    );
}


function ScriptureText({ scriptureTextData, progress }) {
    if (!scriptureTextData) return null;
  
    // 1) First, transform the raw data into a flat list of "blocks"
    //    Each block is either a heading or a verse.
    //    Use reduce to accumulate all of these in a single array.
    const blocks = scriptureTextData.reduce((acc, versedata, i) => {
      const { headings, verse, text } = versedata;
      const { heading, background, summary } = headings || {};
  
      // If there is a heading, add that as a separate block
      if (headings) {
        acc.push({
          type: 'heading',
          heading,
          background,
          summary,
          key: `heading-${i}`,
        });
      }
  
      // Clean up the text, check if a new paragraph is triggered
      const plainText = text.replace(/[¶§｟｠]+/g, '');
      const newParagraph = /¶/.test(text);
  
      // Add the verse block
      acc.push({
        type: 'verse',
        verse,
        text: plainText,
        newParagraph,
        key: `verse-${i}`,
      });
  
      return acc;
    }, []);
  
    // 2) Next, we convert these blocks into "render chunks":
    //    Headings always break paragraphs. A verse with newParagraph = true
    //    also breaks paragraphs. We'll accumulate verses in a "currentParagraph"
    //    until a break condition is met, then we push that paragraph out.
    const chunks = [];
    let currentParagraph = [];
  
    blocks.forEach((block) => {
      if (block.type === 'heading') {
        // If we were accumulating verses, finalize the current paragraph first
        if (currentParagraph.length) {
          chunks.push({ type: 'paragraph', content: [...currentParagraph] });
          currentParagraph = [];
        }
        // Push the heading as its own chunk
        chunks.push(block);
      } else {
        // block.type === 'verse'
        const { newParagraph } = block;
        // If newParagraph is true and we've already started a paragraph,
        // finalize the existing paragraph first.
        if (newParagraph && currentParagraph.length) {
          chunks.push({ type: 'paragraph', content: [...currentParagraph] });
          currentParagraph = [block];
        } else {
          currentParagraph.push(block);
        }
      }
    });
  
    // If there's a leftover paragraph at the end, push it
    if (currentParagraph.length) {
      chunks.push({ type: 'paragraph', content: currentParagraph });
    }
  
    // 3) Finally, render the chunks: heading blocks become <div className="verse-headings">
    //    paragraph blocks become <p>, containing verse spans.

    return (
      <div className="scripture-text"
     
        style={{ transform: `translateY(-${progress * 100}%)`,
        backgroundImage: `url(${paperBackground})`
     }}
      >
        {chunks.map((chunk, i) => {
          if (chunk.type === 'heading') {
            const { heading, background, summary, key } = chunk;
            return (
              <div key={key} className="verse-headings">
                {background && <p className="background">{background}</p>}
                {summary && <p className="summary">{summary}</p>}
                {heading && <h4 className="heading">{heading}</h4>}
              </div>
            );
          } else {
            // It's a paragraph of verses
            return (
              <p key={`paragraph-${i}`}>
                {chunk.content.map((verseItem) => (
                  <span key={verseItem.key} className="verse">
                    <span className="verse-number">{verseItem.verse}</span>
                    <span className="verse-text">{verseItem.text}</span>
                  </span>
                ))}
              </p>
            );
          }
        })}
      </div>
    );
  }

 
function ScriptureAudioPlayer({ media, setProgress, duration, setDuration }) {
    const [music] = useState(String(Math.floor(Math.random() * 115) + 1).padStart(3, "0"));
    const musicPath = DaylightMediaPath(`media/scripture/ambient/${music}`);

    const audioRef = useRef(null);
    const musicRef = useRef(null);
    const [currentTime, setCurrentTime] = useState(0);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = 1;
        }
        if (musicRef.current) {
            musicRef.current.volume = 0.2;
        }
        const intervalId = setInterval(() => {
            if (audioRef.current && !audioRef.current.paused) {
                setCurrentTime(audioRef.current.currentTime);
                if (audioRef.current.duration) {
                    setProgress(audioRef.current.currentTime / audioRef.current.duration);
                }
            }
        }, 50);
        return () => clearInterval(intervalId);
    }, [media]);

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

    return (
        <div className="controls" style={{ width: "100%" }}>
            <SeekBar
                currentTime={currentTime}
                duration={duration}
                onSeek={handleSeek}
            />

            <audio
                className="scriptureAudio"
                autoPlay
                ref={audioRef}
                src={media}
                controls={false}
                onLoadedMetadata={handleLoadedMetadata}
                style={{ width: "100%" }}
            />
            <audio
                ref={musicRef}
                className="ambient"
                autoPlay
                src={musicPath}
                controls={false}
                style={{ display: "none" }}
            />
        </div>
    );
}

function SeekBar({ currentTime, duration, onSeek }) {

    const handleSeekClick = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const clickPosition = e.clientX - rect.left;
        const newTime = (clickPosition / rect.width) * duration;
        onSeek(newTime);
    };
    return (
        <div
            className="seek-bar"
            style={{ position: "relative" }}
            onClick={handleSeekClick}
        >
            <div
                className="seek-progress"
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    height: "100%",
                    width: `${(currentTime / duration) * 100}%`,
                    backgroundColor: "#6c584c66",
                    display: "flex",
                    justifyContent: "flex-end",
                }}
            ><div
            className="current-time"
            
        >
            {moment.utc(currentTime * 1000).format("mm:ss")}
        </div></div>
        <div
                className="total-time"
                style={{
                    pointerEvents: "none",
                    position: "absolute",
                    right: 0,
                }}
            >
                {moment.utc(duration * 1000).format("mm:ss")}
            </div>
            
        </div>
    );
}