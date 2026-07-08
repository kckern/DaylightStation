import { useRef, useState, useEffect, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { buildOrder, nextPos, prevPos } from './musicQueue.js';
import { formatTime } from './musicTracks.js';
import useVanishingControls from '../../useVanishingControls.js';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
import { usePianoMidi, usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import useReloadGuard from '../../useReloadGuard.js';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import Icon from '../../icons/Icon.jsx';
import { usePianoMix } from '../../PianoMixContext.jsx';
import MixControls from '../../MixControls.jsx';

/**
 * Plexamp-style now-playing for the Music mode. Album art + progress are the
 * hero; the transport row, header and volume fade after a few idle seconds and
 * return on any tap. Plain <audio> engine; queue order honors shuffle/repeat.
 */
export default function MusicPlayer({ album, tracks, startIndex = 0, shuffle: shuffleInit = false, onBack }) {
  const audioRef = useRef(null);
  const barRef = useRef(null);
  const logger = useRef(null);
  if (!logger.current) logger.current = getLogger().child({ component: 'piano-music-player' });

  const { setPlaying: setGlobalPlaying } = usePianoPlayback();
  const { pressNote, releaseNote } = usePianoMidi();
  const { activeNotes, noteHistory } = usePianoMidiNotes();
  const { config } = usePianoKioskConfig();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const { mediaLevel, setMediaLevel, pianoLevel, setPianoLevel } = usePianoMix();

  // Third now-playing state: PLAY-ALONG. Entered by MIDI (not touch) — the user
  // is playing the piano along to the track. The keyboard slides up, the cover
  // dim eases, and the title/artist show — but the transport chrome stays hidden.
  // Auto-exits after a few seconds of no notes.
  const [playAlong, setPlayAlong] = useState(false);
  const paTimer = useRef(null);
  const lastNoteLen = useRef(noteHistory?.length || 0);
  useEffect(() => {
    const len = noteHistory?.length || 0;
    const activity = len > lastNoteLen.current || (activeNotes && activeNotes.size > 0);
    lastNoteLen.current = len;
    if (!activity) return undefined;
    setPlayAlong(true);
    if (paTimer.current) clearTimeout(paTimer.current);
    paTimer.current = setTimeout(() => setPlayAlong(false), 6000);
    return undefined;
  }, [activeNotes, noteHistory?.length]);
  useEffect(() => () => { if (paTimer.current) clearTimeout(paTimer.current); }, []);

  // Play All starts shuffled by default (shuffleInit); a tapped track plays in order.
  const [shuffle, setShuffle] = useState(shuffleInit);
  const [repeat, setRepeat] = useState(false);
  const [order, setOrder] = useState(() => buildOrder(tracks.length, shuffleInit));
  const [pos, setPos] = useState(startIndex);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [showQueue, setShowQueue] = useState(false);

  const trackIndex = order[pos] ?? 0;
  const track = tracks[trackIndex] || null;
  const cover = track?.image || album?.image || album?.thumbnail || null;
  const { visible, reveal } = useVanishingControls({ active: playing && !showQueue });
  useReloadGuard(playing);

  // Load + autoplay the current track whenever it changes.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !track) return;
    a.src = track.mediaUrl;
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    logger.current.info('piano.music.track', { contentId: track.contentId, title: track.title, pos });
  }, [track?.mediaUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply volume to the element.
  useEffect(() => { if (audioRef.current) audioRef.current.volume = mediaLevel; }, [mediaLevel]);

  // Report active playback to the kiosk context so the inactivity timer stays alive.
  useEffect(() => {
    setGlobalPlaying(playing);
    return () => setGlobalPlaying(false);
  }, [playing, setGlobalPlaying]);

  const goNext = useCallback((auto = false) => {
    setPos((p) => {
      const np = nextPos(order, p, repeat);
      if (np < 0) { if (auto) setPlaying(false); return p; }
      return np;
    });
  }, [order, repeat]);

  const goPrev = useCallback(() => {
    const a = audioRef.current;
    if (a && a.currentTime > 3) { a.currentTime = 0; return; }
    setPos((p) => prevPos(order, p, repeat));
  }, [order, repeat]);

  // Media element events.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return undefined;
    const onTime = () => setTime(a.currentTime || 0);
    const onMeta = () => setDur(a.duration || 0);
    const onEnd = () => goNext(true);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
    };
  }, [goNext]);

  const toggle = () => { const a = audioRef.current; if (!a) return; if (a.paused) a.play(); else a.pause(); reveal(); };
  const seek = (e) => {
    const a = audioRef.current; const el = barRef.current;
    if (!a || !el || !dur) return;
    const r = el.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur));
    reveal();
  };
  const toggleShuffle = () => {
    setShuffle((s) => {
      const ns = !s;
      const cur = order[pos];
      const no = buildOrder(tracks.length, ns);
      const npos = Math.max(0, no.indexOf(cur));
      setOrder(no);
      setPos(npos);
      logger.current.info('piano.music.shuffle', { on: ns });
      return ns;
    });
  };
  const toggleRepeat = () => setRepeat((r) => { logger.current.info('piano.music.repeat', { on: !r }); return !r; });
  const jumpTo = (ti) => { const np = order.indexOf(ti); if (np >= 0) setPos(np); setShowQueue(false); };

  const pct = dur > 0 ? Math.min(100, (time / dur) * 100) : 0;

  return (
    <div
      className={`piano-music-player${visible ? '' : ' chrome-hidden'}${playAlong ? ' is-playalong' : ''}`}
      onPointerDown={reveal}
      style={cover ? { '--cover': `url(${cover})` } : undefined}
    >
      {/* Stage: album art + transport chrome live here and flex-shrink to make
          room when the keyboard pushes up from below (it never slides over). */}
      <div className="piano-music-player__stage">
      <div className="piano-music-player__art">
        {cover && <img src={cover} alt={track?.album || ''} />}
      </div>

      <div className="piano-music-player__chrome">
        <div className="piano-music-player__top">
          <button type="button" className="piano-music-btn" onClick={onBack} aria-label="Back to music"><Icon name="back" /></button>
          <div className="piano-music-player__meta">
            <div className="piano-music-player__title">{track?.title || ''}</div>
            <div className="piano-music-player__sub">{[track?.artist, track?.album].filter(Boolean).join(' — ')}</div>
          </div>
          <button type="button" className="piano-music-btn" onClick={() => setShowQueue((q) => !q)} aria-label="Queue"><Icon name="queue" /></button>
        </div>

        <div className="piano-music-player__bottom">
          <div className="piano-music-player__bar" ref={barRef} onPointerDown={seek}>
            <div className="piano-music-player__fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="piano-music-player__times">
            <span>{formatTime(time)}</span><span>{formatTime(dur)}</span>
          </div>
          <div className="piano-music-player__transport">
            <button type="button" className={`piano-music-btn${shuffle ? ' is-on' : ''}`} onClick={toggleShuffle} aria-label="Shuffle"><Icon name="shuffle" /></button>
            <button type="button" className="piano-music-btn" onClick={goPrev} aria-label="Previous"><Icon name="previous" /></button>
            <button type="button" className="piano-music-btn piano-music-btn--play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Icon name="pause" /> : <Icon name="play" />}</button>
            <button type="button" className="piano-music-btn" onClick={() => goNext(false)} aria-label="Next"><Icon name="next" /></button>
            <button type="button" className={`piano-music-btn${repeat ? ' is-on' : ''}`} onClick={toggleRepeat} aria-label="Repeat"><Icon name="repeat" /></button>
          </div>
          <MixControls
            pianoLevel={pianoLevel}
            mediaLevel={mediaLevel}
            onPiano={(d) => { setPianoLevel(pianoLevel + d); reveal(); }}
            onMedia={(d) => { setMediaLevel(mediaLevel + d); reveal(); }}
            btnClass="piano-music-btn"
          />
        </div>
      </div>

      {/* While dimmed, the transport fades but the track title/artist persist
          here (its own gradient keeps them legible over the dark cover). */}
      <div className="piano-music-player__pa-meta">
        <div className="piano-music-player__title">{track?.title || ''}</div>
        <div className="piano-music-player__sub">{[track?.artist, track?.album].filter(Boolean).join(' — ')}</div>
      </div>
      </div>

      {/* Play-along: live keyboard. In-flow at the bottom edge — when it opens it
          PUSHES the stage up (art + chrome resize) instead of covering them. */}
      <div className="piano-music-player__keys" onPointerDown={(e) => e.stopPropagation()}>
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={kb.startNote}
          endNote={kb.endNote}
          onNoteOn={pressNote}
          onNoteOff={releaseNote}
        />
      </div>

      {showQueue && (
        <div className="piano-music-queue">
          <div className="piano-music-queue__head">
            <span>Up Next</span>
            <button type="button" className="piano-music-btn" onClick={() => setShowQueue(false)} aria-label="Close queue"><Icon name="close" /></button>
          </div>
          <ol className="piano-track-list">
            {order.map((ti, i) => {
              const t = tracks[ti];
              return (
                <li key={t?.contentId || ti}>
                  <button type="button" className={`piano-track-list__row${i === pos ? ' is-current' : ''}`} onClick={() => jumpTo(ti)}>
                    <span className="piano-track-list__num">{i === pos ? <Icon name="play" /> : t?.index}</span>
                    <span className="piano-track-list__title">{t?.title}</span>
                    <span className="piano-track-list__dur">{t?.duration ? formatTime(t.duration) : ''}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <audio ref={audioRef} />
    </div>
  );
}
