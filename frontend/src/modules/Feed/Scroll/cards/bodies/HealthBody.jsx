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

export default function HealthBody({ item }) {
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
