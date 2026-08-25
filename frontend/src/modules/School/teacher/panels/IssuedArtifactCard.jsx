/**
 * A teacher-facing representation of a paper record.  The card deliberately
 * speaks in the language of the family (worksheet/result receipt), while the
 * immutable-artifact mechanics remain in the API contract.
 */
import SafeImg from './SafeImg.jsx';

function isReceipt(artifact) {
  return artifact.kind === 'result-receipt' || artifact.role === 'result-receipt';
}

function availabilityLabel(artifact) {
  if (artifact.availability === 'exact') return 'Exact issued file';
  return 'Original print was not archived — only prints issued after artifact retention began are kept';
}

export default function IssuedArtifactCard({ artifact, lessonTitle = 'Lesson' }) {
  const receipt = isReceipt(artifact);
  const url = receipt ? artifact.originalUrl : artifact.originalPdfUrl;
  const title = receipt ? 'Result receipt' : `${lessonTitle} worksheet`;
  if (!url) {
    return <article className="teacher-issued-artifact teacher-issued-artifact--unavailable">
      <div className="teacher-issued-artifact__copy"><strong>{title}</strong><small>{availabilityLabel(artifact)}</small></div>
    </article>;
  }
  return <article className={`teacher-issued-artifact${receipt ? ' teacher-issued-artifact--receipt' : ''}`}>
    <a className={receipt ? 'teacher-issued-artifact__receipt-preview' : 'teacher-issued-artifact__preview'} href={url} target="_blank" rel="noreferrer" aria-label={`Open ${title}`}>
      {receipt
        ? <SafeImg src={url} alt="Printed result receipt" />
        : artifact.thumbnailUrl ? <SafeImg src={artifact.thumbnailUrl} alt={`${title} first page`} /> : <span>PDF</span>}
    </a>
    <div className="teacher-issued-artifact__copy">
      <strong>{title}</strong>
      <small>{receipt
        ? 'Exact printed result file'
        : availabilityLabel(artifact)}</small>
      <div className="teacher-issued-artifact__actions">
        <a href={url} target="_blank" rel="noreferrer">Open {receipt ? 'receipt' : 'worksheet'}</a>
      </div>
    </div>
  </article>;
}
