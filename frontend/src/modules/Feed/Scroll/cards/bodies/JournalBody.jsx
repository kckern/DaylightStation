import DefaultBody from './DefaultBody.jsx';

export default function JournalBody({ item }) {
  const hasBody = item.body && item.body.trim();
  return (
    <>
      {item.title && (
        <h3 style={{
          margin: '0 0 0.3rem',
          fontSize: '0.95rem',
          fontWeight: 600,
          color: '#fff',
          lineHeight: 1.3,
        }}>
          {item.title}
        </h3>
      )}
      {hasBody ? (
        <p style={{
          margin: 0,
          fontSize: '0.9rem',
          color: '#dee2e6',
          lineHeight: 1.1,
          // justify
          textAlign: 'justify',
          fontStyle: 'italic',
        }}>
          &ldquo;{item.body}&rdquo;
        </p>
      ) : (
        <DefaultBody item={item} />
      )}
      {item.meta?.senderName && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '0.35rem',
          marginTop: '0.4rem',
        }}>
          {item.meta.senderId && (
            <img
              src={`/api/v1/static/img/users/${item.meta.senderId}`}
              alt=""
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                objectFit: 'cover',
              }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}
          <span style={{
            fontSize: '0.7rem',
            color: '#5c636a',
          }}>
            &mdash; {item.meta.senderName}
          </span>
        </div>
      )}
    </>
  );
}
