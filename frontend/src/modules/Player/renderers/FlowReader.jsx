// frontend/src/modules/Player/renderers/FlowReader.jsx

/**
 * Stub: Flow/scroll reader for webtoons and long-strip comics.
 * Will be implemented when Komga integration is active.
 */
export default function FlowReader({ contentId }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '1.5rem' }}>Flow Reader</p>
        <p style={{ fontSize: '0.9rem', opacity: 0.6 }}>{contentId}</p>
      </div>
    </div>
  );
}
