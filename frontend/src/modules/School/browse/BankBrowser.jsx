/**
 * Grid of banks. Each card offers Quiz and Cards. Guests get generic only.
 *
 * `subjectFilter` narrows by curriculum shelf: undefined = all banks (the
 * original behavior), a subject id = only that shelf, null = untagged only
 * (the Library's Practice group).
 */
import { useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';

export default function BankBrowser({ guestOnly, onLaunch, notice, subjectFilter }) {
  const [banks, setBanks] = useState(null);
  useEffect(() => {
    let alive = true;
    schoolApi.banks(guestOnly ? 'generic' : undefined).then(({ ok, data }) => {
      if (alive) setBanks(ok && Array.isArray(data) ? data : []);
    });
    return () => { alive = false; };
  }, [guestOnly]);

  // Guards against a double-tap firing onLaunch twice before the parent's
  // start() (which does the actual schoolApi.bank() GET) resolves. A ref
  // (not state) so it blocks the second call within the same synchronous
  // tap burst, before React would ever re-render -- same pattern as
  // MultipleChoiceItem's submittedRef / FlashcardRunner's gradingRef.
  // onLaunch returns its in-flight promise precisely so this can await it.
  const launchingRef = useRef(false);
  const launch = async (bank, mode) => {
    if (launchingRef.current) return;
    launchingRef.current = true;
    try {
      await onLaunch(bank, mode);
    } finally {
      launchingRef.current = false;
    }
  };

  if (banks === null) return <div className="school-browse school-browse--loading">Loading…</div>;
  const visible = subjectFilter === undefined
    ? banks
    : banks.filter((b) => (subjectFilter === null ? !b.subject : b.subject === subjectFilter));
  if (visible.length === 0) {
    return (
      <div className="school-browse school-browse--empty">
        <p>No quizzes yet.</p>
        <p className="school-browse__hint">Add a bank YAML under data/content/quizzes/ to get started.</p>
      </div>
    );
  }
  return (
    <div className="school-browse">
      {notice && <div className="school-browse__notice">{notice}</div>}
      <div className="school-browse__grid">
        {visible.map((b) => (
          <div key={b.id} className="school-browse__card">
            <h3 className="school-browse__title">{b.title}</h3>
            <p className="school-browse__meta">{b.itemCount} items{b.audience === 'generic' ? ' · anyone' : ''}</p>
            <div className="school-browse__actions">
              <button type="button" onClick={() => launch(b, 'quiz')}>Quiz</button>
              <button type="button" onClick={() => launch(b, 'flashcard')}>Cards</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
