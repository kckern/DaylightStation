import { useState, useEffect } from 'react';
import { formatAge, colorFromLabel, proxyIcon, proxyImage, isImageUrl } from './utils.js';
import { getBodyModule } from './bodies/index.js';

const STATUS_COLORS = {
  red: '#ff6b6b',
  yellow: '#fab005',
  green: '#51cf66',
};

function HeroImage({ src }) {
  const proxied = proxyImage(src);
  const [imgSrc, setImgSrc] = useState(src);
  const [phase, setPhase] = useState('original'); // original → proxy → hidden

  useEffect(() => {
    setImgSrc(src);
    setPhase('original');
  }, [src]);

  const handleError = () => {
    if (phase === 'original' && proxied) {
      setPhase('proxy');
      setImgSrc(proxied);
    } else {
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

export default function FeedCard({ item, colors = {} }) {
  const tier = item.tier || 'wire';
  const sourceName = item.meta?.sourceName || item.meta?.feedTitle || item.source || '';
  const age = formatAge(item.timestamp);
  const iconUrl = proxyIcon(item.meta?.sourceIcon);
  const borderColor = colors[item.source] || colors[tier] || colorFromLabel(item.source);

  const BodyModule = getBodyModule(item.source);

  return (
    <div
      className={`feed-card feed-card-${tier}`}
      style={{
        display: 'block',
        background: '#25262b',
        borderRadius: '12px',
        borderLeft: `4px solid ${borderColor}`,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Hero image */}
      {item.image && isImageUrl(item.image) && (
        <div style={{
            overflow: 'hidden',
            position: 'relative',
            aspectRatio: (item.meta?.imageWidth && item.meta?.imageHeight)
              ? `${item.meta.imageWidth} / ${item.meta.imageHeight}`
              : '16 / 9',
            backgroundColor: '#1a1b1e',
          }}>
          <HeroImage src={item.image} />
          {/* Play button overlay */}
          {(item.source === 'plex' || item.meta?.youtubeId) && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
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
              onError={(e) => { e.target.style.display = 'none'; }}
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
      </div>
    </div>
  );
}
