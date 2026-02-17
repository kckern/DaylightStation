export default function StatsSection({ data }) {
  if (!data?.items?.length) return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
      gap: '0.5rem',
    }}>
      {data.items.map(s => (
        <div key={s.label} style={{
          background: '#1a1b1e',
          borderRadius: '8px',
          padding: '0.5rem',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.6rem', color: '#5c636a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
          <div style={{ fontSize: '0.95rem', color: '#fff', fontWeight: 600, marginTop: '0.15rem' }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}
