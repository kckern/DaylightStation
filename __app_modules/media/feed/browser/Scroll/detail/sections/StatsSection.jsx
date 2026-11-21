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
          background: 'var(--feed-surface-1)',
          borderRadius: '8px',
          padding: '0.5rem',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--feed-text-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
          <div style={{ fontSize: '0.95rem', color: 'var(--feed-text-1)', fontWeight: 600, marginTop: '0.15rem' }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}
