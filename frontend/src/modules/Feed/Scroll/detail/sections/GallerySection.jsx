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
      {data.items.map(item => (
        <button
          type="button"
          key={item.id}
          onClick={() => onNavigateToItem?.(item)}
          aria-label={`Open ${item.title || 'gallery item'}`}
          style={{
            aspectRatio: '1',
            cursor: 'pointer',
            overflow: 'hidden',
            padding: 0,
            border: 0,
            background: 'transparent',
          }}
        >
          <img
            src={item.image}
            alt=""
            loading="lazy"
            decoding="async"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </button>
      ))}
    </div>
  );
}
