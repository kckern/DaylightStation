export default function GoodreadsBody({ item }) {
  const author = item.meta?.author || item.body || '';
  const rating = item.meta?.rating;
  const readAt = item.meta?.readAt;

  const stars = rating
    ? Array.from({ length: 5 }, (_, i) => i < rating ? '\u2605' : '\u2606').join('')
    : null;

  const readDate = readAt
    ? new Date(readAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  return (
    <>
      {author && (
        <p style={{
          margin: 0,
          fontSize: '0.85rem',
          color: '#adb5bd',
          lineHeight: 1.4,
        }}>
          {author}
        </p>
      )}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginTop: '0.3rem',
      }}>
        {stars && (
          <span style={{ fontSize: '0.85rem', color: '#f5c518', letterSpacing: '1px' }}>
            {stars}
          </span>
        )}
        {readDate && (
          <span style={{ fontSize: '0.7rem', color: '#5c636a' }}>
            Read {readDate}
          </span>
        )}
      </div>
      {item.meta?.review && (
        <p style={{
          margin: '0.4rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          lineHeight: 1.35,
          fontStyle: 'italic',
          display: '-webkit-box',
          WebkitLineClamp: 8,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          &ldquo;{item.meta.review}&rdquo;
        </p>
      )}
    </>
  );
}
