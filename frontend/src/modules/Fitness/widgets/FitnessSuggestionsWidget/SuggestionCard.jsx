import React from 'react';

const BADGE_STYLES = {
  next_up:    { bg: 'rgba(34,139,230,0.85)', label: 'NEXT UP' },
  resume:     { bg: 'rgba(200,160,40,0.85)', label: 'RESUME' },
  favorite:   { bg: 'rgba(120,120,120,0.7)', label: 'FAVORITE' },
  memorable:  { bg: 'rgba(200,80,40,0.8)',   label: 'TOP EFFORT' },
  discovery:  { bg: 'rgba(80,160,80,0.7)',   label: 'TRY THIS' },
};

export default function SuggestionCard({ suggestion, onPlay, onBrowse }) {
  const { type, title, showTitle, description, thumbnail,
          durationMinutes, progress, reason, poster } = suggestion;

  const badge = BADGE_STYLES[type] || BADGE_STYLES.discovery;
  const isMuted = type === 'resume' || type === 'favorite' || type === 'discovery';
  const recency = (type === 'next_up' || type === 'resume') && suggestion.lastSessionDate
    ? formatRecency(suggestion.lastSessionDate) : null;

  return (
    <div className={`suggestion-card suggestion-card--${type}${isMuted ? ' suggestion-card--muted' : ''}`}>
      {/* Image area — click to play */}
      <div
        className="suggestion-card__image"
        onClick={() => onPlay?.(suggestion)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlay?.(suggestion); }}
      >
        <img src={thumbnail} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
        <span className="suggestion-card__badge" style={{ background: badge.bg }}>
          {badge.label}
        </span>
        {durationMinutes != null && (
          <span className="suggestion-card__duration">{durationMinutes}m</span>
        )}
        {recency && (
          <span className="suggestion-card__recency-overlay">{recency}</span>
        )}
      </div>

      {/* Body area — click to browse show with episode selected */}
      <div
        className="suggestion-card__body"
        onClick={() => onBrowse?.(suggestion)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onBrowse?.(suggestion); }}
      >
        {poster && (
          <div className="suggestion-card__mini-poster">
            <img src={poster} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
          </div>
        )}
        <div className="suggestion-card__body-text">
          <div className="suggestion-card__title-desc">
            <span className="suggestion-card__title">{title}</span>
            {description && <>{' — '}<span className="suggestion-card__desc-inline">{description}</span></>}
          </div>

          {type === 'resume' && progress && (
            <div className="suggestion-card__progress">
              <div className="suggestion-card__progress-bar">
                <div className="suggestion-card__progress-fill" style={{ width: `${progress.percent}%` }} />
              </div>
              <span className="suggestion-card__progress-text">{progress.percent}%</span>
            </div>
          )}

          {type === 'memorable' && reason && (
            <div className="suggestion-card__metric">{reason}</div>
          )}

          {type === 'discovery' && reason && (
            <div className="suggestion-card__reason">{reason}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRecency(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const d = new Date(dateStr + 'T12:00:00');
  const days = Math.round((now - d) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}
