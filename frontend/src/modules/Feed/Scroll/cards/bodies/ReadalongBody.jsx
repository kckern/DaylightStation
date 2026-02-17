export default function ReadalongBody({ item }) {
  const heading = item.body || item.meta?.subtitle || '';
  const reference = item.title || '';
  const firstLine = item.meta?.firstLine || '';
  const preview = firstLine ? `${reference}\u2014${firstLine}\u2026` : reference;

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
        {heading}
      </h3>
      {preview && (
        <p style={{
          margin: '0.3rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          lineHeight: 1.35,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {preview}
        </p>
      )}
    </>
  );
}
