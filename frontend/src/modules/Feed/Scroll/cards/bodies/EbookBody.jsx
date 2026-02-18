export default function EbookBody({ item }) {
  const author = item.meta?.author;
  const bookTitle = item.meta?.bookTitle;

  return (
    <>
      <h3 style={{
        margin: 0,
        fontSize: '0.95rem',
        fontWeight: 600,
        color: '#fff',
        lineHeight: 1.3,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {item.title}
      </h3>
      {(author || bookTitle) && (
        <p style={{
          margin: '0.15rem 0 0',
          fontSize: '0.75rem',
          color: '#868e96',
          lineHeight: 1.3,
          display: '-webkit-box',
          WebkitLineClamp: 1,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {[author, bookTitle].filter(Boolean).join(' \u2014 ')}
        </p>
      )}
      {item.body && (
        <p style={{
          margin: '0.25rem 0 0',
          fontSize: '0.8rem',
          color: '#adb5bd',
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
