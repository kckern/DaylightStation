export default function MediaBody({ item }) {
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
