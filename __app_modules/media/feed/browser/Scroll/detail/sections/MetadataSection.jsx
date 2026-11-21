export default function MetadataSection({ data }) {
  if (!data?.items?.length) return null;
  return (
    <div>
      {data.items.map(m => (
        <div key={m.label} style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0.35rem 0',
          borderBottom: '1px solid var(--feed-border)',
        }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--feed-text-2)', textTransform: 'uppercase' }}>{m.label}</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--feed-text-1)' }}>{m.value}</span>
        </div>
      ))}
    </div>
  );
}
