import { useEffect, useMemo, useRef, useState } from 'react';
import { bindMediaToMaster } from "../../../../../../frontend/src/lib/volume/bindMediaToMaster.js";
import { languageApi } from "./languageApi.js";
import { languageLog } from "./languageLog.js";
import { diffChars } from "./textDiff.js";
import { typeableText } from "../../../portable/contracts/language/typeableText.mjs";

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
      {/* Against what could be typed, so a skipped ♂/♀ is not shown as missed. */}
      {diffChars(typeableText(expected), given).map((part, i) => (
        <span key={i} className={`lang-diff__${part.type}`}>{part.text}</span>
      ))}
    </span>
  );
}

function RecordingPlayback({ seq, loadRecording }) {
  const [src, setSrc] = useState(null);
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    loadRecording(seq).then(({ ok, data }) => {
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
  }, [seq, loadRecording]);
  // The review player obeys the panel's master volume like every other
  // sound on this surface; bound for as long as the element is on screen.
  const audioRef = useRef(null);
  useEffect(() => (src ? bindMediaToMaster(audioRef.current) : undefined), [src]);
  if (status === 'loading') return <span className="lang-review__status-inline">Loading recording…</span>;
  return src ? <audio ref={audioRef} controls preload="none" src={src} /> : <span className="lang-review__missing">audio unavailable</span>;
}

function Item({ item, languages, loadRecording }) {
  /**
   * THE HEADLINE IS THE PROMPT, and which language that is depends on the rung.
   *
   * Dictation hears Korean and writes Korean, so its prompt has no text at all
   * — the English line is the only thing on the row saying what the sentence
   * meant, and the diff beneath it compares Korean to Korean.
   *
   * Interpretation READS Korean and writes English, so the English line is the
   * answer. Printing it as the headline put the answer above a diff of the
   * answer against the answer — the same sentence three times in two languages'
   * worth of space, with the Korean the child was actually looking at nowhere
   * on the row. Worse, the revealed row beside it shows the Korean, so two
   * interpretation rows on one shelf did not read as the same exercise.
   */
  const promptText = item.rung === 'interpretation'
    ? item.text?.[languages?.target]
    : item.text?.[languages?.source];

  if (item.rung === 'recording') {
    return (
      <li className="lang-review__item">
        <span className="lang-review__rung">Recording</span>
        <span className="lang-review__sentence">{item.text?.[languages?.target]}</span>
        {item.hasAudio
          ? <RecordingPlayback seq={item.seq} loadRecording={loadRecording} />
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
        <span className="lang-review__sentence">{promptText}</span>
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

/**
 * Where the history and the recordings come from. The child's Review tab
 * reads through their launch grant; the teacher console passes its own
 * `source` (the same history behind the teacher gate), so both read one
 * rendering of the record rather than two that can disagree.
 */
function learnerSource(userId, corpusId, studyGrant) {
  return {
    history: () => languageApi.history(userId, corpusId, studyGrant),
    recording: (seq) => languageApi.recordingBlob(userId, corpusId, seq, studyGrant),
  };
}

/** When a ladder day was worked, from its items' own stamps — the calendar
 *  date a grown-up reads by, beside the ladder's own day number. */
function workedOn(items) {
  const stamps = items.map((item) => Date.parse(item?.at)).filter(Number.isFinite);
  if (!stamps.length) return null;
  return new Date(Math.min(...stamps)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function ReviewPanel({ userId, corpusId, studyGrant, source = null, showDates = false }) {
  const [history, setHistory] = useState(null);
  const [status, setStatus] = useState('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const read = useMemo(() => source ?? learnerSource(userId, corpusId, studyGrant), [source, userId, corpusId, studyGrant]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setStatus('loading');
      const { ok, data } = await read.history();
      if (!alive) return;
      if (!ok || !Array.isArray(data?.days)) {
        languageLog.programError('history-failed', { corpus: corpusId });
        setStatus('error');
        return;
      }
      setHistory(data);
      setStatus(data.days.length ? 'ready' : 'empty');
    })();
    return () => { alive = false; };
  }, [read, corpusId, reloadKey]);

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
          <h3 className="lang-review__day-title">
            Day {day}{showDates && workedOn(items) ? ` · ${workedOn(items)}` : ''}
          </h3>
          <ul className="lang-review__list">
            {items.map((item, i) => (
              <Item
                key={`${item.seq}-${item.rung}-${i}`}
                item={item}
                languages={languages}
                loadRecording={read.recording}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
