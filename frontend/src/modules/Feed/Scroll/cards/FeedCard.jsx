import { useState, useEffect, useCallback, useRef } from 'react';
import { formatAge, proxyIcon, proxyImage, isImageUrl } from './utils.js';
import { getBodyModule } from './bodies/index.js';
import { getContentPlugin } from '../../contentPlugins/index.js';
import { feedLog } from '../feedLog.js';
import getLogger from '../../../../lib/logging/Logger.js';
import FeedPlayer from '../../players/FeedPlayer.jsx';
import { DaylightAPI } from '../../../../lib/api.mjs';

// Info-level logger for image lifecycle (visible in backend session logs)
function imgLog() { return getLogger().child({ module: 'feed-card-image' }); }

function formatDuration(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const STATUS_COLORS = {
  red: '#ff6b6b',
  yellow: '#fab005',
  green: '#51cf66',
};

/** Inline SVG data-URI shimmer placeholder (no network request). */
const PLACEHOLDER_SVG = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#2c2e33"/>
        <stop offset="50%" stop-color="#3a3c42"/>
        <stop offset="100%" stop-color="#2c2e33"/>
      </linearGradient>
    </defs>
    <rect width="400" height="300" fill="#1a1b1e"/>
    <rect width="400" height="300" fill="url(#g)">
      <animate attributeName="x" from="-400" to="400" dur="1.5s" repeatCount="indefinite"/>
    </rect>
  </svg>`
)}`;

function HeroImage({ src, thumbnail, itemId, title }) {
  const proxied = proxyImage(src);
  const [imgSrc, setImgSrc] = useState(thumbnail || src);
  const [phase, setPhase] = useState(thumbnail ? 'thumbnail' : 'original');
  const [loaded, setLoaded] = useState(false);
  const loadStartRef = useRef(performance.now());

  useEffect(() => {
    setImgSrc(thumbnail || src);
    setPhase(thumbnail ? 'thumbnail' : 'original');
    setLoaded(false);
    loadStartRef.current = performance.now();
  }, [src, thumbnail]);

  // Preload full image in background when we have a thumbnail
  useEffect(() => {
    if (!thumbnail || !src || thumbnail === src) return;
    const img = new Image();
    img.onload = () => {
      const durationMs = Math.round(performance.now() - loadStartRef.current);
      imgLog().info('preload.done', { phase: 'full', durationMs, src, itemId, title });
      setImgSrc(src);
      setPhase('original');
      loadStartRef.current = performance.now();
    };
    img.onerror = () => {
      const durationMs = Math.round(performance.now() - loadStartRef.current);
      imgLog().warn('preload.failed', { src, thumbnail, durationMs, itemId, title });
    };
    img.src = src;
    return () => { img.onload = null; img.onerror = null; };
  }, [src, thumbnail]);

  const handleError = () => {
    const durationMs = Math.round(performance.now() - loadStartRef.current);
    if (phase === 'thumbnail' && src && src !== thumbnail) {
      imgLog().warn('thumbnail.failed', { thumbnail, src, durationMs, itemId, title });
      setPhase('original');
      setImgSrc(src);
      loadStartRef.current = performance.now();
    } else if ((phase === 'original' || phase === 'thumbnail') && proxied) {
      imgLog().warn('fallback.proxy', { original: src, proxy: proxied, durationMs, itemId, title });
      setPhase('proxy');
      setImgSrc(proxied);
      loadStartRef.current = performance.now();
    } else {
      imgLog().warn('image.hidden', { src, durationMs, itemId, title });
      setPhase('hidden');
    }
  };

  if (phase === 'hidden') return null;

  return (
    <>
      {/* SVG shimmer placeholder — visible until real image loads */}
      {!loaded && (
        <img
          src={PLACEHOLDER_SVG}
          alt=""
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            display: 'block', objectFit: 'cover',
          }}
        />
      )}
      <img
        src={imgSrc}
        alt=""
        className="feed-card-image"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: 'cover',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.3s ease-in-out',
        }}
        onLoad={() => {
          const durationMs = Math.round(performance.now() - loadStartRef.current);
          imgLog().info('loaded', { phase, durationMs, src: imgSrc, itemId, title });
          setLoaded(true);
        }}
        onError={handleError}
      />
    </>
  );
}

/**
 * GalleryHero — swipeable image gallery for cards with multiple images.
 * Source-agnostic: works with any adapter that provides meta.galleryImages.
 * Supports touch swipe (mobile) and click arrows (desktop).
 */
