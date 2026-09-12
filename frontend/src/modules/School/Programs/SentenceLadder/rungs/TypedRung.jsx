import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSentenceAudio, clipsFor } from '../useSentenceAudio.js';
import { languageLog } from '../languageLog.js';
import { useHangulTyping } from '../../../ime/HangulTypingProvider.jsx';
import { columnsFor } from './glyphStrip.js';
import GlyphStrip from './GlyphStrip.jsx';
import Icon from '../../../home/icons/Icon.jsx';
import useVoiceCapture from './useVoiceCapture.js';

/**
 * The two typing rungs, which are one component (design §5).
 *
 * `dictation` and `interpretation` differ only in which language the learner
 * types and whether the other language is shown as a hint — and BOTH of those
 * come from the server-resolved `entry.response.language`. Splitting them into
 * two components would mean two places to hardcode a language, which is
 * exactly what the role model exists to prevent.
 *
 *   dictation      — hear target, type target. Drawn as TWO COLUMN-ALIGNED
 *                    ROWS (`GlyphStrip`): the model above, the learner's answer
 *                    directly beneath, one grid column per syllable. In
 *                    enrollment-owned `copy` mode the model is shown one glyph
 *                    ahead; in listen mode it is not in the DOM at all.
 *   interpretation — hear target, type source. The target text is shown whole
 *                    and the field stays visible: the task is rendering
 *                    meaning, not tracing a script, so there is nothing to
 *                    align column by column and an English answer aligned
 *                    character by character would just leak its length.
 *
 * WHY THE FIELD IS OFFSCREEN ON THE DICTATION RUNG. The strip's lower row IS
 * the field's rendering — a second, differently-sized copy of the same text
 * directly under it was the old stack's worst moment, because the two type
 * scales had to be kept in sync by hand and never were. The input stays a real,
 * focused, selectable element (see `.is-offscreen`): the in-page IME reads
 * `selectionStart` on every keystroke, so `display:none` / `visibility:hidden`
 * would strand every half-composed syllable.
 *
 * Tab replays the clip. That was the 2016 shortcut and it matters: a learner
 * mid-word should not have to leave the field to hear the sentence again. The
 * shortcut is written ON the play control rather than in a hint line of its
 * own — one line of screen, and it says what the control does.
 *
 * The audio used to LOOP until submit, starting on the first keystroke. A
 * learner typing one Hangul syllable at a time was hammered by the same
 * sentence with nothing on screen that could stop it. The clip now plays once
 * on arrival, a Stop sits beside Play the whole time it sounds, and a silence
 * long enough to mean "stuck" earns exactly one replay.
 */

/**
 * How long the field may sit untouched before the sentence is offered again.
 * A prop with a named default rather than a bare number, because this is the
 * kind of value that ends up differing per learner — a later change threads it
 * from the enrollment YAML through this same seam. Zero disables the replay.
 */
export const DEFAULT_IDLE_REPLAY_MS = 30_000;

/**
 * How long a refused keystroke is drawn for.
 *
 * A SILENT REFUSAL READS AS A BROKEN KEYBOARD. Copy mode's gate consumes a key
 * that would stop the syllable in flight being a prefix of the one being
 * traced, and consuming it means nothing on screen moves — so without this the
 * child's answer to "my typing stopped working" is to press harder. Long enough
 * to see at arm's length on a 10" panel, short enough not to sit in the way of
 * the next key.
 */
export const REFUSAL_FLASH_MS = 180;

/**
 * PRESS TO PEEK, TYPE TO HIDE — and no third mode to go with it.
 *
 * Copy mode is a beginner's scaffold. An intermediate should be LISTENING and
 * typing what they heard, not reading and transcribing; pure blind dictation
 * with nothing to fall back on is too harsh. So the whole sentence can be
 * asked for, with the learner's own position marked, and the next keystroke
 * takes it away again: look, hold a chunk in your head, type it from memory.
 * You cannot read and type at the same time, which is the point.
 *
 * This COLLAPSES the tiers rather than adding one — beginner is `copy`,
 * intermediate and advanced are both `listen` and differ only in how often
 * they peek, which is recorded anyway. One fewer knob for nobody to remember
 * to change as a child improves.
 *
 * F1, and deliberately NOT Escape: `screens/portal.yml` binds `actions.escape`
 * to `reload` when the screen is idle, so a stuck child pressing it would
 * reload the kiosk out from under themselves. Tab already plays, Space is a
 * space (a Korean sentence has them), and the arrows are the caret and end a
 * composition session on purpose. F1 reads as "help" and was unclaimed — and
 * it is paired with a visible button, because the Portal is a touch panel and
 * a child cannot press a key that is not on it.
 *
 * NO CAP, deliberately. Self-hiding does not prevent glyph-by-glyph copying: a
 * child can peek, type one glyph, peek again. What discourages that is that
 * each peek shows the WHOLE sentence, so taking one glyph out of it is
 * obviously uneconomic — plus the peek count sitting in the evidence log. A
 * hard cap would fire mid-sentence and strand a stuck child, which is the
 * failure this whole design keeps stepping around.
 */
