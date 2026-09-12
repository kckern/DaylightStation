import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { languageApi } from './languageApi.js';
import { languageLog } from './languageLog.js';
import { useCapabilities } from './useCapabilities.js';
import RepetitionRung from './rungs/RepetitionRung.jsx';
import TypedRung from './rungs/TypedRung.jsx';
import RecordingRung from './rungs/RecordingRung.jsx';
import ReviewPanel from './ReviewPanel.jsx';
import PacingControl from './PacingControl.jsx';
import DeviceSettings from './DeviceSettings.jsx';
import { languageName } from './languageNames.js';
import ReadingPips from '../../reading/ReadingPips.jsx';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import Icon from '../../home/icons/Icon.jsx';
import './SentenceLadder.scss';

const RUNG_LABELS = {
  repetition: 'Repetition',
  dictation: 'Dictation',
  recording: 'Recording',
  interpretation: 'Interpretation',
};
/** The order a sentence climbs; the ladder is drawn in it whatever the chain omits. */
const RUNG_ORDER = ['repetition', 'dictation', 'recording', 'interpretation'];

/**
 * How many pips a rung may draw before it gives up and prints the count.
 *
 * `ReadingPips` defaults to 8 and that default is RIGHT where it was written:
 * the reading shelf asks "how many books do I still owe", a child answers it by
 * counting, and counting stops working somewhere around nine. This rail is not
 * asking that. Fifteen pips here are a progress TEXTURE — how far along the
 * rung is, read as the shape of a row rather than as a number — so the limit
 * that protects counting does not apply, and 15 is the default day's pace.
 *
 * The ceiling is the RAIL, not the eye: fifteen 0.5rem discs at a 0.22rem gap
 * measure 169px inside a column that is 179px wide at its narrowest. See
 * `.lang-ladder__pips`, where the arithmetic lives. Past this — a 25- or
 * 50-a-day pace — the row would overflow, so it degrades to the count in text.
 *
 * This was a live defect, not a tuning choice: at the default of 8 EVERY rung
 * of a 15-sentence day fell back to text, and with `--pip-label-size` unset
 * that text rendered at 4.4vh in the accent green over three wrapped lines.
 * The rail had never once drawn a pip.
 */
const LADDER_MAX_PIPS = 15;

/**
 * Whose session this is, as a name rather than an id.
 *
 * The rail had no owner on it at all. On a shared living-room panel that is a
 * real question — a child walks up to a half-climbed ladder and cannot tell
 * whether the fifteen sentences on it are theirs or their sibling's, and the
 * only way to find out was to start answering.
 *
 * Derived from the learner id, because that is the only identity this program
 * is given: the School shell mounts it with `userId` and nothing else. Ids in
 * this household are `first` or `first-last`, so title-casing the segments is
 * the whole transformation. `ProfileAvatar` beside it carries the real
 * portrait, which is what a pre-reader actually recognises; the words are for
 * the adult and the screen reader.
 */
