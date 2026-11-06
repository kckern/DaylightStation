/**
 * ScanStatusChip — the open shelf's answer to "did it get my scan?"
 * (book-scan experience, 2026-11-05).
 *
 * A child scanning a stack used to see nothing until a book opened: a scan
 * that landed mid-step waited silently on the server, and a scan the shelf
 * claimed at once still took a lookup and a claim before anything moved. The
 * chip says so at once — `Got it — looking it up` — and counts the books
 * still behind the one on screen.
 *
 * `superseded` are books the server will no longer hand to this shelf: their
 * intent was dismissed, expired or evicted (on the Portal waiting scans queue
 * and are never superseded by another scan), and each stays an unfiled pile
 * card (hidden while the shelf is open). Each is named with the one thing
 * that opens it.
 *
 * It sits in the shelf header's free middle (`ScreenHeader` `status`), never
 * in the body flow, so its coming and going moves nothing on the shelf.
 */
import PropTypes from 'prop-types';
import "./scanStatusChip.scss";

export function waitingCopy(count) {
  return count === 1 ? '1 more book waiting' : `${count} more books waiting`;
}

export default function ScanStatusChip({ acknowledging = false, waiting = 0, superseded = [] }) {
  const count = Number.isFinite(waiting) && waiting > 0 ? Math.floor(waiting) : 0;
  if (!acknowledging && count === 0) return null;
  const again = count > 0 ? superseded : [];
  return (
    <div className="school-scan-status" role="status" aria-live="polite" data-testid="scan-status-chip">
      <div className="school-scan-status__pill">
        {acknowledging && <span className="school-scan-status__line school-scan-status__line--ack">Got it — looking it up</span>}
        {count > 0 && <span className="school-scan-status__line">{waitingCopy(count)}</span>}
      </div>
      {again.length > 0 && (
        <ul className="school-scan-status__again">
          {again.map((book) => (
            <li key={book.id} className="school-scan-status__again-item">
              <span className="school-scan-status__again-title" title={book.label}>{book.label}</span>
              <span className="school-scan-status__again-hint">scan it again to open it</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

ScanStatusChip.propTypes = {
  acknowledging: PropTypes.bool,
  waiting: PropTypes.number,
  superseded: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string.isRequired, label: PropTypes.string })),
};