const PEEK_KEY = 'F1';

/**
 * A HINT IS PARTIAL. A REVEAL IS THE ANSWER. They are not the same affordance
 * wearing two labels, and the name is the whole of the distinction.
 *
 * On DICTATION the withheld thing is the Korean, and the peek above shows it:
 * the learner has still got to type it, in Hangul, from memory of what they
 * just read — which is the skill the rung is drilling. A peek is help.
 *
 * On INTERPRETATION the withheld thing is the ENGLISH, and the English IS the
 * answer. Showing it leaves nothing but transcription; playing the English
 * clip leaves exactly the same nothing. So there is no peek on this rung —
 * there is a REVEAL, it ends the exercise for that sentence, and it is
 * recorded as a reveal rather than as an attempt the learner got right.
 * Without that split the record would say a child interpreted 4,143 sentences
 * when they pressed a button 4,143 times.
 *
 * THE HINT HALF IS NOT BUILT, ON PURPOSE. The partial help for this rung is
 * one word's meaning — a gloss — and glosses are tabled into their own plan
 * (`2026-09-11-sentence-ladder-word-glosses.md`). A Hint button with no gloss
 * behind it is a dead control, and a child who presses a dead button concludes
 * the screen is broken and stops trusting the rest of it. So: no Hint, not
 * even disabled, until there is something for it to say.
 *
 * NO KEYBOARD SHORTCUT, unlike the peek — and unlike the peek, deliberately
 * one-way. A key that ends the exercise is a key that ends it by accident, and
 * an "un-reveal" would let a child read the answer, put it away, and type it
 * back as their own, which is precisely the record this split exists to
 * protect. It costs a deliberate tap, and after it the field is gone.
 */
const REVEAL_WORD = 'Show answer';

/**
 * SPEAKING THE ANSWER — interpretation only, and it is an INPUT METHOD, not a
 * different kind of answer.
 *
 * The rung asks what a sentence means. A learner who understands it perfectly
 * can still be defeated by an English keyboard, and the record then measures
 * typing rather than comprehension — which is the one thing this rung exists
 * to measure. So they can say it instead: the mic opens, the take goes for
 * recognition, and the transcript arrives IN THE FIELD.
 *
 * IN THE FIELD, UNSUBMITTED, and that is the whole design. A transcript sent
 * straight off would make every mistranscription the learner's mistake, marked
 * down for a word they said correctly and never told why. Landing it in the
 * field costs one extra tap and makes the machine's guess something they can
 * see and correct — which is also the only way they ever find out it guessed.
 *
 * NOT ON DICTATION, and not because it would be hard. Dictation's task IS
 * entering the Korean script; a learner who could say the sentence instead
 * would be handing in a recording of the one skill being drilled.
 *
 * IT REPLACES THE FIELD rather than appending. What is usually sitting there
 * is an abandoned half-attempt, and splicing a spoken sentence onto it makes a
 * sentence nobody said. The control's caption turns over to say so before the
 * learner presses it, for the same reason "Play" becomes "Play again".
 */
const SPEAK_WORD = 'Say the answer';
const SPEAK_STOP_WORD = 'Stop speaking';

/**
 * How long a spoken answer may run before the mic closes itself.
 *
 * A child who walks away mid-take would otherwise hold the microphone open
 * until the rung unmounted, with the OS recording indicator lit on a panel in
 * their room. Long enough for any sentence in the corpus said slowly, twice.
 */
export const MAX_SPEAK_MS = 20_000;

/**
 * The baseline's quiet control: a glyph, the word for anything that asks, and
 * the visible caption — which is where the shortcut is written when there is a
 * keyboard to press it on. Play, Stop and Peek are the same button three
 * times, and written out three times they had already begun to drift.
 */
function QuietButton({ icon, word, caption, onClick }) {
  return (
    <button type="button" className="lang-btn lang-btn--quiet" onClick={onClick}>
      {icon && <Icon name={icon} className="lang-btn__glyph" />}
      {/* The accessible name, kept off screen: the caption beside it says the
          shortcut, and a control called "Tab plays" is not called "Play". */}
      <span className="lang-btn__word">{word}</span>
      <span className="lang-btn__key" aria-hidden="true">{caption}</span>
    </button>
  );
}

