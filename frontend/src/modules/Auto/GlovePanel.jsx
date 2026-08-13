// frontend/src/modules/Auto/GlovePanel.jsx
//
// The glove box.
//
// This is the one screen whose job is retrieval under pressure — at a traffic
// stop, at a shop counter, at a parts desk. So it is deliberately the plainest
// panel in the app: big tap targets, no animation, no progressive disclosure,
// nothing that needs a second tap to reveal what you came for.
//
// v1 indexes files dropped into the vehicle's files/ directory. Capture-from-
// camera is the first follow-up (see open question 6).

import { Loading, Failed, Empty } from './AutoStates.jsx';
import { formatDay } from './format.js';

export default function GlovePanel({ documents, reminders, loading, error, onReload }) {
  if (loading) return <Loading label="Loading documents" />;
  if (error) return <Failed error={error} onRetry={onReload} />;

  const docs = documents?.documents || [];
  const expiryByDoc = new Map(
    (reminders || []).filter((r) => r.kind === 'document').map((r) => [r.sourceId, r]),
  );

  if (docs.length === 0) {
    return (
      <Empty
        title="Glove box is empty"
        detail="Drop files into the vehicle's files/ folder and list them in documents.yml — insurance, registration, title, the manual."
      />
    );
  }

  return (
    <div className="auto-panel">
      <ul className="auto-list auto-list--docs">
        {docs.map((doc) => {
          const reminder = expiryByDoc.get(doc.id);
          return (
            <li key={doc.id} className="auto-doc">
              <a
                className="auto-doc__link"
                href={doc.file ? `/api/v1/automotive/files/${doc.file}` : undefined}
                target="_blank"
                rel="noreferrer"
              >
                <span className="auto-doc__kind">{doc.kind}</span>
                <span className="auto-doc__label">{doc.label}</span>
                {doc.expires && (
                  <span className={`auto-doc__expiry${reminder && reminder.status !== 'ok' ? ` auto-doc__expiry--${reminder.status}` : ''}`}>
                    {reminder && reminder.daysUntilDue < 0 ? 'Expired ' : 'Expires '}
                    {formatDay(doc.expires)}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
