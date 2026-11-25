export default function DefaultBody({ item }) {
  return (
    <>
      <h3 style={{
        margin: 0,
        fontSize: '0.95rem',
        fontWeight: 600,
        color: 'var(--feed-pure-white)',
        lineHeight: 1.3,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {item.title}
      </h3>
      {item.body && (
        <p style={{
          margin: '0.3rem 0 0',
          fontSize: '0.8rem',
          color: 'var(--feed-text-3)',
          lineHeight: 1.35,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {item.body}
        </p>
      )}
    </>
  );
}
