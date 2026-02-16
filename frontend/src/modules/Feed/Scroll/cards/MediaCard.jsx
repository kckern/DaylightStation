import { formatAge } from './utils.js';

export default function MediaCard({ item }) {
  const age = formatAge(item.timestamp);
  const isPlex = item.source === 'plex';
  const subtitle = item.body || item.meta?.location || null;

  if (!item.image) {
    // Fallback: no image — render as simple card
    return (
      <div
        className="feed-card feed-card-media"
        style={{
          background: '#25262b',
          borderRadius: '12px',
          padding: '0.85rem 1rem',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          marginBottom: '0.35rem',
        }}>
          {isPlex && (
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
              Plex
            </span>
          )}
          <span style={{
            fontSize: '0.7rem',
            color: '#868e96',
            textTransform: 'uppercase',
          }}>
            {item.meta?.sourceName || item.source}
          </span>
          <span style={{ fontSize: '0.65rem', color: '#5c636a', marginLeft: 'auto' }}>
            {age}
          </span>
        </div>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 500, color: '#fff' }}>
          {item.title}
        </h3>
        {subtitle && (
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#868e96' }}>
            {subtitle}
          </p>
        )}
      </div>
    );
  }

  const Wrapper = item.link ? 'a' : 'div';
  const wrapperProps = item.link
    ? { href: item.link, target: '_blank', rel: 'noopener noreferrer' }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className="feed-card feed-card-media feed-card-photo"
      style={{
        display: 'block',
        borderRadius: '12px',
        overflow: 'hidden',
        position: 'relative',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <img
        src={item.image}
        alt=""
        style={{
          width: '100%',
          display: 'block',
          maxHeight: '320px',
          objectFit: 'cover',
        }}
      />

      {/* Bottom scrim overlay */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '2.5rem 1rem 0.75rem',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          marginBottom: '0.2rem',
        }}>
          {isPlex && (
            <span style={{
              display: 'inline-block',
              background: '#fab005',
              color: '#000',
              fontSize: '0.55rem',
              fontWeight: 700,
              padding: '0.1rem 0.35rem',
              borderRadius: '4px',
              textTransform: 'uppercase',
            }}>
              Plex
            </span>
          )}
          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.7)' }}>
            {age}
          </span>
        </div>
        {item.title && (
          <h3 style={{
            margin: 0,
            fontSize: '1rem',
            fontWeight: 600,
            color: '#fff',
            lineHeight: 1.25,
            textShadow: '0 1px 3px rgba(0,0,0,0.5)',
          }}>
            {item.title}
          </h3>
        )}
        {subtitle && (
          <p style={{
            margin: '0.15rem 0 0',
            fontSize: '0.75rem',
            color: 'rgba(255,255,255,0.7)',
          }}>
            {subtitle}
          </p>
        )}
      </div>
    </Wrapper>
  );
}