export default function TypedRung({
  entry, audioUrl, nextEntry, onComplete, saving, showShortcuts = false,
  idleReplayMs = DEFAULT_IDLE_REPLAY_MS,
  /**
   * Turn a spoken take into text: `(blob) => Promise<{ok, transcript, empty}>`.
   *
   * ABSENT means the control is not drawn at all, and the program decides that
   * — it is the only thing that knows whether this device has a microphone and
   * whether the server can transcribe (`day.voiceAnswer`). A control that
   * cannot ever work is a dead control, and a child who presses a dead button
   * concludes the screen is broken and stops trusting the rest of it; the same
   * reasoning keeps Hint off this rung until glosses exist.
   */
  onTranscribe = null,
}) {
  const [value, setValue] = useState('');
  /**
   * What the IME says is SETTLED and what is still in flight.
   *
   * Never `value`. In 두벌식 a consonant is genuinely ambiguous until the next
   * vowel lands: typing 오늘 leaves the field reading 온 after ㄴ, and only the
   * next vowel decides whether that ㄴ closed 오 or opened 늘. A strip fed the
   * field value calls column 0 settled-and-WRONG at that moment, reddens it and
   * jumps the caret on — then undoes itself a keystroke later. The glyph the
   * child is in the middle of typing disappears out from under them.
   * `compositionState` is the seam that makes that impossible.
   */
  const [typed, setTyped] = useState({ committed: '', pending: '' });
  const [played, setPlayed] = useState(false);
  // Sticky, unlike `saving`: the answer is in, so nothing may start sounding
  // while the program works out which rung comes next.
  const [submitted, setSubmitted] = useState(false);
  // Stop means QUIET, not "quiet for thirty seconds". A learner who silences
  // the sentence has told us the audio is in their way; bringing it back on a
  // timer would re-impose exactly the thing they just refused, which is the
  // loop again in slower clothes. Cleared by any explicit ask — Tab, or the
  // Play button — so resuming costs one key and never needs explaining.
  const [hushed, setHushed] = useState(false);
  /**
   * A refused keystroke, drawn. Two pieces of state for one flash:
   *   `refusing`  whether the class is on right now
   *   `refusals`  how many there have EVER been, which keys the strip
   *
   * The counter exists because the flash is a CSS transition, and a transition
   * only runs when the property it watches actually changes. A second refusal
   * inside the window of the first would leave the column sitting still —
   * precisely the "nothing happened" this flash exists to prevent. Keying the
   * strip on the counter remounts it from rest, so every refusal moves.
   */
  const [refusing, setRefusing] = useState(false);
  const [refusals, setRefusals] = useState(0);
  // The whole of the peek: one boolean, cleared by the next keystroke. See
  // PEEK_KEY above for why it is not a third dictation mode.
  const [peeking, setPeeking] = useState(false);
  // The reveal, and it only ever goes one way. See REVEAL_WORD above.
  const [revealed, setRevealed] = useState(false);
  /**
   * The spoken answer, as three visibly different states: `idle`, `recording`,
   * `sending`. Three, not two, because the round trip is a model call — a
   * control that looked the same for four seconds would read as broken to a
   * child at a panel with no pointer and no other way to ask what is happening.
   */
  const [speaking, setSpeaking] = useState('idle');
  // What went wrong with the last take, in words, for the notice line. Every
  // failure here is survivable — the field never goes away — so this is an
  // explanation, never a dead end.
  const [speakNote, setSpeakNote] = useState(null);
  /**
   * Whether what is in the field came from the learner's voice.
   *
   * Cleared the moment the field is emptied: a transcript deleted and retyped
   * from scratch is theirs from the keys, and calling that spoken would be a
   * fact nobody established. An EDIT of a transcript stays spoken — the answer
   * came from speech and was then corrected, which is exactly what the extra
   * tap is for.
   */
  const [spokenFrom, setSpokenFrom] = useState(null);
  const inputRef = useRef(null);
  // The one control left standing after a reveal takes the focus the field
  // gives up, so a learner on a bonded keyboard can still press Enter rather
  // than being stranded with focus on a removed element.
  const commitRef = useRef(null);
  const hushedRef = useRef(false);
  hushedRef.current = hushed;

  const { compositionState, setTypingOracle } = useHangulTyping();
  const { playSequence, preload, stop, playing, blocked } = useSentenceAudio();

  const responseLang = entry.response?.language;
  const promptLang = entry.prompt?.[0]?.language;
  const isDictation = entry.rung === 'dictation';
  const isCopying = isDictation && entry.copyPrompt === true;
  const targetText = entry.text?.[promptLang] ?? '';

  /**
   * How much of the model the strip is allowed to draw. Copy mode traces a
   * visible sentence; listen mode must not have it in the DOM at all, or the
   * drill is a reading exercise for anyone who can reach devtools — except
   * while the learner is holding a peek open, which is 'all': every column at
   * once, the live one marked, the rest ghosted. Threaded as a value rather
   * than inlined, which is why the peek is one line here and nothing at all in
   * `glyphStrip.js`.
   */
  const reveal = isCopying ? 'model' : (peeking ? 'all' : 'none');
  // Copy mode already shows the sentence, and the interpretation rung shows its
  // target whole — there is nothing for either to peek at.
  const canPeek = isDictation && !isCopying;
  /**
   * What the reveal would show: the text in the language the learner is being
   * asked to produce. Guarded on the text actually existing, because a corpus
   * row missing its English would otherwise draw a control that shows a blank
   * — which reads as the reveal being broken rather than the data being thin.
   */
  const answerText = entry.text?.[responseLang] ?? '';
  // Dictation has the peek; interpretation has this. Never both on one rung:
  // on dictation the model is help, on interpretation it is the answer.
  const canReveal = !isDictation && answerText !== '' && !revealed;
  // See SPEAK_WORD. Interpretation only, and only where something can actually
  // listen — after a reveal there is nothing left to answer, by voice or
  // otherwise.
  const canSpeak = !isDictation && typeof onTranscribe === 'function' && !revealed;

  /**
   * THE COPY-MODE GATE, wired up.
   *
   * The IME half has shipped for a while (`ime/syllable.js`, and `handleKey`'s
   * optional third argument); nothing reached it until this. Copy mode is a
   * worksheet with the shape printed on it: a key that would stop the syllable
   * in flight being a prefix of the one being traced does not land, and the
   * column says so.
   *
   * ⚠ COPY MODE ONLY, and the effect bails before it registers anything in
   * listen mode. The program knows the target in BOTH modes — that is exactly
   * the trap. Gating listen mode would refuse a keystroke the learner genuinely
   * meant: a child who misheard 오늘 as 온… would be steered into the right
   * answer with nothing on screen saying so, and the record would then claim
   * they heard it correctly. A drill that looks like it is working while
   * measuring nothing is worse than one that is visibly broken.
   *
   * The target is read through a ref so a re-render mid-sentence does not
   * re-register the oracle, and the element is passed with it so the provider
   * can refuse to apply it to any other field in School.
   */
  const targetRef = useRef(targetText);
  targetRef.current = targetText;
  const refusalTimer = useRef(null);

  const flashRefusal = useCallback((jamo) => {
    languageLog.rung('refused', { rung: entry.rung, seq: entry.seq, jamo });
    setRefusals((n) => n + 1);
    setRefusing(true);
    window.clearTimeout(refusalTimer.current);
    refusalTimer.current = window.setTimeout(() => setRefusing(false), REFUSAL_FLASH_MS);
  }, [entry.rung, entry.seq]);

  useEffect(() => () => window.clearTimeout(refusalTimer.current), []);

  useEffect(() => {
    if (!isCopying) return undefined;
    const el = inputRef.current;
    if (!el) return undefined;
    const oracle = {
      /**
       * The one syllable being traced right now, or null for "no opinion".
       *
       * Indexed by how much has SETTLED — the same seam the strip reads, and
       * the only one that survives a space: a space is not a traceable target,
       * so the gate stands down for that keystroke, the space lands as itself,
       * and the next syllable lines up again on the far side of it.
       */
      currentTarget: () => Array.from(targetRef.current)[
        Array.from(compositionState(el).committed).length
      ] ?? null,
      onRefused: flashRefusal,
    };
    setTypingOracle(el, oracle);
    return () => setTypingOracle(null, null);
  }, [isCopying, compositionState, setTypingOracle, flashRefusal]);

  const columns = useMemo(
    () => columnsFor({
      target: targetText, committed: typed.committed, pending: typed.pending, reveal,
    }),
    [targetText, typed.committed, typed.pending, reveal],
  );

  // NOTE: do NOT reset `value`/`played` here. This component is remounted per
  // entry via `key={rung-seq}` (in SentenceLadderProgram), so each entry already
  // starts with fresh state. A `setValue('')` in this effect is not only
  // redundant — it RACES: the parent's caps/day load cascade can defer this
  // passive effect until after the learner has begun typing, and it then wipes
  // their input. Keep only the per-entry enter log and the audio-stop cleanup.
  useEffect(() => {
    languageLog.rung('enter', { rung: entry.rung, seq: entry.seq });
    // Hands on the keys from the first frame: the tap that brought the child
    // here left focus on a ladder rung or a Next button, and typing there
    // goes nowhere. Focus the field so the first keystroke is the first letter.
    inputRef.current?.focus?.({ preventScroll: true });
    return () => stop();
  }, [entry.seq, entry.rung, stop]);

  useEffect(() => {
    if (!nextEntry) return;
    preload((nextEntry.prompt || []).map((p) => audioUrl(nextEntry.seq, p.language)));
  }, [nextEntry, audioUrl, preload]);

  const play = useCallback(() => {
    setPlayed(true);
    // Asking for the sentence is what un-hushes it.
    setHushed(false);
    // Emphatically NOT `{ loop: true }`. Repeating until submit turned support
    // into a siren for anyone typing slowly, and there was no control on the
    // rung that could stop it. One pass; Play again, Tab, or the idle replay
    // brings it back when the learner wants it.
    playSequence(clipsFor(entry, audioUrl), { loop: false });
    // Return focus so the learner can keep typing without a second tap.
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [entry, audioUrl, playSequence]);

  // The sentence plays because the learner ARRIVED, not because they started
  // typing. Starting it from the first keystroke meant the audio began at the
  // moment their attention was already on the keys — and then never stopped.
  // Once per mount, and the component is keyed per entry, so the ref is per
  // sentence. Deliberately a separate effect from the enter/cleanup one above,
  // whose warning about resetting state still stands.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    play();
  }, [play]);

  /**
   * GLYPH-PACED AUDIO. The sentence is paced by the learner's own progress: a
   * syllable that settles in the right column replays the clip, so the model
   * arrives at the speed they are actually working and doubles as the "yes,
   * that one" they would otherwise have to wait until Submit for.
   *
   * COPY MODE ONLY, and that restriction is the whole point. In listen mode
   * the model is hidden deliberately; a clip that fires exactly when the
   * learner is right TELLS them they are right, which is the entire exercise.
   * A drill that looks like it is working while measuring nothing is the
   * failure this screen keeps circling back to.
   */
  const settledCount = useRef(0);
  useEffect(() => {
    const settled = Array.from(typed.committed);
    const before = settledCount.current;
    // Updated on every path, including listen mode and backspace, so the
    // "grew" comparison is never measured against a stale high-water mark.
    settledCount.current = settled.length;
    if (!isCopying || settled.length <= before) return;
    const want = Array.from(targetText);
    const at = settled.length - 1;
    if (settled[at] !== want[at]) return;
    // Stop still means quiet. A learner who silenced the sentence did not ask
    // for it back by typing correctly, and re-imposing it here would be the
    // loop returning through a side door.
    if (hushedRef.current) return;
    languageLog.rung('glyph-replay', { rung: entry.rung, seq: entry.seq, at });
    play();
  }, [typed.committed, isCopying, targetText, play, entry.rung, entry.seq]);

  const stopPlayback = useCallback(() => {
    languageLog.rung('stopped', { rung: entry.rung, seq: entry.seq });
    setHushed(true);
    stop();
    inputRef.current?.focus();
  }, [stop, entry.rung, entry.seq]);

  /**
   * Show the sentence, or put it away again.
   *
   * Logged on the REVEAL edge only, and through the same rung category as
   * everything else on this screen, so the peek count for a sentence is in the
   * evidence log beside the attempt it belongs to. That count is what tells a
   * grown-up whether a child is ready for the rung — which is the only reason
   * this needs no cap.
   */
  const togglePeek = useCallback(() => {
    const next = !peeking;
    setPeeking(next);
    if (next) {
      languageLog.rung('peek', {
        rung: entry.rung, seq: entry.seq, at: Array.from(typed.committed).length,
      });
    }
    // Back to the keys: a peek taken with the button leaves focus on it, and
    // the next keystroke — the one that is supposed to take the peek away —
    // would go nowhere.
    inputRef.current?.focus();
  }, [peeking, typed.committed, entry.rung, entry.seq]);

  /**
   * Show the answer, and end the exercise for this sentence.
   *
   * BOTH FORMS AT ONCE — the text on screen and the clip in the learner's ear
   * — because they are one surrender, not two. Split into "Show" and "Hear"
   * they would read as two different kinds of help, a child who took one would
   * reasonably take the other, and the log would carry two rows for one
   * sentence nobody answered. Having given the answer away, the most useful
   * thing left to do with it is teach it, which is what hearing it does.
   *
   * Nothing is written down here. The record is made when the learner presses
   * Continue, through the same `onComplete` an answer goes through — one
   * commit point per sentence, so a reveal cannot land twice and cannot land
   * without the learner having seen what they asked for.
   */
  const doReveal = useCallback(() => {
    setRevealed(true);
    setPeeking(false);
    languageLog.rung('reveal', {
      rung: entry.rung, seq: entry.seq, typed: Array.from(value).length,
    });
    // Asking for the answer un-hushes, exactly as asking for the prompt does.
    setHushed(false);
    playSequence([{ url: audioUrl(entry.seq, responseLang) }], { loop: false });
    window.setTimeout(() => commitRef.current?.focus?.({ preventScroll: true }), 0);
  }, [entry.rung, entry.seq, value, audioUrl, responseLang, playSequence]);

  /**
   * THE SPOKEN ANSWER, end to end. See SPEAK_WORD for why it exists and why
   * the transcript stops in the field.
   *
   * Nothing about the expected answer is sent or could be: the take goes up as
   * audio and the language the learner is answering in, and the server's route
   * never reads the corpus. That is not a courtesy — a recogniser told what it
   * is expecting hears that sentence whatever the child said, and the rung
   * would then measure nothing while looking perfect.
   */
  const speakTimer = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
    window.clearTimeout(speakTimer.current);
  }, []);

  const onTake = useCallback(async ({ blob, durationMs }) => {
    window.clearTimeout(speakTimer.current);
    languageLog.capture('speak-stop', {
      rung: entry.rung, seq: entry.seq, bytes: blob?.size ?? 0, durationMs,
    });
    setSpeaking('sending');
    const result = await onTranscribe?.(blob);
    if (!alive.current) return;
    setSpeaking('idle');

    if (!result?.ok) {
      languageLog.captureError('transcribe-failed', {
        rung: entry.rung, seq: entry.seq, status: result?.status ?? null,
      });
      // NOT A DEAD END. The field is still there and still the way through, so
      // the note says both things a stuck child needs: it can be tried again,
      // and it does not have to be.
      setSpeakNote('That didn’t get written down — have another go, or type it.');
      return;
    }
    const transcript = String(result.transcript ?? '').trim();
    if (result.empty || !transcript) {
      languageLog.capture('speak-unheard', { rung: entry.rung, seq: entry.seq });
      // Their own typing is untouched. A mic that heard nothing is no reason
      // to throw away what they had already written.
      setSpeakNote('We didn’t hear that — have another go, or type it.');
      return;
    }

    setSpeakNote(null);
    // Lengths, never the words: the transcript is a child's voice written
    // down, and the log store is a searchable index that outlives the audio.
    languageLog.rung('spoke', {
      rung: entry.rung, seq: entry.seq, chars: transcript.length, replaced: value.length,
    });
    setValue(transcript);
    setSpokenFrom(transcript);
    setPeeking(false);
    // Back to the keys with the caret at the end, so the first correction is
    // the first keystroke rather than a tap to get there.
    window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange?.(transcript.length, transcript.length);
    }, 0);
  }, [entry.rung, entry.seq, onTranscribe, value.length]);

  const onSpeakDenied = useCallback((err) => {
    languageLog.captureError('speak-denied', {
      rung: entry.rung, seq: entry.seq, error: err?.message,
    });
    setSpeaking('idle');
    // PRESENT-AND-EXPLAINING, unlike a device with no microphone at all, where
    // the control is never drawn. The device said it had one, so the control
    // was honestly offered and the failure is a permission a second try may
    // yet get — and typing is still right there either way.
    setSpeakNote('The microphone didn’t open — have another go, or type it.');
  }, [entry.rung, entry.seq]);

  const { start: startSpeaking, stop: stopSpeaking } = useVoiceCapture({
    onTake, onDenied: onSpeakDenied,
  });

  const speak = useCallback(async () => {
    setSpeakNote(null);
    // Nothing may be sounding into an open microphone. The prompt playing over
    // the take is the one way to get the model to transcribe the sentence back
    // at us rather than the child.
    stop();
    setHushed(true);
    if (!await startSpeaking()) return;
    setSpeaking('recording');
    languageLog.rung('speak-start', { rung: entry.rung, seq: entry.seq });
    // The mic closes itself eventually — see MAX_SPEAK_MS.
    speakTimer.current = window.setTimeout(() => {
      languageLog.capture('speak-capped', { rung: entry.rung, seq: entry.seq, afterMs: MAX_SPEAK_MS });
      stopSpeaking();
    }, MAX_SPEAK_MS);
  }, [entry.rung, entry.seq, startSpeaking, stopSpeaking, stop]);

  // Going quiet is what a stuck learner looks like, and hearing the sentence
  // again is what the loop was reaching for before it became a siren. So:
  // exactly one replay after a silence. Keyed on `value`, so every keystroke
  // restarts the wait; on `playing`, so it never talks over itself; dead once
  // the attempt is in. A non-finite or non-positive interval turns it off.
  useEffect(() => {
    if (!Number.isFinite(idleReplayMs) || idleReplayMs <= 0) return undefined;
    // `revealed` counts as done here: the exercise is over, and a sentence
    // that starts offering itself again over the answer is talking to nobody.
    if (playing || submitted || saving || revealed) return undefined;
    // Nor while the learner is speaking, or waiting to hear what was heard.
    if (speaking !== 'idle') return undefined;
    // Silenced on purpose. See `hushed`.
    if (hushed) return undefined;
    // A kiosk that has not been touched yet fails the autoplay gate, and a
    // rejected play cannot un-reject itself. Retrying on a timer would be
    // inaudible and would beat a `play-blocked` warn into the log store every
    // interval, forever. The notice on screen asks for the tap instead.
    if (blocked) return undefined;

    const timer = window.setTimeout(() => {
      languageLog.rung('idle-replay', { rung: entry.rung, seq: entry.seq, afterMs: idleReplayMs });
      play();
    }, idleReplayMs);
    return () => window.clearTimeout(timer);
  }, [idleReplayMs, playing, submitted, saving, blocked, hushed, revealed, speaking, value, play, entry.rung, entry.seq]);

  const submit = useCallback(() => {
    if (saving) return;
    /**
     * TWO ROWS, ONE BUTTON. A revealed sentence is committed through the same
     * path as an answered one — same guard against a double press, same stop,
     * same `onComplete` — and differs in exactly one field: it carries
     * `revealed` INSTEAD OF `given`, never as well as. Whatever the learner had
     * typed before they gave up is not what they produced, and the answer now
     * sitting on screen is the one string that must never be recorded as
     * theirs. See `LanguageStudyService#recordAttempt`, which drops the
     * accuracy on its side for the same reason.
     */
    if (revealed) {
      setSubmitted(true);
      stop();
      languageLog.rung('complete', { rung: entry.rung, seq: entry.seq, revealed: true });
      onComplete({ seq: entry.seq, rung: entry.rung, revealed: true });
      return;
    }
    if (!value.trim()) return;
    setSubmitted(true);
    stop();
    /**
     * HOW IT WAS GIVEN, on the row with the answer itself. The response is
     * still text — voice is an input method — so this is one field, not a
     * second kind of record, and it is what lets a grown-up reading the log
     * tell a spoken answer from a typed one instead of guessing.
     */
    const method = spokenFrom ? 'spoken' : 'typed';
    languageLog.rung('complete', { rung: entry.rung, seq: entry.seq, method });
    onComplete({ seq: entry.seq, rung: entry.rung, given: value, method });
  }, [value, saving, revealed, spokenFrom, stop, entry, onComplete]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      play();
      return;
    }
    if (canPeek && e.key === PEEK_KEY) {
      e.preventDefault();
      togglePeek();
      return;
    }
    // No Space branch. Space used to mean "play" while the field was empty,
    // which reads fine in English and is a trap in Korean: 오늘 온 사람 begins
    // with a word, then a space the learner cannot type. The key is a space.
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }, [play, submit, canPeek, togglePeek]);

  const label = isCopying ? 'Copy the sentence' : isDictation ? 'Type what you hear' : 'Type what it means';

  return (
    <div className={`lang-rung lang-rung--${entry.rung}`}>
      {blocked && (
        <p className="lang-rung__notice" role="alert">Audio was blocked — tap Play again.</p>
      )}
      {/* Every way speaking can fail says the same two things: it can be tried
          again, and it does not have to be. The field is never taken away, so
          there is no state this notice can leave a child stranded in. */}
      {speakNote && <p className="lang-rung__notice" role="alert">{speakNote}</p>}

      {/* The drill, taking the height the baseline leaves it. */}
      <div className="lang-rung__stage">
        {/* Dictation gets the two column-aligned rows; interpretation gets the
            whole target sentence and a visible field, because there is no
            per-syllable correspondence to draw and an English answer aligned
            character by character would only leak its length. */}
        {isDictation
          ? (
            /* The wrapper exists for the refusal flash: the strip renders what
               `columnsFor` decided and holds no state, so "this keystroke was
               refused" — which is about the keyboard, not about the sentence —
               is carried here and styled through to the live column. Keyed on
               the refusal count so a repeat inside the window still moves; see
               `refusals` above. */
            <div
              key={`strip-${refusals}`}
              className={`lang-rung__strip${refusing ? ' is-refused' : ''}`}
            >
              <GlyphStrip columns={columns} caret={!saving && !submitted} />
            </div>
          )
          : <p className="lang-rung__target">{targetText}</p>}

        {/* THE ANSWER, IN PLACE OF THE FIELD — not above it. Rendering both put
            a dead grey input, still holding half an answer, directly under the
            sentence it had just been handed: a standing invitation to type the
            answer back in, and on a panel a disabled field is barely
            distinguishable from a live one. There is nothing left to answer,
            so there is no field. It also says plainly what the record will
            say, because a child who does not know this counts differently will
            press it as if it were a hint. */}
        {revealed ? (
          <div className="lang-rung__answer">
            <p className="lang-rung__answer-text">{answerText}</p>
            <p className="lang-rung__answer-note">
              Shown, not answered — this one goes down as shown.
            </p>
          </div>
        ) : (
          <>
          {/* Kept on the dictation rung for the accessible name only: the strip is
              `role="presentation"` duplication of this field, so the field is still
              the labelled control, but a visible caption above two rows that already
              say "model here, your answer here" is the stack this screen shed. */}
          <label
            className={`lang-rung__label${isDictation ? ' is-offscreen' : ''}`}
            htmlFor={`lang-input-${entry.seq}`}
          >
            {label}
          </label>
          <input
            id={`lang-input-${entry.seq}`}
            ref={inputRef}
            className={`lang-rung__input${isDictation ? ' is-offscreen' : ''}`}
            type="text"
            lang={responseLang}
            /* Drives the School-wide in-page IME: dictation asks for the target
               script, interpretation for the source, and the mode follows focus
               with no keypress. F6 still overrides. */
            data-ime-lang={responseLang}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            onChange={(e) => {
              // Nothing starts playing here any more. This line is where the loop
              // was armed — the first keystroke began audio that then ran until
              // submit — so the one job a keystroke has now is to be a keystroke.
              // (It also restarts the idle wait, via the effect's `value` dep.)
              setValue(e.target.value);
              // Emptied means started over: whatever is typed next is theirs
              // from the keys, not a transcript they edited, and the record
              // must not go on calling it spoken. An edit of a transcript is
              // still spoken — see `spokenFrom`.
              if (e.target.value.trim() === '') setSpokenFrom(null);
              // TYPE TO HIDE. The peek is over the moment the learner writes
              // anything — that is what stops it being copy mode with an extra
              // step, and it is why there is no timer and no cap.
              setPeeking(false);
              // Read from the composer DURING its own change event, which is the
              // only moment its answer is guaranteed current — see the note on
              // `typed` above for why the field's value will not do.
              setTyped(compositionState(e.target));
            }}
            onKeyDown={onKeyDown}
            disabled={saving}
          />
          </>
        )}
      </div>

      {/* The baseline: what sounds, on the left with its shortcut written on
          it, and the way forward on the right. Audio is NOT a column — a 90px
          disc owning the vertical centre of the screen made the loudest thing
          on a typing rung the thing the learner needs least often. */}
      <div className="lang-rung__baseline">
        <div className="lang-rung__cues">
          {/* The shortcut is written on the caption ONLY where those keys
              exist: a touch panel may have a Hangul IME on its on-screen
              keyboard and no Tab key at all, and instructions for absent
              hardware are worse than no instructions. */}
          <QuietButton
            icon="play"
            word={played ? 'Play again' : 'Play'}
            caption={showShortcuts ? 'Tab plays' : (played ? 'Play again' : 'Play')}
            onClick={play}
          />
          {/* The way out of the sound. While the clip looped there was no such
              control anywhere on this rung: the only escape was to finish
              typing. It appears only while something is actually sounding, so
              the row never offers a Stop with nothing to stop. */}
          {playing && (
            <QuietButton icon="pause" word="Stop" caption="Stop" onClick={stopPlayback} />
          )}
          {/* THE PEEK, AND ITS BUTTON. The key alone would be unreachable on
              the Portal, which is a panel with a keyboard only sometimes
              bonded to it — and this rung's whole audience is the child typing
              blind. No glyph: the icon set has nothing that reads as "show me"
              at a glance, and a wrong picture is worse than a plain word. */}
          {/* THE REVEAL, and it is not the peek — see REVEAL_WORD. It sits in
              the quiet row rather than beside Submit: the way forward on this
              screen is answering, and the way out should take a deliberate
              reach across to the other side of the baseline. No glyph and no
              shortcut caption, because there is no key. */}
          {canReveal && (
            <QuietButton word={REVEAL_WORD} caption={REVEAL_WORD} onClick={doReveal} />
          )}
          {canPeek && (
            <QuietButton
              word={peeking ? 'Hide' : 'Peek'}
              /* The caption turns over with the state for the same reason
                 "Play" becomes "Play again": a control that reads the same
                 either way leaves a child no way to tell whether the sentence
                 is up because they asked for it. */
              caption={showShortcuts
                ? (peeking ? 'F1 hides' : 'F1 peeks')
                : (peeking ? 'Hide' : 'Peek')}
              onClick={togglePeek}
            />
          )}
        </div>
        {/* THE WAY FORWARD, and the two ways of getting there. Speaking sits
            with Submit rather than in the quiet cue row on the left: it is a
            way of ANSWERING, not a way of hearing the sentence again, and a
            child reaching for it is reaching for the same side of the screen
            they reach for to hand the answer in. */}
        <div className="lang-rung__commit">
          {canSpeak && speaking === 'idle' && (
            /* NO GLYPH, for the reason the peek has none: the icon set has
               nothing that reads as "say it" at this size. `record` is a tape
               reel and it is the RECORDING rung's start tile — borrowed here it
               would promise that this take is kept, which is the one thing it
               is not. A wrong picture is worse than a plain word. */
            <QuietButton
              word={SPEAK_WORD}
              /* "instead" is a warning, not decoration: the transcript
                 REPLACES the field, and a child who has half an answer typed
                 should know that before they press it, not after. */
              caption={value.trim() ? 'Speak instead' : 'Speak'}
              onClick={speak}
            />
          )}
          {canSpeak && speaking === 'recording' && (
            <button
              type="button"
              className="lang-btn lang-btn--quiet lang-btn--live"
              onClick={stopSpeaking}
            >
              <Icon name="stop" className="lang-btn__glyph" />
              <span className="lang-btn__word">{SPEAK_STOP_WORD}</span>
              <span className="lang-btn__key" aria-hidden="true">Stop</span>
            </button>
          )}
          {/* IN FLIGHT, and deliberately not a button. The round trip is a
              model call taking seconds; there is nothing useful to press, and
              a control that looked identical to the one just pressed would
              read as broken to a child at a panel with no pointer. A status
              that says what is being waited on, moving while it waits — the
              same shape the recording rung's sounding phases use. */}
          {canSpeak && speaking === 'sending' && (
            <span className="lang-btn lang-btn--quiet is-working" role="status">
              <span className="lang-btn__key">Writing it down…</span>
            </span>
          )}
          <button
            type="button"
            ref={commitRef}
            className="lang-btn lang-btn--primary"
            onClick={submit}
            disabled={(!revealed && !value.trim()) || saving}
          >
            {/* "Submit" is a word for work being handed in. After a reveal there
                is nothing to hand in, so the button says what actually happens
                next. */}
            {saving ? 'Saving…' : revealed ? 'Continue' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
