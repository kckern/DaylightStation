import { safeImage } from '../../cards/utils.js';
export default function GallerySection({ data, onNavigateToItem }) {
  if (!data?.items?.length) return null;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '3px',
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      {data.items.map((item, index) => {
        const title = typeof item.title === 'string' ? item.title.trim() : '';
        return (
          <button
            type="button"
            key={item.id}
            onClick={() => onNavigateToItem?.(item)}
            aria-label={`Open ${title || `photo ${index + 1} of ${data.items.length}`}`}
            style={{
              aspectRatio: '1',
              cursor: 'pointer',
              overflow: 'hidden',
              padding: 0,
              border: 0,
              background: 'transparent',
            }}
          >
            {safeImage(item.image) && <img
              src={safeImage(item.image)}
              alt=""
              loading="lazy"
              decoding="async"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />}
          </button>
        );
      })}
    </div>
  );
}
