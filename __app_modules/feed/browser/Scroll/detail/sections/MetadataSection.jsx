export default function MetadataSection({ data }) {
  if (!data?.items?.length) return null;
  return (
    <div>
      {data.items.map(m => (
        <div key={m.label} style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0.35rem 0',
          borderBottom: '1px solid #1e1f23',
        }}>
          <span style={{ fontSize: '0.75rem', color: '#5c636a', textTransform: 'uppercase' }}>{m.label}</span>
          <span style={{ fontSize: '0.8rem', color: '#c1c2c5' }}>{m.value}</span>
        </div>
      ))}
    </div>
  );
}
