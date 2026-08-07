/**
 * Grid of banks. Each card offers Quiz and Cards. Guests get generic only.
 *
 * `subjectFilter` narrows by curriculum shelf: undefined = all banks (the
 * original behavior), a subject id = only that shelf, null = untagged only.
 *
 * `grouped` (design audit, remediation #1/#2): the browse-everything mode —
 * one section per subject, labeled with its count, first CAP cards visible
 * and the rest behind a per-subject "Show all N". This is what the wall's
 * Practice tile and the Library's Practice group render; the old
 * untagged-only Library filter told children a full room was empty.
 */
import { useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { subjectLabel } from '../home/subjects.js';
import EmptyState, { LoadingState } from '../home/EmptyState.jsx';

const GROUP_CAP = 8;

function BankCard({ bank, launch }) {
  return (
    <div className="school-browse__card">
      <h3 className="school-browse__title">{bank.title}</h3>
      <p className="school-browse__meta">
        {bank.itemCount} questions{bank.audience === 'generic' ? ' · for everyone' : ''}
      </p>
      <div className="school-browse__actions">
        <button type="button" onClick={() => launch(bank, 'quiz')}>Quiz</button>
        <button type="button" onClick={() => launch(bank, 'flashcard')}>Cards</button>
      </div>
    </div>
  );
}

function SubjectGroup({ subject, banks, launch }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? banks : banks.slice(0, GROUP_CAP);
  return (
    <section className="school-browse__group">
      <h3 className="school-browse__group-head">
        {subject === null ? 'More practice' : subjectLabel(subject)}
        <span className="school-browse__group-count">{banks.length}</span>
      </h3>
      <div className="school-browse__grid">
        {visible.map((b) => <BankCard key={b.id} bank={b} launch={launch} />)}
      </div>
      {banks.length > GROUP_CAP && (
        <button type="button" className="school-browse__more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${banks.length}`}
        </button>
      )}
    </section>
  );
}

export default function BankBrowser({ guestOnly, onLaunch, notice, subjectFilter, grouped = false }) {
  const [banks, setBanks] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    schoolApi.banks(guestOnly ? 'generic' : undefined).then(({ ok, data }) => {
      if (!alive) return;
      // A failed fetch must not masquerade as an empty library (advocacy:
      // "there is nothing for you" and "something broke" are different facts).
      if (!ok || !Array.isArray(data)) { setFailed(true); setBanks([]); return; }
      setBanks(data);
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

  if (banks === null) return <LoadingState label="Loading practice…" />;
  if (failed) {
    return (
      <EmptyState
        icon="kind-deck"
        title="The quiz shelf wouldn’t load."
        hint="Tell a grown-up, or try again in a bit."
      />
    );
  }

  if (grouped) {
    const bySubject = new Map();
    for (const b of banks) {
      const key = b.subject ?? null;
      if (!bySubject.has(key)) bySubject.set(key, []);
      bySubject.get(key).push(b);
    }
    const sections = [...bySubject.entries()]
      .sort(([a], [b]) => String(a ?? 'zz').localeCompare(String(b ?? 'zz')));
    if (!sections.length) {
      return (
        <EmptyState
          icon="kind-deck"
          title="No quizzes here yet."
          hint="They appear as courses gain question sets — a grown-up adds those."
        />
      );
    }
    return (
      <div className="school-browse school-browse--grouped">
        {notice && <div className="school-browse__notice">{notice}</div>}
        {sections.map(([subject, list]) => (
          <SubjectGroup key={subject ?? 'untagged'} subject={subject} banks={list} launch={launch} />
        ))}
      </div>
    );
  }

  const visible = subjectFilter === undefined
    ? banks
    : banks.filter((b) => (subjectFilter === null ? !b.subject : b.subject === subjectFilter));
  if (visible.length === 0) {
    return (
      <EmptyState
        icon="kind-deck"
        title="No quizzes here yet."
        hint="They appear as courses gain question sets — a grown-up adds those."
      />
    );
  }
  return (
    <div className="school-browse">
      {notice && <div className="school-browse__notice">{notice}</div>}
      <div className="school-browse__grid">
        {visible.map((b) => <BankCard key={b.id} bank={b} launch={launch} />)}
      </div>
    </div>
  );
}
