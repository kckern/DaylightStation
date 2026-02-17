import { formatAge, colorFromLabel, proxyIcon } from './utils.js';

const STATUS_COLORS = {
  red: '#ff6b6b',
  yellow: '#fab005',
  green: '#51cf66',
};

// ─── Sub-components ──────────────────────────────────────

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

function memoryAge(isoDate) {
  if (!isoDate) return null;
  const diff = Date.now() - new Date(isoDate).getTime();
  if (diff < 0) return null;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365.25);
  const remMonths = Math.floor((days - years * 365.25) / 30.44);
  if (remMonths > 0) return `${years} year${years === 1 ? '' : 's'}, ${remMonths} month${remMonths === 1 ? '' : 's'} ago`;
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

function StatGrid({ meta }) {
  const stats = [];
  if (meta?.weight?.lbs) stats.push({ label: 'Weight', value: `${meta.weight.lbs} lbs` });
  if (meta?.steps) stats.push({ label: 'Steps', value: meta.steps.toLocaleString() });
  if (meta?.minutes) stats.push({ label: 'Duration', value: `${Math.round(meta.minutes)} min` });
  if (meta?.avgHeartrate) stats.push({ label: 'Avg HR', value: `${Math.round(meta.avgHeartrate)} bpm` });
  if (meta?.nutrition?.calories) stats.push({ label: 'Calories', value: meta.nutrition.calories });
  if (meta?.nutrition?.protein) stats.push({ label: 'Protein', value: `${meta.nutrition.protein}g` });
  if (meta?.tempF != null) stats.push({ label: 'Temp', value: `${meta.tempF}\u00b0F` });
  if (meta?.aqi) stats.push({ label: 'AQI', value: meta.aqi });
  if (stats.length === 0) return null;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))',
      gap: '0.4rem',
      marginTop: '0.4rem',
    }}>
      {stats.map(s => (
        <div key={s.label} style={{
          background: '#111',
          borderRadius: '6px',
          padding: '0.35rem 0.5rem',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.6rem', color: '#5c636a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
          <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 600, marginTop: '0.1rem' }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Body Modules ────────────────────────────────────────

function DefaultBody({ item }) {
  return (
    <>
      <h3 style={{
        margin: 0,
        fontSize: '0.95rem',
        fontWeight: 600,
        color: '#fff',
        lineHeight: 1.3,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {item.title}
      </h3>
      {item.body && (
        <p style={{
          margin: '0.3rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          lineHeight: 1.35,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {item.body}
        </p>
      )}
    </>
  );
}

function RedditBody({ item }) {
  return (
    <>
      <DefaultBody item={item} />
      {(item.meta?.score != null || item.meta?.numComments != null) && (
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          marginTop: '0.5rem',
          fontSize: '0.7rem',
          color: '#868e96',
        }}>
          {item.meta?.score != null && (
            <span>{item.meta.score.toLocaleString()} pts</span>
          )}
          {item.meta?.numComments != null && (
            <span>{item.meta.numComments} comments</span>
          )}
        </div>
      )}
    </>
  );
}

function GratitudeBody({ item }) {
  return (
    <p style={{
      margin: 0,
      fontSize: '0.95rem',
      fontStyle: 'italic',
      color: '#fff3bf',
      lineHeight: 1.5,
      wordBreak: 'break-word',
    }}>
      {item.body || item.title}
    </p>
  );
}

function WeatherBody({ item }) {
  const meta = item.meta || {};
  const temp = meta.tempF ?? meta.temperature ?? meta.temp;
  const conditions = meta.conditions || item.body;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fab005" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
      <div style={{ flex: 1 }}>
        {temp != null ? (
          <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff', lineHeight: 1 }}>
            {temp}&deg;
          </span>
        ) : item.title ? (
          <span style={{ fontSize: '1rem', fontWeight: 600, color: '#fff' }}>
            {item.title}
          </span>
        ) : null}
        {conditions && (
          <span style={{ display: 'block', fontSize: '0.85rem', color: '#868e96', lineHeight: 1.3 }}>
            {conditions}
          </span>
        )}
      </div>
    </div>
  );
}

function FitnessBody({ item }) {
  const meta = item.meta || {};
  const activityType = meta.activityType || meta.type || 'Activity';
  const statKeys = ['distance', 'duration', 'avgHR', 'pace', 'elevation', 'calories'];
  const statLabels = {
    distance: 'Distance', duration: 'Duration', avgHR: 'Avg HR',
    pace: 'Pace', elevation: 'Elevation', calories: 'Calories',
  };
  const stats = statKeys
    .filter(k => meta[k] != null)
    .map(k => ({ key: k, value: meta[k], label: statLabels[k] }));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
        <span style={{
          display: 'inline-block',
          background: '#2c2e33',
          color: '#51cf66',
          fontSize: '0.6rem',
          fontWeight: 700,
          padding: '0.15rem 0.5rem',
          borderRadius: '999px',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {activityType}
        </span>
      </div>
      <h3 style={{
        margin: '0 0 0.5rem',
        fontSize: '0.95rem',
        fontWeight: 500,
        color: '#fff',
        lineHeight: 1.35,
      }}>
        {item.title}
      </h3>
      {stats.length > 0 && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {stats.map(stat => (
            <div key={stat.key} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              minWidth: '50px',
              padding: '0.4rem 0.5rem',
              background: '#2c2e33',
              borderRadius: '8px',
            }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff', lineHeight: 1.2 }}>
                {stat.value}
              </span>
              <span style={{ fontSize: '0.6rem', color: '#868e96', textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: '0.15rem' }}>
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function JournalBody({ item }) {
  const hasBody = item.body && item.body.trim();
  return (
    <>
      {hasBody ? (
        <p style={{
          margin: 0,
          fontSize: '0.9rem',
          color: '#dee2e6',
          lineHeight: 1.5,
          fontStyle: 'italic',
        }}>
          &ldquo;{item.body}&rdquo;
        </p>
      ) : (
        <DefaultBody item={item} />
      )}
      {item.meta?.senderName && (
        <p style={{
          margin: '0.4rem 0 0',
          fontSize: '0.7rem',
          color: '#5c636a',
          textAlign: 'right',
        }}>
          &mdash; {item.meta.senderName}
        </p>
      )}
    </>
  );
}

function HealthBody({ item }) {
  const hasStats = item.meta?.weight || item.meta?.steps || item.meta?.minutes
    || item.meta?.avgHeartrate || item.meta?.nutrition;
  return (
    <>
      <h3 style={{
        margin: 0,
        fontSize: '0.95rem',
        fontWeight: 500,
        color: '#fff',
        lineHeight: 1.35,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {item.title}
      </h3>
      {hasStats ? (
        <StatGrid meta={item.meta} />
      ) : item.body ? (
        <p style={{
          margin: '0.25rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          lineHeight: 1.3,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {item.body}
        </p>
      ) : null}
    </>
  );
}

function PhotoBody({ item }) {
  const location = item.body || item.meta?.location || null;
  const photoAge = memoryAge(item.meta?.originalDate);
  const heading = location || item.title;
  const desc = location ? photoAge : null;

  return (
    <>
      <h3 style={{
        margin: 0,
        fontSize: '0.95rem',
        fontWeight: 600,
        color: '#fff',
        lineHeight: 1.3,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {heading}
      </h3>
      {desc && (
        <p style={{
          margin: '0.3rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          lineHeight: 1.35,
        }}>
          {desc}
        </p>
      )}
    </>
  );
}

function MediaBody({ item }) {
  const subtitle = item.body || null;
  const label = item.meta?.sourceName || item.source || 'Media';
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <span style={{
          display: 'inline-block',
          background: '#fab005',
          color: '#000',
          fontSize: '0.6rem',
          fontWeight: 700,
          padding: '0.1rem 0.4rem',
          borderRadius: '4px',
          textTransform: 'uppercase',
        }}>
          {label}
        </span>
      </div>
      <h3 style={{
        margin: 0,
        fontSize: '0.95rem',
        fontWeight: 500,
        color: '#fff',
        wordBreak: 'break-word',
      }}>
        {item.title}
      </h3>
      {subtitle && (
        <p style={{
          margin: '0.25rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          wordBreak: 'break-word',
        }}>
          {subtitle}
        </p>
      )}
    </>
  );
}

// ─── Body Module Registry ────────────────────────────────

const BODY_MODULES = {
  reddit: RedditBody,
  gratitude: GratitudeBody,
  weather: WeatherBody,
  fitness: FitnessBody,
  journal: JournalBody,
  health: HealthBody,
  photo: PhotoBody,
  plex: MediaBody,
};

// ─── Main Component ──────────────────────────────────────

export default function FeedCard({ item, colors = {} }) {
  const tier = item.tier || 'wire';
  const sourceName = item.meta?.sourceName || item.meta?.feedTitle || item.source || '';
  const age = formatAge(item.timestamp);
  const iconUrl = proxyIcon(item.meta?.sourceIcon);
  const borderColor = colors[item.source] || colors[tier] || colorFromLabel(item.source);

  const BodyModule = BODY_MODULES[item.source] || DefaultBody;

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
      {item.image && (
        <div style={{
            overflow: 'hidden',
            position: 'relative',
            aspectRatio: (item.meta?.imageWidth && item.meta?.imageHeight)
              ? `${item.meta.imageWidth} / ${item.meta.imageHeight}`
              : '16 / 9',
            backgroundColor: '#1a1b1e',
          }}>
          <img
            src={item.image}
            alt=""
            className="feed-card-image"
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              objectFit: 'cover',
            }}
          />
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
