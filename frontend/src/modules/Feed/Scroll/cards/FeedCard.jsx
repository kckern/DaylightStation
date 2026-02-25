import { useState, useEffect, useCallback, useRef } from 'react';
import { formatAge, proxyIcon, proxyImage, isImageUrl } from './utils.js';
import { getBodyModule } from './bodies/index.js';
import { getContentPlugin } from '../../contentPlugins/index.js';
import { feedLog } from '../feedLog.js';
import FeedPlayer from '../../players/FeedPlayer.jsx';
import { DaylightAPI } from '../../../../lib/api.mjs';

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

function HeroImage({ src, thumbnail }) {
  const proxied = proxyImage(src);
  const [imgSrc, setImgSrc] = useState(thumbnail || src);
  const [phase, setPhase] = useState(thumbnail ? 'thumbnail' : 'original');
  // Track when full image is loaded and ready to display
  const [fullLoaded, setFullLoaded] = useState(!thumbnail);
  const loadStartRef = useRef(performance.now());

  useEffect(() => {
    setImgSrc(thumbnail || src);
    setPhase(thumbnail ? 'thumbnail' : 'original');
    setFullLoaded(!thumbnail);
    loadStartRef.current = performance.now();
  }, [src, thumbnail]);

  // Preload full image in background when we have a thumbnail
  useEffect(() => {
    if (!thumbnail || !src || thumbnail === src) return;
    const img = new Image();
    img.onload = () => {
      const durationMs = Math.round(performance.now() - loadStartRef.current);
      feedLog.timing('card-image-preload', { phase: 'full', durationMs, src });
      setImgSrc(src);
      setPhase('original');
      loadStartRef.current = performance.now();
      requestAnimationFrame(() => setFullLoaded(true));
    };
    img.onerror = () => {
      const durationMs = Math.round(performance.now() - loadStartRef.current);
      feedLog.image('card hero full-res failed, keeping thumbnail', { src, thumbnail, durationMs });
      setFullLoaded(true);
    };
    img.src = src;
    return () => { img.onload = null; img.onerror = null; };
  }, [src, thumbnail]);

  const handleError = () => {
    const durationMs = Math.round(performance.now() - loadStartRef.current);
    if (phase === 'thumbnail' && src && src !== thumbnail) {
      feedLog.image('card hero thumbnail failed', { thumbnail, src, durationMs });
      setPhase('original');
      setImgSrc(src);
      setFullLoaded(true);
      loadStartRef.current = performance.now();
    } else if ((phase === 'original' || phase === 'thumbnail') && proxied) {
      feedLog.image('card hero fallback to proxy', { original: src, proxy: proxied, durationMs });
      setPhase('proxy');
      setImgSrc(proxied);
      setFullLoaded(true);
      loadStartRef.current = performance.now();
    } else {
      feedLog.image('card hero hidden', { src, durationMs });
      setPhase('hidden');
    }
  };

  if (phase === 'hidden') return null;

  return (
    <img
      src={imgSrc}
      alt=""
      className="feed-card-image"
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        objectFit: 'cover',
        opacity: fullLoaded ? 1 : 0.6,
        transition: 'opacity 0.4s ease-in-out',
      }}
      onLoad={() => {
        const durationMs = Math.round(performance.now() - loadStartRef.current);
        feedLog.timing('card-image', { phase, durationMs, src: imgSrc });
      }}
      onError={handleError}
    />
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
      feedLog.interaction('inline-play', { id: item.id, contentType: item.contentType, videoId: item.meta?.videoId });
      setPlayingInline(true);
    } else {
      feedLog.interaction('remote-play', { id: item.id, contentType: item.contentType });
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
          ) : (
            <>
              <HeroImage src={item.image} thumbnail={item.thumbnail} />
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
          {/* Dismiss button overlay */}
          {onDismiss && (
            <button
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
        {/* Dismiss footer for text-only cards */}
        {onDismiss && !(item.image && isImageUrl(item.image)) && (
          <div style={{
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

    feedLog.resolution('native-attempt', { videoId: item.meta?.videoId, quality: '720p' });

    DaylightAPI(`/api/v1/feed/detail/${encodeURIComponent(item.id)}?${params}`)
      .then(result => {
        const durationMs = Math.round(performance.now() - fetchStart);
        const section = result?.sections?.find(s => s.type === 'player' && s.data?.provider === 'youtube');
        if (section) {
          feedLog.resolution('native-resolved', {
            videoId: item.meta?.videoId,
            hasVideoUrl: !!section.data?.videoUrl,
            hasAudioUrl: !!section.data?.audioUrl,
            hasUrl: !!section.data?.url,
            mode: (section.data?.videoUrl && section.data?.audioUrl) ? 'split' : 'combined',
            durationMs,
          });
          setPlayerData(section.data);
        } else {
          feedLog.resolution('native-no-player-section', { videoId: item.meta?.videoId, durationMs, sectionCount: result?.sections?.length || 0 });
        }
        setFetchDone(true);
      })
      .catch((err) => {
        feedLog.resolution('native-fetch-error', { videoId: item.meta?.videoId, error: err.message });
        setFetchDone(true);
      });
  }, [item.id, item.meta]);

  const handleStreamError = useCallback(() => {
    feedLog.resolution('embed-fallback', { videoId: item.meta?.videoId, reason: 'stream-error' });
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
