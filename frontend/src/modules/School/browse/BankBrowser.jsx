/** Grid of banks. Each card offers Quiz and Cards. Guests get generic only. */
import { useEffect, useState } from 'react';
import { schoolApi } from '../schoolApi.js';

export default function BankBrowser({ guestOnly, onLaunch, notice }) {
  const [banks, setBanks] = useState(null);
  useEffect(() => {
    let alive = true;
    schoolApi.banks(guestOnly ? 'generic' : undefined).then(({ ok, data }) => {
      if (alive) setBanks(ok && Array.isArray(data) ? data : []);
    });
    return () => { alive = false; };
  }, [guestOnly]);

  if (banks === null) return <div className="school-browse school-browse--loading">Loading…</div>;
  if (banks.length === 0) {
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
        {banks.map((b) => (
          <div key={b.id} className="school-browse__card">
            <h3 className="school-browse__title">{b.title}</h3>
            <p className="school-browse__meta">{b.itemCount} items{b.audience === 'generic' ? ' · anyone' : ''}</p>
            <div className="school-browse__actions">
              <button type="button" onClick={() => onLaunch(b, 'quiz')}>Quiz</button>
              <button type="button" onClick={() => onLaunch(b, 'flashcard')}>Cards</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
