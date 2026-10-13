export default function GratitudeBody({ item }) {
  const items = item.meta?.items;

  // Bundled card: show up to 3 items with avatars
  if (items && items.length > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {items.map((entry, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {entry.userId && (
              <img
                src={`/api/v1/static/img/users/${entry.userId}`}
                alt=""
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  flexShrink: 0,
                  objectFit: 'cover',
                }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            )}
            <p style={{
              margin: 0,
              fontSize: '0.9rem',
              fontStyle: 'italic',
              color: '#fff3bf',
              lineHeight: 1.4,
              wordBreak: 'break-word',
              flex: 1,
            }}>
              {entry.text}
            </p>
            {entry.displayName && (
              <span style={{
                fontSize: '0.65rem',
                color: '#5c636a',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}>
                {entry.displayName}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Fallback: single item (legacy shape)
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
