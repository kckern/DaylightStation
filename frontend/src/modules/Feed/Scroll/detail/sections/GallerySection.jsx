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
        <div
          key={item.id}
          onClick={() => onNavigateToItem?.(item)}
          style={{
            aspectRatio: '1',
            cursor: 'pointer',
            overflow: 'hidden',
          }}
        >
          <img
            src={item.image}
            alt=""
            loading="lazy"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </div>
      ))}
    </div>
  );
}
