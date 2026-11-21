import { safeImage } from '../../cards/utils.js';
export default function MediaSection({ data }) {
  const images = (data?.images || []).map((img) => ({ ...img, url: safeImage(img?.url) })).filter((img) => img.url);
  if (!images.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {images.map((img, i) => (
        <div key={i}>
          <img src={img.url} alt="" loading="lazy" decoding="async" style={{ width: '100%', display: 'block', borderRadius: '8px' }} />
          {img.caption && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#5c636a', textAlign: 'center' }}>{img.caption}</p>
          )}
        </div>
      ))}
    </div>
  );
}
