import { useRef, useState, useEffect, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { buildOrder, nextPos, prevPos } from './musicQueue.js';
import { formatTime } from './musicTracks.js';
import useVanishingControls from './useVanishingControls.js';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
import useReloadGuard from '../../useReloadGuard.js';

/**
 * Plexamp-style now-playing for the Music mode. Album art + progress are the
 * hero; the transport row, header and volume fade after a few idle seconds and
 * return on any tap. Plain <audio> engine; queue order honors shuffle/repeat.
 */
export default function MusicPlayer({ album, tracks, startIndex = 0, onBack }) {
  const audioRef = useRef(null);
  const barRef = useRef(null);
  const logger = useRef(null);
  if (!logger.current) logger.current = getLogger().child({ component: 'piano-music-player' });

  const { setPlaying: setGlobalPlaying } = usePianoPlayback();
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [order, setOrder] = useState(() => buildOrder(tracks.length, false));
  const [pos, setPos] = useState(startIndex);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
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
  useEffect(() => { if (audioRef.current) audioRef.current.volume = vol; }, [vol]);

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
  const changeVol = (d) => { setVol((v) => Math.max(0, Math.min(1, Math.round((v + d) * 10) / 10))); reveal(); };
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
      className={`piano-music-player${visible ? '' : ' chrome-hidden'}`}
      onPointerDown={reveal}
      style={cover ? { '--cover': `url(${cover})` } : undefined}
    >
      <div className="piano-music-player__art">
        {cover && <img src={cover} alt={track?.album || ''} />}
      </div>

      <div className="piano-music-player__chrome">
        <div className="piano-music-player__top">
          <button type="button" className="piano-music-btn" onClick={onBack} aria-label="Back to music">‹</button>
          <div className="piano-music-player__meta">
            <div className="piano-music-player__title">{track?.title || ''}</div>
            <div className="piano-music-player__sub">{[track?.artist, track?.album].filter(Boolean).join(' — ')}</div>
          </div>
          <button type="button" className="piano-music-btn" onClick={() => setShowQueue((q) => !q)} aria-label="Queue">≡</button>
        </div>

        <div className="piano-music-player__bottom">
          <div className="piano-music-player__bar" ref={barRef} onPointerDown={seek}>
            <div className="piano-music-player__fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="piano-music-player__times">
            <span>{formatTime(time)}</span><span>{formatTime(dur)}</span>
          </div>
          <div className="piano-music-player__transport">
            <button type="button" className={`piano-music-btn${shuffle ? ' is-on' : ''}`} onClick={toggleShuffle} aria-label="Shuffle">🔀</button>
            <button type="button" className="piano-music-btn" onClick={goPrev} aria-label="Previous">⏮</button>
            <button type="button" className="piano-music-btn piano-music-btn--play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
            <button type="button" className="piano-music-btn" onClick={() => goNext(false)} aria-label="Next">⏭</button>
            <button type="button" className={`piano-music-btn${repeat ? ' is-on' : ''}`} onClick={toggleRepeat} aria-label="Repeat">🔁</button>
          </div>
          <div className="piano-music-player__volume">
            <button type="button" className="piano-music-btn" onClick={() => changeVol(-0.1)} aria-label="Volume down">🔉</button>
            <span className="piano-music-player__vol-val">{Math.round(vol * 100)}</span>
            <button type="button" className="piano-music-btn" onClick={() => changeVol(0.1)} aria-label="Volume up">🔊</button>
          </div>
        </div>
      </div>

      {showQueue && (
        <div className="piano-music-queue">
          <div className="piano-music-queue__head">
            <span>Up Next</span>
            <button type="button" className="piano-music-btn" onClick={() => setShowQueue(false)} aria-label="Close queue">✕</button>
          </div>
          <ol className="piano-track-list">
            {order.map((ti, i) => {
              const t = tracks[ti];
              return (
                <li key={t?.contentId || ti}>
                  <button type="button" className={`piano-track-list__row${i === pos ? ' is-current' : ''}`} onClick={() => jumpTo(ti)}>
                    <span className="piano-track-list__num">{i === pos ? '▶' : t?.index}</span>
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
