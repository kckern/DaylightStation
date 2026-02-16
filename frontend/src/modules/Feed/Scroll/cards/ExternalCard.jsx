import { formatAge, colorFromLabel, proxyIcon } from './utils.js';

export default function ExternalCard({ item }) {
  const age = formatAge(item.timestamp);
  const sourceName = item.meta?.sourceName || item.meta?.feedTitle || item.source || '';
  const iconUrl = proxyIcon(item.meta?.sourceIcon);
  const borderColor = colorFromLabel(sourceName);
  const isReddit = item.source === 'reddit';

  return (
    <a
      className="feed-card feed-card-external"
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'block',
        background: '#25262b',
        borderRadius: '12px',
        borderLeft: `4px solid ${borderColor}`,
        textDecoration: 'none',
        color: 'inherit',
        overflow: 'hidden',
      }}
    >
      {item.image && (
        <div style={{ overflow: 'hidden', maxHeight: '180px' }}>
          <img
            src={item.image}
            alt=""
            style={{
              width: '100%',
              maxHeight: '180px',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </div>
      )}

      <div style={{ padding: '0.75rem 1rem' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          marginBottom: '0.4rem',
        }}>
          {iconUrl && (
            <img
              src={iconUrl}
              alt=""
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                flexShrink: 0,
              }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}
          <span style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: '#868e96',
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {sourceName}
          </span>
          <span style={{
            fontSize: '0.65rem',
            color: '#5c636a',
            marginLeft: 'auto',
            flexShrink: 0,
          }}>
            {age}
          </span>
        </div>

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

        {item.body && (
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
            {item.body}
          </p>
        )}

        {isReddit && (item.meta?.score != null || item.meta?.numComments != null) && (
          <div style={{
            display: 'flex',
            gap: '0.75rem',
            marginTop: '0.5rem',
            fontSize: '0.7rem',
            color: '#868e96',
          }}>
            {item.meta?.score != null && (
              <span>{item.meta.score.toLocaleString()} pts</span>
            )}
            {item.meta?.numComments != null && (
              <span>{item.meta.numComments} comments</span>
            )}
          </div>
        )}
      </div>
    </a>
  );
}
