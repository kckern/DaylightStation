export default function EmbedSection({ data }) {
  if (!data?.url) return null;
  const [w, h] = (data.aspectRatio || '16:9').split(':').map(Number);
  const paddingTop = `${(h / w) * 100}%`;
  return (
    <div style={{ position: 'relative', width: '100%', paddingTop, background: '#000', borderRadius: '8px', overflow: 'hidden' }}>
      <iframe
        src={data.url}
        title="Embedded content"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
        allow="autoplay; encrypted-media"
        allowFullScreen
      />
    </div>
  );
}
