export default function FitnessBody({ item }) {
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