function GalleryHero({ images, itemId, title }) {
  const [index, setIndex] = useState(0);
  const dragStartRef = useRef(null);
  const count = images.length;
  const current = images[index] || images[0];

  const goPrev = useCallback((e) => { e?.stopPropagation(); setIndex(i => Math.max(i - 1, 0)); }, []);
  const goNext = useCallback((e) => { e?.stopPropagation(); setIndex(i => Math.min(i + 1, count - 1)); }, [count]);

  // Touch swipe (mobile)
  const handleTouchStart = (e) => { dragStartRef.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (dragStartRef.current === null) return;
    const dx = e.changedTouches[0].clientX - dragStartRef.current;
    dragStartRef.current = null;
    if (dx < -40) goNext();
    else if (dx > 40) goPrev();
  };

  // Mouse drag (desktop)
  const handleMouseDown = (e) => { dragStartRef.current = e.clientX; };
  const handleMouseUp = (e) => {
    if (dragStartRef.current === null) return;
    const dx = e.clientX - dragStartRef.current;
    dragStartRef.current = null;
    if (dx < -40) goNext();
    else if (dx > 40) goPrev();
  };

  // Keyboard navigation when focused
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowLeft') goPrev(e);
    else if (e.key === 'ArrowRight') goNext(e);
  }, [goPrev, goNext]);

  // Log only user-initiated slides (skip initial index=0)
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    feedLog.interaction('gallery-slide', { index, total: count, itemId, title });
  }, [index, count, itemId, title]);

  const arrowStyle = {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)',
    width: '32px', height: '32px', borderRadius: '50%',
    background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff',
    fontSize: '16px', fontWeight: 700, cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 2,
    backdropFilter: 'blur(4px)',
  };

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', userSelect: 'none' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label={`Image gallery, ${index + 1} of ${count}`}
    >
      <HeroImage src={current.url} thumbnail={current.thumbnail} itemId={itemId} title={title} />

      {/* Left arrow */}
      {index > 0 && (
        <button onClick={goPrev} aria-label="Previous image"
          style={{ ...arrowStyle, left: '6px' }}>‹</button>
      )}
      {/* Right arrow */}
      {index < count - 1 && (
        <button onClick={goNext} aria-label="Next image"
          style={{ ...arrowStyle, right: '6px' }}>›</button>
      )}

      {/* Dot indicators (cap at 10 to avoid clutter) */}
      {count <= 10 && (
        <div style={{
          position: 'absolute', bottom: '8px', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: '4px', zIndex: 2,
        }}>
          {images.map((_, i) => (
            <span key={i} style={{
              width: i === index ? '8px' : '6px',
              height: i === index ? '8px' : '6px',
              borderRadius: '50%',
              background: i === index ? '#fff' : 'rgba(255,255,255,0.5)',
              transition: 'all 0.2s',
            }} />
          ))}
        </div>
      )}

      {/* Counter badge */}
      <span style={{
        position: 'absolute', top: '8px', left: '8px',
        background: 'rgba(0,0,0,0.6)', color: '#fff',
        fontSize: '0.6rem', fontWeight: 600,
        padding: '2px 6px', borderRadius: '4px', zIndex: 2,
      }}>
        {index + 1} / {count}
      </span>
    </div>
  );
}

function StatusDot({ status }) {
  const color = STATUS_COLORS[status] || '#5c636a';
  return (
    <span style={{
      display: 'inline-block',
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      backgroundColor: color,
      flexShrink: 0,
    }} />
  );
}