function learnerLabel(userId) {
  if (!userId) return null;
  return userId.split(/[-_.\s]+/).filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * What a rung this device cannot climb is actually short of — the text under a
 * dimmed rung. It used to be one hardcoded line, "Needs a microphone", printed
 * whatever the rung wanted: the yellow-room tablet has a mic and an
 * English-only keyboard, so the rung it blocks is DICTATION, and the card sent
 * the child hunting for a microphone already in their hands. The server now
 * says which capability is missing (`missingCreditNeeds`), because the ladder
 * domain is the one place that mapping lives.
 */
function needNote(need) {
  const names = alternativeNames(need);
  // A rung the server could not explain still says something true: it is out of
  // reach here. Silence would leave a dimmed rung with no reason at all, and a
  // requirement can arrive with nothing printable in it (see below).
  if (names.length === 0) return 'Not available on this device';
  // "or", never "and". A requirement is met by ANY ONE of its alternatives —
  // interpretation can be typed in English OR spoken — and a card listing both
  // as though a child had to find both would send them off for a keyboard they
  // do not need.
  return `Needs ${names.join(' or ')} — on another device`;
}

/**
 * Each alternative in words, skipping any that cannot be named.
 *
 * A textInput requirement can arrive naming no language: `resolveRole` yields
 * null when the corpus's languages map has no entry for the rung's role, and
 * the wrapper object around that null is still truthy, so it survives every
 * check upstream and reaches here intact. Dropped rather than printed — a child
 * must never be shown a card reading "Needs a null keyboard". Dropping it
 * rather than failing the whole note also matters now that a requirement has
 * more than one alternative: the printable half still tells them what to do.
 *
 * No matching server-side warning, deliberately: a corpus that cannot name
 * both its languages is refused outright by `validateCorpus`, so this shape
 * cannot come from a validated corpus. What it CAN come from is the payload —
 * an older server, a truncated response — which is exactly why the guard
 * belongs on this side and not there. The same reasoning accepts a bare
 * `{kind}` with no `anyOf`: that is what a server predating alternatives sends.
 */
function alternativeNames(need) {
  return alternativesOf(need)
    .map((alt) => {
      if (alt?.kind === 'microphone') return 'a microphone';
      if (alt?.kind === 'textInput' && alt.language) return `${anArticle(languageName(alt.language))} keyboard`;
      return null;
    })
    .filter(Boolean);
}

/** Requirements old and new, as one list. */
function alternativesOf(need) {
  if (Array.isArray(need?.anyOf)) return need.anyOf;
  return need?.kind ? [need] : [];
}

/** "an English keyboard", "a Korean keyboard" — the note reads as a sentence. */
function anArticle(word) {
  return `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
}

/**
 * The same requirement as one short token, for the log store rather than for a
 * child: `microphone`, `textInput:KR`, or `unspecified`. The note above is a
 * sentence and would be a poor thing to group or count by; this is what a
 * `stats by` reads when someone asks which capability is blocking the most
 * children on the most devices.
 *
 * Alternatives are SORTED and joined with `|`. The ladder has few of them and
 * a stable order makes `microphone|textInput:EN` one countable thing; built in
 * payload order it would be two strings for one situation and group as two.
 */
function needTag(need) {
  const parts = alternativesOf(need).map((alt) => {
    if (alt?.kind === 'microphone') return 'microphone';
    if (alt?.kind === 'textInput') return `textInput:${alt.language ?? 'unnamed'}`;
    return null;
  }).filter(Boolean);
  if (parts.length === 0) return 'unspecified';
  return [...parts].sort().join('|');
}

/**
 * The sentence-ladder program shell (design §5).
 *
 * Owns the day: fetches it, walks the learner rung by rung through the chain
 * the server says this device supports, and re-fetches after each save so the
 * queue stays derived rather than mirrored in component state. That re-fetch
 * is the whole point — the 2016 app kept a client-side copy of the queue and
 * that is precisely what desynchronised.
 *
 * Requires an identified learner. A guest produces no records, so the program
 * shows a sign-in prompt rather than a drill that silently discards work.
 */
export default function SentenceLadderProgram({
  userId, corpusId, studyGrant, onSignIn, onExit = null, locked = false, preview = false,
}) {
  // ONE ID FOR THE WHOLE RUN, minted during RENDER rather than in an effect.
  //
  // Every `languageLog` event and every outbound request carries it, so a
  // child's session reads back from the log store as one thing —
  // `context.runId:"<id>"` — frontend and backend interleaved, instead of a
  // pile of events matched up by learner and timestamp.
  //
  // It cannot live in an effect. The day-load effect is DECLARED above the
  // mount effect and effects run in declaration order, so a `startRun()` there
  // would fire after the first request had already gone out uncorrelated —
  // losing exactly the event most worth having when a session fails at the
  // start. `useMemo` runs during render, before any effect, which is the only
  // place early enough. Re-mints per learner/corpus: a different child or a
  // different course is a different run.
  useMemo(() => languageLog.startRun(), [userId, corpusId]);

  const [day, setDay] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error | empty
  const [activeRung, setActiveRung] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [tab, setTab] = useState('study'); // study | review
  // The sentence a child has finished but has not yet left, as {rung, seq}.
  // Repetition is the one rung with nothing to submit, so "done" used to mean
  // "gone": the save re-derived the queue, the next sentence took its place,
  // and a timer played it 350ms later. The sentence they had just heard could
  // not be heard again. Holding it here is what turns a conveyor belt into a
  // choice — the hold has to live in the parent because it is the PARENT's
  // queue that swaps the sentence out.
  const [held, setHeld] = useState(null);
  // The sentence a child has ASKED for by pressing Next, as {rung, seq}. It
  // starts playing on arrival: Next has to mean what it says, and a child who
  // then had to find Play would be pressing two buttons for one intention. The
  // tap on Next is the gesture behind it — which is the whole difference from
  // the auto-advance this replaced, where sentence followed sentence with no
  // gesture at all and so could be neither chosen nor gone back to.
  const [playOnArrival, setPlayOnArrival] = useState(null);
  const loadGeneration = useRef(0);
  const loadController = useRef(null);
  const progressEmission = useRef(null);

  const languages = day?.corpus?.languages;
  const {
    capabilities, ready: capsReady, toggleLanguage, toggleMicrophone, hasHardwareKeyboard,
  } = useCapabilities(corpusId, languages);

  const load = useCallback(async () => {
    if (!corpusId || (!preview && (!userId || !studyGrant))) return;
    const generation = ++loadGeneration.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    // The START of a load, not only its outcome. A day that never arrives
    // leaves a child looking at "Loading…" and leaves the store with nothing
    // at all — no line to say the request was even attempted, which reads
    // identically to a program that never opened. It carries the capabilities
    // the request was made WITH, because those decide which rungs come back:
    // a session that arrives short of a rung is answered here, not guessed at.
    const startedAt = Date.now();
    languageLog.programStep('day-loading', {
      corpus: corpusId,
      preview,
      microphone: capabilities.microphone,
      textInput: capabilities.textInput,
    });
    const { ok, status: httpStatus, data } = preview
      ? await languageApi.previewDay(corpusId, capabilities, controller.signal)
      : await languageApi.day(userId, corpusId, capabilities, studyGrant, controller.signal);
    if (generation !== loadGeneration.current) return;
    if (!ok) {
      languageLog.programError('day-failed', {
        corpus: corpusId, status: httpStatus, ms: Date.now() - startedAt,
      });
      setStatus('error');
      return;
    }
    setDay(data);
    setStatus(data.queue.length === 0 ? 'empty' : 'ready');
    languageLog.program('day-loaded', {
      corpus: corpusId,
      day: data.day,
      total: data.summary.total,
      done: data.summary.done,
      // What the ladder will actually offer, beside how long it took to say so.
      chain: data.chain ?? [],
      blocked: data.missingCreditRungs ?? [],
      ms: Date.now() - startedAt,
    });
  }, [userId, corpusId, capabilities, studyGrant, preview]);

  useEffect(() => {
    languageLog.program('mounted', { corpus: corpusId, userId });
    return () => {
      loadGeneration.current += 1;
      loadController.current?.abort();
      languageLog.program('unmounted', { corpus: corpusId });
      // Close the run LAST, so 'unmounted' is still correlated. Anything this
      // module logs afterwards is genuinely outside a session and should say so
      // by carrying no run id, rather than being filed under the last one.
      languageLog.endRun();
    };
  }, [corpusId, userId]);

  useEffect(() => {
    if (!capsReady && day === null) {
      // First load runs without capabilities so we can learn the corpus's
      // languages; the hook needs them to pick a sensible text-input default.
      load();
      return;
    }
    if (capsReady) load();
  }, [capsReady, load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!day) return;
    const current = day.summary || { total: 0, done: 0 };
    const settled = current.done === current.total;
    const empty = current.total === 0;
    const blocked = settled && (day.missingCreditRungs?.length ?? 0) > 0;
    const key = `${day.day}:${current.done}:${current.total}:${empty}:${blocked}`;
    if (progressEmission.current === key) return;
    progressEmission.current = key;
    languageLog.program('progress', {
      corpus: corpusId,
      day: day.day,
      done: current.done,
      total: current.total,
      complete: settled && !blocked,
      empty,
      blockedByDevice: blocked,
    });
  }, [corpusId, day]);

  // Group the queue by rung, in the order the server's chain reports. Rungs
  // absent from the chain never appear, so a blocked rung cannot be selected.
  const groups = useMemo(() => {
    if (!day) return [];
    return (day.chain || [])
      .map((rung) => ({
        rung,
        label: RUNG_LABELS[rung] || rung,
        items: day.queue.filter((e) => e.rung === rung),
      }))
      .filter((g) => g.items.length > 0);
  }, [day]);

  // Land on the first rung with work outstanding rather than always the first
  // rung — resuming mid-day should not replay finished work.
  useEffect(() => {
    // A held sentence pins the ladder too. Without this, finishing the LAST
    // sentence of a rung moved the ladder to the next rung before the child
    // could choose, which is the same auto-advance wearing a different hat.
    if (held) return;
    if (!groups.length) { setActiveRung(null); return; }
    const stillValid = groups.some((g) => g.rung === activeRung && g.items.some((i) => !i.done));
    if (stillValid) return;
    const nextGroup = groups.find((g) => g.items.some((i) => !i.done)) || groups[0];
    // WHY the learner is standing on this rung, not merely which one. A first
    // landing above the foot of the ladder means today already had work done in
    // it — "they came back" rather than "the ladder started them here" — and a
    // change once a rung was already held means the one they were on ran out.
    // Told apart, a report of "it started me in the wrong place" is answerable.
    languageLog.rungLanded({
      rung: nextGroup.rung,
      reason: activeRung ? 'rung-cleared' : (nextGroup.rung === groups[0].rung ? 'first' : 'resume'),
      pending: nextGroup.items.filter((i) => !i.done).length,
      of: nextGroup.items.length,
    });
    setActiveRung(nextGroup.rung);
  }, [groups, held]); // eslint-disable-line react-hooks/exhaustive-deps

  // Let go when the child leaves the rung, or when the day rolls: a stale hold
  // must never pin a sentence that is no longer the queue's to give.
  useEffect(() => { setHeld(null); }, [activeRung, day?.day]);

  // A request to play carries a gesture, and a gesture does not survive leaving
  // the surface. Cleared on the way out — including to the Review shelf — so
  // coming back never plays a sentence nobody just asked for.
  useEffect(() => { setPlayOnArrival(null); }, [activeRung, day?.day, tab]);

  const group = groups.find((g) => g.rung === activeRung) || null;
  const pending = group ? group.items.filter((i) => !i.done) : [];
  // The held sentence outranks the queue. Matched on rung as well as seq: a seq
  // is a SENTENCE, and the same sentence appears at every rung it climbs, so a
  // hold checked by number alone would pin the wrong rung's copy of it.
  const heldEntry = held && held.rung === activeRung
    ? group?.items.find((i) => i.seq === held.seq) ?? null
    : null;
  const entry = heldEntry ?? pending[0] ?? null;
  // Whatever comes after what is on screen — so the preload stays a sentence
  // ahead while a finished one is being held.
  const nextEntry = (heldEntry ? pending[0] : pending[1]) || null;

  // A dimmed rung, recorded once per day it is dimmed on. This is the line that
  // answers "why did it not let me record" without anyone having to stand at
  // the device: it names the rung AND the capability the server said was
  // missing, which is the thing a grown-up then goes and changes. Deduplicated
  // on the day and the rung set, because it is a rendered state, not an event —
  // every re-render would otherwise repeat it.
  const blockedEmission = useRef(null);
  useEffect(() => {
    const rungs = day?.missingCreditRungs ?? [];
    if (!day || rungs.length === 0) return;
    const key = `${day.day}:${rungs.join(',')}`;
    if (blockedEmission.current === key) return;
    blockedEmission.current = key;
    languageLog.capability('rung-blocked', {
      corpus: corpusId,
      day: day.day,
      rungs,
      needs: Object.fromEntries(rungs.map((rung) => [rung, needTag(day.missingCreditNeeds?.[rung])])),
    });
  }, [corpusId, day]);

  // The extra-practice banner. A day topped up with second passes over its own
  // new sentences shows the same sentence three times in a sitting, which is
  // the single most reported "it repeated itself" — and until now the surface
  // said so to the child and to nobody else.
  useEffect(() => {
    if (!entry?.practice) return;
    languageLog.rung('practice', { rung: entry.rung, seq: entry.seq });
  }, [entry?.rung, entry?.seq, entry?.practice]); // eslint-disable-line react-hooks/exhaustive-deps

  const audioUrl = useCallback(
    (seq, lang) => languageApi.audioUrl(corpusId, seq, lang),
    [corpusId],
  );

  // Every tab change goes through here so the move is recorded once, with what
  // it moved away from. A child who spends a session on the Review shelf and
  // reports "it never gave me any sentences" is describing this, and nothing
  // said so. A tap on the tab already shown is not a move and logs nothing.
  const selectTab = useCallback((next) => {
    if (tab === next) return;
    languageLog.programStep('tab', { corpus: corpusId, from: tab, to: next });
    setTab(next);
  }, [tab, corpusId]);

  /**
   * Save one attempt, then re-derive the day from the server. A failure is
   * surfaced, never swallowed: an unrecorded attempt that looks recorded is
   * how a learner loses a session's work without knowing.
   */
  const onComplete = useCallback(async ({ seq, rung, given, revealed, blob, method }) => {
    if (preview) {
      // The preview has no identity, grant, or mutable endpoint.  Completion
      // is a browser-only affordance so a teacher can experience the ladder
      // without manufacturing learner evidence or retaining a recording.
      setDay((current) => {
        if (!current) return current;
        const queue = current.queue.map((item) => (
          item.seq === seq && item.rung === rung ? { ...item, done: true } : item
        ));
        const done = queue.filter((item) => item.done).length;
        return { ...current, queue, summary: { total: queue.length, done } };
      });
      return { ok: true, preview: true };
    }
    setSaving(true);
    setNotice(null);
    const result = blob
      ? await languageApi.recording(userId, corpusId, seq, blob, capabilities, studyGrant)
      : await languageApi.log(userId, {
        corpus: corpusId,
        seq,
        rung,
        // A REVEAL CARRIES NO ANSWER. `revealed` replaces `given` rather than
        // joining it: the learner produced nothing, and the text they were
        // just shown must never travel as something they wrote. Spread, so an
        // ordinary attempt's body is exactly what it has always been.
        //
        // `method` rides with `given` for the same reason and no other: it
        // describes how an answer was produced, and a reveal is not an answer.
        ...(revealed ? { revealed: true } : { given, ...(method ? { method } : {}) }),
      }, capabilities, studyGrant);
    setSaving(false);

    if (!result.ok) {
      languageLog.attemptError('record-failed', { corpus: corpusId, seq, rung, status: result.status });
      setNotice(
        result.status === 403
          ? 'Sign in to have your work saved.'
          : 'That answer was not saved — check the connection and try again.',
      );
      return result;
    }
    languageLog.attempt('saved', { corpus: corpusId, seq, rung, ...(revealed ? { revealed: true } : {}) });
    await load();
    return result;
  }, [userId, corpusId, capabilities, studyGrant, load, preview]);

  /**
   * A SPOKEN ANSWER to a typing rung. Audio up, a transcript back, and nothing
   * written down: the transcript lands in the learner's own field, where they
   * read and edit it before submitting through `onComplete` like any other
   * answer. See `TypedRung`'s SPEAK_WORD for why it stops there.
   *
   * The rung is handed a plain function rather than the api client and the
   * identity to go with it, for the same reason it is handed `onComplete`: a
   * rung that knew how to address the server would be a second place for the
   * grant, the corpus and the run id to be assembled, and they are assembled
   * exactly once, here.
   */
  const onTranscribe = useCallback(async (blob) => {
    const lang = entry?.response?.language;
    const { ok, status, data } = await languageApi.transcribe(
      userId, corpusId, entry.seq, lang, blob, capabilities, studyGrant,
    );
    if (!ok) return { ok: false, status };
    return { ok: true, transcript: data?.transcript ?? '', empty: data?.empty === true };
  }, [userId, corpusId, capabilities, studyGrant, entry]);

  const onRoll = useCallback(async () => {
    const { ok, data } = await languageApi.roll(userId, corpusId, capabilities, studyGrant);
    if (ok && data?.rolled) {
      languageLog.pacing('rolled', { corpus: corpusId, day: data.day });
      await load();
    } else {
      // The button did something; it declined. Recorded at warn because from
      // the child's side this is indistinguishable from a dead button, and a
      // dead button is exactly what gets reported.
      languageLog.pacingWarn('roll-refused', {
        corpus: corpusId, reason: data?.reason ?? (ok ? 'not-rolled' : 'request-failed'),
      });
      setNotice(
        data?.reason === 'before-boundary'
          ? 'Come back tomorrow for the next set.'
          : 'Finish today\'s set first.',
      );
    }
  }, [userId, corpusId, capabilities, studyGrant, load]);

  // The one pacing knob. `PacingControl` itself stays presentational and logs
  // nothing: a change is only real once the server has taken it, and only this
  // side of the call knows whether it did. From AND to — "the limit is 5" does
  // not tell you it used to be 25, and a limit quietly raised is the usual
  // explanation for a morning that suddenly became too long.
  const onPacing = useCallback(async (dailyLimit) => {
    const from = day?.dailyLimit ?? null;
    const { ok, status } = await languageApi.pacing(userId, corpusId, dailyLimit, studyGrant);
    if (ok) {
      languageLog.pacing('changed', { corpus: corpusId, dailyLimit, from });
      await load();
      return;
    }
    languageLog.pacingWarn('change-failed', { corpus: corpusId, dailyLimit, from, status });
  }, [userId, corpusId, studyGrant, load, day?.dailyLimit]);

  // The shell's own keys, so the ladder can be climbed without touching the
  // glass: the up and down arrows walk the rungs (and the Review shelf below
  // them), and on the day-complete panel Space or Enter presses whichever
  // button is offered. The rungs handle their own keys; this never fires
  // over a focused control, and never while a rung has a sentence in hand.
  const climbable = useMemo(
    () => RUNG_ORDER.filter((rung) => groups.some((g) => g.rung === rung) && !(day?.missingCreditRungs ?? []).includes(rung)),
    [groups, day?.missingCreditRungs],
  );
  const stops = useMemo(() => (preview ? climbable : [...climbable, 'review']), [climbable, preview]);
  // Mirrors the complete panel's own logic below; the panel is rendered after
  // the early returns, and hooks cannot follow those.
  const keySummary = day?.summary || { total: 0, done: 0 };
  const keySettled = keySummary.done === keySummary.total;
  const keyMissing = day?.missingCreditRungs ?? [];
  const keyBlocked = keySettled && keyMissing.length > 0;
  const keyExit = onExit ?? onSignIn;
  const finishAction = keySummary.total > 0 && keySettled && !preview && !keyBlocked && !locked ? onRoll
    : keySettled && !keyBlocked && locked && keyExit ? keyExit
      : null;
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target?.closest?.('button, input, select, textarea, a[href], [contenteditable="true"]')) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (stops.length < 2) return;
        const at = tab === 'review' ? stops.indexOf('review') : stops.indexOf(activeRung);
        const to = stops[(Math.max(at, 0) + (e.key === 'ArrowDown' ? 1 : stops.length - 1)) % stops.length];
        e.preventDefault();
        if (to === 'review') { selectTab('review'); return; }
        selectTab('study');
        if (to !== activeRung) {
          languageLog.rung('selected', { rung: to, from: activeRung, via: 'key' });
          setActiveRung(to);
        }
        return;
      }
      if ((e.key === ' ' || e.key === 'Enter') && tab === 'study' && finishAction) {
        e.preventDefault();
        finishAction();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stops, tab, activeRung, selectTab, finishAction]);


  // A guest is stopped, but never stranded: the picker lives one level up and
  // was previously reachable only by knowing the header chip was tappable.
  if (!preview && (!userId || !corpusId || !studyGrant)) {
    const needsLaunch = Boolean(userId) && (!corpusId || !studyGrant);
    return (
      <div className="lang-program lang-program--guest">
        <p className="lang-program__guest-copy">
          {needsLaunch
            ? 'Type your code or scan your agenda to start Sentence Ladder.'
            : 'Sign in to study — a guest\'s work isn\'t saved.'}
        </p>
        {onSignIn && (
          <button type="button" className="lang-btn lang-btn--primary" onClick={onSignIn}>
            {locked ? 'Type your code again' : 'Sign in'}
          </button>
        )}
      </div>
    );
  }
  if (status === 'loading') return <div className="lang-program lang-program--loading">Loading…</div>;
  if (status === 'error') {
    return (
      <div className="lang-program lang-program--error">
        <p>Could not load today&apos;s set.</p>
        <button type="button" className="lang-btn" onClick={load}>Try again</button>
      </div>
    );
  }

  const summary = day?.summary || { total: 0, done: 0 };
  const percent = summary.total ? Math.round((100 * summary.done) / summary.total) : 0;
  const noSteps = status === 'empty' || summary.total === 0;
  const settled = summary.done === summary.total;
  const allDone = summary.total > 0 && settled;
  const missingCreditRungs = day?.missingCreditRungs ?? [];
  const missingCreditNeeds = day?.missingCreditNeeds ?? {};
  const blockedByDevice = settled && missingCreditRungs.length > 0;
  const sessionFinished = settled && !blockedByDevice;
  const exitHandler = onExit ?? onSignIn;
  const learnerName = learnerLabel(userId);

  return (
    <div className="lang-program">
      {/* No back control and no course title here: the School shell already
          renders both above this component, and the first pass stacked a
          second chevron with the same destination directly beneath the
          first. */}
      <header className="lang-program__header">
        <div className="lang-program__identity">
          <h2 className="lang-program__day">{preview ? `${day?.corpus?.label ?? 'Sentence Ladder'}, day ${day?.day}` : `Day ${day?.day}`}</h2>
          {/* ONE statement of the day's progress, beside its name. It used to
              be three — this line, a "15 left" on the right, and a bar between
              them — and the ladder below now carries it per rung besides. */}
          <p
            className="lang-program__steps"
            role="progressbar"
            aria-label={`${summary.done} of ${summary.total} session steps complete`}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {preview ? 'Guest preview, nothing is saved · ' : ''}{summary.done} of {summary.total} steps
          </p>
        </div>
        <div className="lang-program__actions">
          {!preview && !locked && <PacingControl value={day?.dailyLimit} onChange={onPacing} />}
          {!locked && <DeviceSettings
            languages={languages}
            capabilities={capabilities}
            onToggleLanguage={toggleLanguage}
            onToggleMic={toggleMicrophone}
          />}
          {locked && onExit && !sessionFinished && (
            <button
              type="button"
              className="lang-btn lang-btn--quiet"
              data-testid="selfservice-section-exit"
              onClick={onExit}
            >
              {/* The set's own back mark, the same one the launch card uses, so
                  "out of here" is one picture across the School and not a word
                  in one place and a chevron in another. Decorative: the words
                  beside it are still the accessible name. */}
              <Icon name="back" className="lang-btn__glyph" />
              <span>Leave for now</span>
            </button>
          )}
        </div>
      </header>

      {notice && <p className="lang-program__notice" role="alert">{notice}</p>}

      <div className="lang-program__split">
        {/* THE LADDER. The rungs are a SEQUENCE a sentence climbs — hear it,
            write it, say it, translate it — and the first pass drew them as a
            row of peer tabs, which said "pick one". Drawn as a ladder they
            read top to bottom as the order they happen in, each rung wearing
            its own pips (one per sentence, filled as done — the same notation
            the reading shelf and the living-room rail use), the rung in hand
            lit. It is navigation and progress in one object; a rung this
            device cannot climb says so in a quiet line rather than a banner.
            The Review shelf sits below the ladder: it is not a rung. */}
        <nav className="lang-ladder" aria-label="Session modes">
          {/* WHOSE LADDER THIS IS, at the top of the rail. A guest preview has
              no learner, so it gets no portrait rather than a placeholder one. */}
          {!preview && learnerName && (
            <div className="lang-ladder__who">
              <ProfileAvatar id={userId} name={learnerName} size={96} />
              <span className="lang-ladder__who-name">{learnerName}</span>
            </div>
          )}
          <ol className="lang-ladder__rungs">
            {/* Every rung the day has, in climbing order — including one this
                device cannot climb. The server's chain omits an unsupported
                rung, so it never has a group; drawing it anyway, dimmed, is
                what tells a child on the Portal that the ladder has a rung
                their device skips, rather than a banner shouting it. */}
            {RUNG_ORDER.filter((rung) => groups.some((g) => g.rung === rung) || missingCreditRungs.includes(rung)).map((rung) => {
              const g = groups.find((x) => x.rung === rung) ?? null;
              const label = RUNG_LABELS[rung] || rung;
              const blocked = missingCreditRungs.includes(rung);
              if (!g || blocked) {
                return (
                  <li key={rung} className="lang-ladder__rung">
                    <div className="lang-ladder__step is-blocked" role="button" aria-disabled="true" aria-label={label}>
                      {/* A rung this device cannot climb keeps its mark. It is
                          still one of the four, and dimming it is the only
                          thing that should differ — stripping the icon would
                          make the unreachable rung the one a child cannot
                          recognise at all. */}
                      <span className="lang-ladder__name">
                        <Icon name={`rung-${rung}`} className="lang-ladder__glyph" />
                        <span className="lang-ladder__label">{label}</span>
                      </span>
                      <span className="lang-ladder__note">{needNote(missingCreditNeeds[rung])}</span>
                    </div>
                  </li>
                );
              }
              const done = g.items.filter((i) => i.done).length;
              const active = g.rung === activeRung && tab === 'study';
              return (
                <li key={rung} className="lang-ladder__rung">
                  <button
                    type="button"
                    className={`lang-ladder__step${active ? ' is-active' : ''}${done === g.items.length ? ' is-done' : ''}`}
                    aria-pressed={active}
                    onClick={() => {
                      selectTab('study');
                      if (g.rung !== activeRung) {
                        languageLog.rung('selected', { rung: g.rung, from: activeRung });
                      }
                      setActiveRung(g.rung);
                    }}
                  >
                    {/* Each rung wears its own mark: the four names are four
                        long words in the same weight, and on a panel read at
                        arm's length a child finds "the microphone one" far
                        faster than they read "Recording". */}
                    <span className="lang-ladder__name">
                      <Icon name={`rung-${rung}`} className="lang-ladder__glyph" />
                      <span className="lang-ladder__label">{label}</span>
                    </span>
                    {/* The lit rung's next pip is the sentence in hand — held
                        still: a wall panel does not pulse. */}
                    <ReadingPips
                      count={done}
                      target={g.items.length}
                      label={`${done} of ${g.items.length} ${label.toLowerCase()} sentences`}
                      className="lang-ladder__pips"
                      testId={`ladder-pips-${rung}`}
                      live={active && !allDone}
                      moving={false}
                      maxPips={LADDER_MAX_PIPS}
                    />
                  </button>
                </li>
              );
            })}
          </ol>
          {!preview && (
            <button
              type="button"
              className={`lang-ladder__review${tab === 'review' ? ' is-active' : ''}`}
              aria-pressed={tab === 'review'}
              onClick={() => selectTab('review')}
            >
              Review
            </button>
          )}
        </nav>

      <main className="lang-program__body">
        {tab === 'review' && !preview && <ReviewPanel userId={userId} corpusId={corpusId} studyGrant={studyGrant} />}

        {tab === 'study' && (allDone || noSteps) && (
          <div className="lang-program__complete">
            {blockedByDevice ? (
              <p role="status">
                Continue on a device that can complete {missingCreditRungs.map((rung) => RUNG_LABELS[rung] || rung).join(' and ')} before today can be credited.
              </p>
            ) : noSteps ? (
              <p role="status">Nothing is due in this course today.</p>
            ) : (
              <p role="status">
                {preview
                  ? `Preview complete. These ${summary.total} steps were only tried in this browser and were not saved.`
                  : `Day ${day?.day} complete. All ${summary.total} steps are saved and count toward today’s School progress.`}
              </p>
            )}
            {sessionFinished && locked && exitHandler && (
              <button type="button" className="lang-btn lang-btn--primary" onClick={exitHandler}>Done</button>
            )}
            {allDone && !preview && !blockedByDevice && !locked && (
              <button type="button" className="lang-btn lang-btn--primary" onClick={onRoll}>Start the next day</button>
            )}
          </div>
        )}

        {/* While the ladder is still filling up, a day is topped up with extra
            passes over its own new sentences. Say so: the same sentence
            arriving at three rungs in one sitting reads as a bug without it. */}
        {tab === 'study' && !allDone && entry?.practice && (
          <p className="lang-program__practice" role="status">Extra practice — this one doesn’t move up yet</p>
        )}
        {tab === 'study' && !allDone && entry && entry.rung === 'repetition' && (
          <RepetitionRung
            key={`${entry.rung}-${entry.seq}`}
            entry={entry} nextEntry={nextEntry} audioUrl={audioUrl}
            onComplete={onComplete} saving={saving}
            onHold={() => setHeld({ rung: entry.rung, seq: entry.seq })}
            onRelease={() => setHeld(null)}
            onAdvance={() => {
              setHeld(null);
              // `nextEntry` is the head of the queue while a sentence is held —
              // the one Next lands on. There may be none: the last sentence of
              // the day hands over to the complete panel, and nothing plays.
              if (nextEntry) setPlayOnArrival({ rung: nextEntry.rung, seq: nextEntry.seq });
            }}
            startOnArrival={playOnArrival?.rung === entry.rung && playOnArrival?.seq === entry.seq}
          />
        )}
        {tab === 'study' && !allDone && entry && (entry.rung === 'dictation' || entry.rung === 'interpretation') && (
          <TypedRung
            key={`${entry.rung}-${entry.seq}`}
            entry={entry} nextEntry={nextEntry} audioUrl={audioUrl}
            onComplete={onComplete} saving={saving}
            showShortcuts={hasHardwareKeyboard}
            /* THE THREE FACTS THAT DECIDE WHETHER A MICROPHONE IS DRAWN, and
               all three live here rather than in the rung. A preview has no
               identity or grant to spend; a device with no microphone cannot
               open one; and the ENTRY says whether this rung takes a spoken
               answer at all — the server folds `voiceAnswer` into that, so a
               deployment with no AI gateway marks every entry false and
               dictation is false even where it does have one. Any of them
               missing and the rung is handed nothing, so it draws no control at
               all — a dead button is worse than an absent one.

               Read off the entry rather than recombined here on purpose: which
               rungs may be spoken is the ladder's to say, and a second copy of
               that list on this side is exactly what drifts. */
            onTranscribe={!preview && entry.spokenAnswer && capabilities.microphone
              ? onTranscribe : null}
          />
        )}
        {tab === 'study' && !allDone && entry && entry.rung === 'recording' && (
          <RecordingRung
            key={`${entry.rung}-${entry.seq}`}
            entry={entry} audioUrl={audioUrl}
            cueUrl={day?.cues?.includes('record') ? languageApi.cueUrl('record') : null}
            onComplete={onComplete} saving={saving}
            onDisableMicrophone={toggleMicrophone}
          />
        )}
      </main>
      </div>
    </div>
  );
}
