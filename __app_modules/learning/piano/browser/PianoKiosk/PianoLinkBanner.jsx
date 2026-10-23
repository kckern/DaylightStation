import { usePianoConnection } from './usePianoConnection.js';
import { usePianoSpeakerHelp } from './usePianoSpeakerHelp.js';

/** The sole player-facing connection message and repair action. */
export function PianoLinkBanner() {
  const { health, repair, repairConnection } = usePianoConnection();
  // The backend's silent speaker ladder gave up: only then is there anything to say.
  const speakerNeedsHelp = usePianoSpeakerHelp();
  if (repair.state === 'success') {
    return <div className="piano-linkbanner piano-linkbanner--ok" role="status"><span className="piano-linkbanner__icon" aria-hidden>✓</span><span className="piano-linkbanner__text">{repair.message}</span></div>;
  }
  const initialConnection = health.state === 'connecting' && !health.everReady && repair.state === 'idle';
  if (health.state === 'ready' || initialConnection) {
    if (!speakerNeedsHelp) return null;
    return (
      <div className="piano-linkbanner piano-linkbanner--down" role="status">
        <span className="piano-linkbanner__icon" aria-hidden>!</span>
        <span className="piano-linkbanner__text">Speaker needs help — a grown-up has been told</span>
      </div>
    );
  }
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
