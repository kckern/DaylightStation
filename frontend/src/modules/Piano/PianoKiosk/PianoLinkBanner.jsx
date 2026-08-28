import { usePianoConnection } from './usePianoConnection.js';

/** The sole player-facing connection message and repair action. */
export function PianoLinkBanner() {
  const { health, repair, repairConnection } = usePianoConnection();
  if (repair.state === 'success') {
    return <div className="piano-linkbanner piano-linkbanner--ok" role="status"><span className="piano-linkbanner__icon" aria-hidden>✓</span><span className="piano-linkbanner__text">{repair.message}</span></div>;
  }
  const initialConnection = health.state === 'connecting' && !health.everReady && repair.state === 'idle';
  if (health.state === 'ready' || initialConnection) return null;
  return (
    <div className="piano-linkbanner piano-linkbanner--down" role="alert">
      <span className="piano-linkbanner__icon" aria-hidden>!</span>
      <span className="piano-linkbanner__text">
        Piano connection lost. Your sound changes are saved.
        {repair.state === 'failed' && <small className="piano-linkbanner__detail"> {repair.message}</small>}
      </span>
      <button type="button" className="piano-linkbanner__reset" onClick={repairConnection} disabled={repair.state === 'working'}>
        {repair.state === 'working' ? 'Reconnecting…' : 'Reconnect'}
      </button>
    </div>
  );
}

export default PianoLinkBanner;
