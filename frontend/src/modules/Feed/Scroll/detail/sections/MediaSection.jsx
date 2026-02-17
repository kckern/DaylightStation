export default function MediaSection({ data }) {
  if (!data?.images?.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {data.images.map((img, i) => (
        <div key={i}>
          <img src={img.url} alt="" style={{ width: '100%', display: 'block', borderRadius: '8px' }} />
          {img.caption && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#5c636a', textAlign: 'center' }}>{img.caption}</p>
          )}
        </div>
      ))}
    </div>
  );
}
