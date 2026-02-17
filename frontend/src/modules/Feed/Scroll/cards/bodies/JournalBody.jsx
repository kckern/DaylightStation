import DefaultBody from './DefaultBody.jsx';

export default function JournalBody({ item }) {
  const hasBody = item.body && item.body.trim();
  return (
    <>
      {hasBody ? (
        <p style={{
          margin: 0,
          fontSize: '0.9rem',
          color: '#dee2e6',
          lineHeight: 1.5,
          fontStyle: 'italic',
        }}>
          &ldquo;{item.body}&rdquo;
        </p>
      ) : (
        <DefaultBody item={item} />
      )}
      {item.meta?.senderName && (
        <p style={{
          margin: '0.4rem 0 0',
          fontSize: '0.7rem',
          color: '#5c636a',
          textAlign: 'right',
        }}>
          &mdash; {item.meta.senderName}
        </p>
      )}
    </>
  );
}
