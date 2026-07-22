import { useEffect, useState } from 'react';
import { languageApi } from './languageApi.js';
import { languageLog } from './languageLog.js';
import { diffChars } from './textDiff.js';

/**
 * Study history, newest day first (design §5).
 *
 * This is where the recorded evidence earns its keep: a dictation shows what
 * the learner typed against what was expected, and a recording plays back in
 * their own voice. Neither ever gated anything — the value is seeing it.
 *
 * Days come from the server already folded from the append-only log. Nothing
 * here is a stored rollup.
 */

function DiffLine({ expected, given }) {
  return (
    <span className="lang-diff">
      {diffChars(expected, given).map((part, i) => (
        <span key={i} className={`lang-diff__${part.type}`}>{part.text}</span>
      ))}
    </span>
  );
}

function Item({ item, userId, corpusId, languages }) {
  const sourceText = item.text?.[languages?.source];

  if (item.rung === 'recording') {
    return (
      <li className="lang-review__item">
        <span className="lang-review__rung">Recording</span>
        <span className="lang-review__sentence">{item.text?.[languages?.target]}</span>
        {item.hasAudio
          ? <audio controls preload="none" src={languageApi.recordingUrl(userId, corpusId, item.seq)} />
          : <span className="lang-review__missing">audio unavailable</span>}
      </li>
    );
  }

  if (item.given != null) {
    return (
      <li className="lang-review__item">
        <span className="lang-review__rung">
          {item.rung === 'dictation' ? 'Dictation' : 'Interpretation'}
        </span>
        <span className="lang-review__sentence">{sourceText}</span>
        <DiffLine expected={item.expected} given={item.given} />
        {typeof item.accuracy === 'number' && (
          <span className="lang-review__score">{Math.round(item.accuracy * 100)}%</span>
        )}
      </li>
    );
  }

  return (
    <li className="lang-review__item">
      <span className="lang-review__rung">Repetition</span>
      <span className="lang-review__sentence">{item.text?.[languages?.target]}</span>
    </li>
  );
}

export default function ReviewPanel({ userId, corpusId }) {
  const [history, setHistory] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let alive = true;
    (async () => {
      const { ok, data } = await languageApi.history(userId, corpusId);
      if (!alive) return;
      if (!ok) {
        languageLog.programError('history-failed', { corpus: corpusId });
        setStatus('error');
        return;
      }
      setHistory(data);
      setStatus(data.days.length ? 'ready' : 'empty');
    })();
    return () => { alive = false; };
  }, [userId, corpusId]);

  if (status === 'loading') return <p className="lang-review__status">Loading history…</p>;
  if (status === 'error') return <p className="lang-review__status">Could not load history.</p>;
  if (status === 'empty') return <p className="lang-review__status">Nothing studied yet.</p>;

  const { languages } = history.corpus;

  return (
    <div className="lang-review">
      {history.days.map(({ day, items }) => (
        <section key={day} className="lang-review__day">
          <h3 className="lang-review__day-title">Day {day}</h3>
          <ul className="lang-review__list">
            {items.map((item, i) => (
              <Item
                key={`${item.seq}-${item.rung}-${i}`}
                item={item}
                userId={userId}
                corpusId={corpusId}
                languages={languages}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
