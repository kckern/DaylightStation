import React from 'react';

const BADGE_STYLES = {
  next_up:    { bg: 'rgba(34,139,230,0.85)', label: 'NEXT UP' },
  resume:     { bg: 'rgba(200,160,40,0.85)', label: 'RESUME' },
  favorite:   { bg: 'rgba(120,120,120,0.7)', label: 'FAVORITE' },
  memorable:  { bg: 'rgba(200,80,40,0.8)',   label: 'TOP EFFORT' },
  discovery:  { bg: 'rgba(80,160,80,0.7)',   label: 'TRY THIS' },
};

export default function SuggestionCard({ suggestion, onClick }) {
  const { type, title, showTitle, thumbnail, poster, orientation,
          durationMinutes, progress, metric, reason, action } = suggestion;

  const badge = BADGE_STYLES[type] || BADGE_STYLES.discovery;
  const isPortrait = orientation === 'portrait';
  const imgSrc = isPortrait ? poster : thumbnail;
  const isMuted = type === 'resume' || type === 'favorite' || type === 'discovery';

  return (
    <div
      className={`suggestion-card suggestion-card--${type}${isMuted ? ' suggestion-card--muted' : ''}`}
      onClick={() => onClick?.(suggestion)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(suggestion); }}
    >
      <div className={`suggestion-card__image${isPortrait ? ' suggestion-card__image--portrait' : ''}`}>
        <img
          src={imgSrc}
          alt=""
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        <span className="suggestion-card__badge" style={{ background: badge.bg }}>
          {badge.label}
        </span>
        {durationMinutes != null && (
          <span className="suggestion-card__duration">{durationMinutes}m</span>
        )}
      </div>

      <div className="suggestion-card__body">
        {showTitle && showTitle !== title && (
          <div className="suggestion-card__show-title">{showTitle}</div>
        )}
        <div className="suggestion-card__title">{title}</div>

        {type === 'resume' && progress && (
          <div className="suggestion-card__progress">
            <div className="suggestion-card__progress-bar">
              <div
                className="suggestion-card__progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span className="suggestion-card__progress-text">{progress.percent}%</span>
          </div>
        )}

        {type === 'memorable' && metric && (
          <div className="suggestion-card__metric">
            {metric.label}: {metric.value}
          </div>
        )}

        {type === 'favorite' && action === 'browse' && (
          <div className="suggestion-card__browse">Browse episodes →</div>
        )}

        {(type === 'next_up' || type === 'resume') && suggestion.lastSessionDate && (
          <div className="suggestion-card__recency">{formatRecency(suggestion.lastSessionDate)}</div>
        )}

        {type === 'discovery' && reason && (
          <div className="suggestion-card__reason">{reason}</div>
        )}
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
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}
