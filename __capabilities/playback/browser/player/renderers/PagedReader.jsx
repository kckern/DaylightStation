// frontend/src/modules/Player/renderers/PagedReader.jsx

/**
 * Stub: Paged reader for comics/manga (Komga).
 * Will be implemented when Komga integration is active.
 */
export default function PagedReader({ contentId }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '1.5rem' }}>Paged Reader</p>
        <p style={{ fontSize: '0.9rem', opacity: 0.6 }}>{contentId}</p>
      </div>
    </div>
  );
}
