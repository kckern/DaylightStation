import { formatAge } from './utils.js';

const STATUS_COLORS = {
  red: '#ff6b6b',
  yellow: '#fab005',
  green: '#51cf66',
};

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
          background: '#1a1b1e',
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

export default function GroundingCard({ item }) {
  const age = formatAge(item.timestamp);
  const sourceName = item.meta?.sourceName || item.source || '';
  const isGratitude = item.source === 'gratitude';
  const isStats = item.meta?.weight || item.meta?.minutes || item.meta?.tempF;
  const hasStatus = item.meta?.status;

  return (
    <div
      className="feed-card feed-card-grounding"
      style={{
        background: '#25262b',
        borderRadius: '12px',
        borderLeft: '4px solid #fab005',
        padding: '0.75rem 1rem',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        marginBottom: '0.35rem',
      }}>
        {hasStatus && <StatusDot status={item.meta.status} />}
        <span style={{
          fontSize: '0.7rem',
          fontWeight: 600,
          color: '#868e96',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
        }}>
          {sourceName}
        </span>
        <span style={{
          fontSize: '0.65rem',
          color: '#5c636a',
          marginLeft: 'auto',
        }}>
          {age}
        </span>
      </div>

      {!isGratitude && (
        <h3 style={{
          margin: 0,
          fontSize: '0.95rem',
          fontWeight: 500,
          color: '#fff',
          lineHeight: 1.35,
        }}>
          {item.title}
        </h3>
      )}

      {isGratitude ? (
        <p style={{
          margin: 0,
          fontSize: '0.95rem',
          fontStyle: 'italic',
          color: '#fff3bf',
          lineHeight: 1.5,
        }}>
          {item.body || item.title}
        </p>
      ) : isStats ? (
        <StatGrid meta={item.meta} />
      ) : item.body ? (
        <p style={{
          margin: '0.25rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          lineHeight: 1.3,
        }}>
          {item.body}
        </p>
      ) : null}

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
  );
}
