import { useEffect, useRef, useState } from 'react';
import { bindMediaToMaster } from '../../../../lib/volume/bindMediaToMaster.js';
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

function RecordingPlayback({ userId, corpusId, seq, studyGrant }) {
  const [src, setSrc] = useState(null);
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    languageApi.recordingBlob(userId, corpusId, seq, studyGrant).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok || !data) {
        setStatus('error');
        return;
      }
      objectUrl = URL.createObjectURL(data);
      setSrc(objectUrl);
      setStatus('ready');
    });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [userId, corpusId, seq, studyGrant]);
  // The review player obeys the panel's master volume like every other
  // sound on this surface; bound for as long as the element is on screen.
  const audioRef = useRef(null);
  useEffect(() => (src ? bindMediaToMaster(audioRef.current) : undefined), [src]);
  if (status === 'loading') return <span className="lang-review__status-inline">Loading recording…</span>;
  return src ? <audio ref={audioRef} controls preload="none" src={src} /> : <span className="lang-review__missing">audio unavailable</span>;
}

function Item({ item, userId, corpusId, languages, studyGrant }) {
  const sourceText = item.text?.[languages?.source];

  if (item.rung === 'recording') {
    return (
      <li className="lang-review__item">
        <span className="lang-review__rung">Recording</span>
        <span className="lang-review__sentence">{item.text?.[languages?.target]}</span>
        {item.hasAudio
          ? <RecordingPlayback userId={userId} corpusId={corpusId} seq={item.seq} studyGrant={studyGrant} />
          : <span className="lang-review__missing">audio unavailable</span>}
      </li>
    );
  }

  /**
   * A REVEAL, said as a reveal. It has to be tested BEFORE the `given` branch
   * and before the fallthrough: a revealed row carries no written answer, so
   * the last branch — which assumes "no answer" means "repetition" — would
   * file every sentence a child gave up on as a repetition they completed.
   * The one surface where a learner reads their own record back is the last
   * place a reveal is allowed to turn into something else.
   */
  if (item.revealed) {
    return (
      <li className="lang-review__item">
        <span className="lang-review__rung">
          {item.rung === 'dictation' ? 'Dictation' : 'Interpretation'}
        </span>
        <span className="lang-review__sentence">{item.text?.[languages?.target]}</span>
        {/* No diff and no score, because there was nothing to compare: what is
            worth keeping on the shelf is the answer itself, which is the one
            thing this sentence can still teach. */}
        <span className="lang-review__shown">Answer shown: {item.expected}</span>
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

export default function ReviewPanel({ userId, corpusId, studyGrant }) {
  const [history, setHistory] = useState(null);
  const [status, setStatus] = useState('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setStatus('loading');
      const { ok, data } = await languageApi.history(userId, corpusId, studyGrant);
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
  }, [userId, corpusId, studyGrant, reloadKey]);

  if (status === 'loading') return <p className="lang-review__status">Loading history…</p>;
  if (status === 'error') {
    return (
      <div className="lang-review__status">
        <p>Could not load history.</p>
        <button type="button" className="lang-btn" onClick={() => setReloadKey((key) => key + 1)}>
          Try again
        </button>
      </div>
    );
  }
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
                studyGrant={studyGrant}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