export default function FeedCard({ item, colors = {}, onDismiss, onPlay }) {
  const tier = item.tier || 'wire';
  const sourceName = item.meta?.sourceName || item.meta?.feedTitle || item.source || '';
  const age = formatAge(item.timestamp);
  const iconUrl = proxyIcon(item.meta?.sourceIcon);
  const [playingInline, setPlayingInline] = useState(false);

  const contentPlugin = getContentPlugin(item);
  const BodyModule = contentPlugin?.ScrollBody || getBodyModule(item.source);

  const canPlayInline = item.contentType === 'youtube' && item.meta?.videoId;

  const handlePlay = (e) => {
    e.stopPropagation();
    if (canPlayInline) {
      feedLog.interaction('inline-play', { id: item.id, title: item.title, contentType: item.contentType, videoId: item.meta?.videoId });
      setPlayingInline(true);
    } else {
      feedLog.interaction('remote-play', { id: item.id, title: item.title, contentType: item.contentType });
      onPlay?.(item);
    }
  };

  return (
    <div
      className={`feed-card feed-card-${tier}`}
      style={{
        display: 'block',
        background: '#25262b',
        borderRadius: '12px',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Hero image / inline player */}
      {item.image && isImageUrl(item.image) && (
        <div style={{
            overflow: 'hidden',
            position: 'relative',
            aspectRatio: (item.meta?.imageWidth && item.meta?.imageHeight)
              ? `${item.meta.imageWidth} / ${item.meta.imageHeight}`
              : '16 / 9',
            backgroundColor: '#1a1b1e',
          }}>
          {playingInline ? (
            <CardYouTubePlayer item={item} />
          ) : item.meta?.galleryImages?.length > 1 ? (
            <GalleryHero images={item.meta.galleryImages} itemId={item.id} title={item.title} />
          ) : (
            <>
              <HeroImage src={item.image} thumbnail={item.thumbnail} itemId={item.id} title={item.title} />
              {/* Duration badge */}
              {item.meta?.duration > 0 && (
                <span style={{
                  position: 'absolute',
                  bottom: '8px',
                  right: '8px',
                  background: 'rgba(0,0,0,0.75)',
                  color: '#fff',
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontVariantNumeric: 'tabular-nums',
                  zIndex: 1,
                }}>
                  {formatDuration(item.meta.duration)}
                </span>
              )}
              {/* Play button overlay */}
              {item.meta?.playable && (
                <button
                  onClick={handlePlay}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.55)',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  aria-label="Play"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              )}
            </>
          )}
          {/* Dismiss button overlay — desktop only (mobile uses swipe-left) */}
          {onDismiss && (
            <button
              className="feed-card-dismiss"
              onClick={(e) => { e.stopPropagation(); onDismiss(item); }}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.55)',
                border: 'none',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                lineHeight: 1,
                zIndex: 2,
              }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Standard layout: source bar + body below image */}
      <div style={{ padding: '0.75rem 1rem' }}>
        {/* Source bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          marginBottom: '0.35rem',
        }}>
          {item.meta?.status && <StatusDot status={item.meta.status} />}
          {iconUrl && (
            <img
              src={iconUrl}
              alt=""
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                flexShrink: 0,
              }}
              onError={(e) => { feedLog.image('source icon failed', { url: iconUrl }); e.target.style.display = 'none'; }}
            />
          )}
          <span style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: '#868e96',
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {sourceName}
          </span>
          <span style={{
            fontSize: '0.65rem',
            color: '#5c636a',
            marginLeft: 'auto',
            flexShrink: 0,
          }}>
            {age}
          </span>
        </div>

        {/* Body */}
        <BodyModule item={item} />

        {/* Overdue badge (tasks) */}
        {item.source === 'tasks' && item.meta?.isOverdue && (
          <span style={{
            display: 'inline-block',
            background: '#ff6b6b',
            color: '#fff',
            fontSize: '0.6rem',
            fontWeight: 700,
            padding: '0.1rem 0.4rem',
            borderRadius: '999px',
            marginTop: '0.4rem',
            textTransform: 'uppercase',
          }}>
            Overdue
          </span>
        )}
        {/* Dismiss footer for text-only cards — desktop only (mobile uses swipe-left) */}
        {onDismiss && !(item.image && isImageUrl(item.image)) && (
          <div className="feed-card-dismiss" style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: '0.4rem',
            paddingTop: '0.3rem',
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}>
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(item); }}
              style={{
                background: 'none',
                border: 'none',
                color: '#5c636a',
                fontSize: '0.65rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.15rem 0.3rem',
                borderRadius: '4px',
              }}
              aria-label="Dismiss"
            >
              ✕ <span>Dismiss</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CardYouTubePlayer({ item }) {
  const [playerData, setPlayerData] = useState(null);
  const [fetchDone, setFetchDone] = useState(false);
  const [useEmbed, setUseEmbed] = useState(false);

  useEffect(() => {
    const fetchStart = performance.now();
    const params = new URLSearchParams();
    params.set('quality', '720p');
    if (item.meta) params.set('meta', JSON.stringify(item.meta));

    feedLog.resolution('native-attempt', { videoId: item.meta?.videoId, title: item.title, quality: '720p' });

    DaylightAPI(`/api/v1/feed/detail/${encodeURIComponent(item.id)}?${params}`)
      .then(result => {
        const durationMs = Math.round(performance.now() - fetchStart);
        const section = result?.sections?.find(s => s.type === 'player' && s.data?.provider === 'youtube');
        if (section) {
          feedLog.resolution('native-resolved', {
            videoId: item.meta?.videoId,
            title: item.title,
            hasVideoUrl: !!section.data?.videoUrl,
            hasAudioUrl: !!section.data?.audioUrl,
            hasUrl: !!section.data?.url,
            mode: (section.data?.videoUrl && section.data?.audioUrl) ? 'split' : 'combined',
            durationMs,
          });
          setPlayerData(section.data);
        } else {
          feedLog.resolution('native-no-player-section', { videoId: item.meta?.videoId, title: item.title, durationMs, sectionCount: result?.sections?.length || 0 });
        }
        setFetchDone(true);
      })
      .catch((err) => {
        feedLog.resolution('native-fetch-error', { videoId: item.meta?.videoId, title: item.title, error: err.message });
        setFetchDone(true);
      });
  }, [item.id, item.meta]);

  const handleStreamError = useCallback(() => {
    feedLog.resolution('embed-fallback', { videoId: item.meta?.videoId, title: item.title, reason: 'stream-error' });
    setUseEmbed(true);
  }, [item.meta?.videoId]);

  const ar = (item.meta?.imageWidth && item.meta?.imageHeight)
    ? `${item.meta.imageWidth} / ${item.meta.imageHeight}`
    : '16 / 9';

  if (!fetchDone) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
        <div className="scroll-loading-dots"><span /><span /><span /></div>
      </div>
    );
  }

  if (playerData && !useEmbed && (playerData.videoUrl || playerData.url)) {
    return (
      <FeedPlayer playerData={playerData} onError={handleStreamError} aspectRatio={ar} />
    );
  }

  return (
    <iframe
      src={`https://www.youtube.com/embed/${item.meta.videoId}?autoplay=1&rel=0`}
      title={item.title}
      allow="autoplay; encrypted-media"
      allowFullScreen
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
    />
  );
}
