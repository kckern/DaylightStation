export default function SlideShow({ contentId }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '1.5rem' }}>Slideshow</p>
        <p style={{ fontSize: '0.9rem', opacity: 0.6 }}>{contentId}</p>
      </div>
    </div>
  );
}
