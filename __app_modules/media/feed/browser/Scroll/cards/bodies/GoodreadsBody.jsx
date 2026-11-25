import { formatGoodreadsReadAt } from '../../../../shared/goodreadsDate.mjs';
import { formatGoodreadsRating } from '../../../../shared/goodreadsRating.mjs';

export default function GoodreadsBody({ item }) {
  const author = item.meta?.author || item.body || '';
  const rating = formatGoodreadsRating(item.meta?.rating);
  const readAt = item.meta?.readAt;

  const readDate = formatGoodreadsReadAt(readAt) || null;

  return (
    <>
      {author && (
        <p style={{
          margin: 0,
          fontSize: '0.85rem',
          color: 'var(--feed-text-2)',
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
        {rating && (
          <span role="img" aria-label={rating.label} style={{ fontSize: '0.85rem', color: '#f5c518', /* data-color: star rating gold */ letterSpacing: '1px' }}>
            {rating.stars}
          </span>
        )}
        {readDate && (
          <span style={{ fontSize: '0.7rem', color: 'var(--feed-text-4)' }}>
            Read {readDate}
          </span>
        )}
      </div>
      {item.meta?.review && (
        <p style={{
          margin: '0.4rem 0 0',
          fontSize: '0.8rem',
          color: 'var(--feed-text-3)',
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
