import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { FieldComposer, declaredLanguage, isComposableField } from './fieldComposer.js';
import { modeForLanguage } from './languages.js';
import { imeLog } from './imeLog.js';
import Icon from '../home/icons/Icon.jsx';
import './ime.scss';

/**
 * School-wide in-page input method.
 *
 * The Portal's WebView has no IME for the bonded physical keyboard, so Korean
 * would otherwise arrive as Latin in every field School owns — the sentence
 * ladder's dictation rung, but also `ShortAnswerItem` and `ClozeItem`, which is
 * why this wraps the whole app rather than living inside one rung.
 *
 * ITS RESTRAINT IS THE DESIGN. Seven components in School already own a global
 * `keydown`, one of them a barcode scanner that types like a keyboard. So in
 * English mode this listener does one key comparison and passes everything
 * through, and even in Korean mode it acts only on free-text fields that have
 * not opted out. Opt-outs are declared with `data-ime="off"`, never inferred.
 *
 * Mode is not persisted. The Portal is shared — two learners take turns at it —
 * and a panel that silently reopens in Korean for whoever sits down next is
 * worse than one that starts in English and flips itself the moment a field
 * asks for Korean, which is what the ladder's rungs do.
 */

const TOGGLE_CODE = 'F6'; // the keyboard's globe key, which arrives as F6

const HangulTypingContext = createContext({
  mode: 'EN',
  register: 'status',
  setMode: () => {},
  toggle: () => {},
  // Outside a provider nothing is being composed, so every field is settled.
  compositionState: (el) => ({ committed: el?.value ?? '', pending: '' }),
  // Outside a provider there is no keydown listener to gate, so registering an
  // oracle is a no-op rather than an error.
  setTypingOracle: () => {},
});

export function useHangulTyping() { return useContext(HangulTypingContext); }

/**
 * The flags are INLINE SVG, not emoji. The Portal's WebView draws emoji flags
 * as tofu (two letters in a box), which on a language toggle is exactly the
 * one glyph that has to be legible. The two files live with the subject
 * icons so they render through the same `Icon`.
 */
export const FLAG_ICON = { EN: 'flag-us', KR: 'flag-kr' };
export const NAMES = { EN: 'English', KR: '한국어' };

/**
 * TWO REGISTERS FOR ONE FACT (2026-09-09). The typing language matters at two
 * very different moments. While a child is typing into a field, it is the
 * thing that decides whether their keystrokes come out as Korean, and it
 * has to be prominent — a labelled badge with the F6 hint. The rest of the
 * time it is a background fact, and a labelled badge floating over the
 * board's corner was reading as a control on a screen that has none. So:
 *
 *   prominent  a composable text field has focus — the badge is drawn
 *   status     nothing is typing — the badge is not; the board's header
 *              shows a small flag disc beside the clock instead
 *
 * The register is derived from focus, not declared by screens, so a new
 * text field anywhere in School gets the prominent badge for free.
 */
export const REGISTERS = Object.freeze(['status', 'prominent']);

/**
 * The live mode, drawn by the provider itself rather than by the School header.
 * That header renders only when the panel is unlocked, and the Portal is always
 * locked — a badge in it would be invisible in the one place this is for.
 */
function ModeBadge({ mode, declared }) {
  return (
    <div
      className={`school-ime-badge school-ime-badge--${mode.toLowerCase()}`}
      data-testid="school-ime-badge"
      role="status"
      aria-live="polite"
      aria-label={`Typing ${NAMES[mode]}`}
    >
      <span className="school-ime-badge__flag" aria-hidden><Icon name={FLAG_ICON[mode]} /></span>
      <span className="school-ime-badge__label">{NAMES[mode]}</span>
      {/* Only worth saying when the learner could act on it. While a field is
          driving the mode, F6 would be overridden on the next focus change. */}
      {!declared && <span className="school-ime-badge__hint">F6</span>}
    </div>
  );
}

export default function HangulTypingProvider({ children, enabled = true }) {
  // What F6 last chose. The live mode falls back to this whenever no focused
  // field is asking for something else.
  const [manualMode, setManualMode] = useState('EN');
  const [declared, setDeclared] = useState(null);
  const [register, setRegister] = useState('status');
  const composer = useRef(null);
  if (composer.current === null) composer.current = new FieldComposer();

  const mode = declared ?? manualMode;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const setMode = useCallback((next) => {
    setManualMode(next === 'KR' ? 'KR' : 'EN');
  }, []);

  const toggle = useCallback(() => {
    // Toggle the LIVE mode, not the manual one. Inside a field that declared
    // Korean, the manual setting is still English, so flipping that would send
    // English -> Korean and leave the badge exactly where it was — F6 would
    // read as broken in the one place it is most needed.
    const next = modeRef.current === 'KR' ? 'EN' : 'KR';
    setManualMode(next);
    // A manual choice also overrides what the focused field asked for, until
    // focus moves again.
    setDeclared(null);
    imeLog.mode('toggled', { to: next });
  }, []);

  /**
   * Which part of a field is settled and which syllable is still in flight.
   * A rung matching a target against the field cannot use `value`: in 두벌식
   * the consonant that starts a syllable first lands as the previous one's
   * batchim, so `value` briefly spells a word the learner did not type.
   *
   * A ref read, deliberately not state: callers ask during their own onChange,
   * which the composer's own `writeField` already triggered, so the answer is
   * current and no extra render is needed to deliver it.
   */
  const compositionState = useCallback((el) => composer.current.compositionState(el), []);

  /**
   * THE COPY-MODE PREFIX ORACLE, handed in by whichever field is being traced.
   *
   * `FieldComposer.handleKey` takes the oracle as an optional third argument and
   * behaves exactly as it always did without one — that default is what keeps
   * listen mode honest, so the seam is "nobody registered one" rather than a
   * flag some screen could forget to clear.
   *
   * SCOPED TO ONE ELEMENT, deliberately. This provider wraps the whole of
   * School, and an oracle left armed over a field it was never meant for is a
   * keyboard that refuses letters for no reason a child can see. The element is
   * compared by identity, so an oracle whose rung has unmounted stops applying
   * even if its cleanup never ran.
   *
   * A ref, not state: it is read inside the capture-phase keydown listener, and
   * putting it in state would re-run that effect — tearing down and rebinding
   * the document listener — every time a rung mounted.
   */
  const oracleRef = useRef(null);
  const setTypingOracle = useCallback((el, oracle) => {
    oracleRef.current = el && oracle ? { el, oracle } : null;
  }, []);

  // A field may name its language; the nearest declaration wins and is released
  // when focus leaves it. `TypedRung` sets this from the rung's own response
  // language, so dictation and interpretation alternate without a keypress.
  useEffect(() => {
    if (!enabled) return undefined;
    const onFocusIn = (event) => {
      setRegister(isComposableField(event.target) ? 'prominent' : 'status');
      // A field naming ANY language is driving the mode — one we cannot
      // compose means "plain text here", which is how the ladder's
      // interpretation rung turns Korean back off.
      const next = modeForLanguage(declaredLanguage(event.target));
      setDeclared((current) => {
        if (current !== next) imeLog.mode(next ? 'declared' : 'released', { lang: next });
        return next;
      });
      composer.current.end();
    };
    // Focus leaving a field for nothing at all (a tap on the backdrop, a
    // screen change) fires no focusin; focusout with no `relatedTarget` is
    // that moment, and the badge must step back.
    const onFocusOut = (event) => {
      if (event.relatedTarget == null) setRegister('status');
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      if (event.code === TOGGLE_CODE && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        toggle();
        return;
      }
      // Everything below is Korean-mode only. In English the listener has
      // already done its whole job above.
      if (modeRef.current !== 'KR') return;
      const el = event.target;
      if (!isComposableField(el)) return;
      // Undefined unless THIS field registered one. `handleKey` with no oracle
      // is the plain automaton: every key lands, nothing is corrected.
      const armed = oracleRef.current;
      const oracle = armed && armed.el === el ? armed.oracle : undefined;
      if (composer.current.handleKey(event, el, oracle)) {
        event.preventDefault();
        // The field's own handlers must not also see a consumed jamo — a rung
        // that treats a keystroke as a shortcut would fire on every letter.
        event.stopPropagation();
      }
    };
    // Capture, so a consumed key never reaches a field's own onKeyDown.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, toggle]);

  // Nothing in flight survives the mode changing under it.
  useEffect(() => { composer.current.end(); }, [mode]);

  const value = useMemo(
    () => ({ mode, register, setMode, toggle, compositionState, setTypingOracle }),
    [mode, register, setMode, toggle, compositionState, setTypingOracle],
  );

  return (
    <HangulTypingContext.Provider value={value}>
      {children}
      {/* Keyed by mode so a flip remounts the badge and replays its animation
          — the learner has to notice the language changed under them. Drawn
          only in the prominent register; the status register is the
          header's flag disc (`LanguageDisc`). */}
      {enabled && register === 'prominent' && <ModeBadge key={mode} mode={mode} declared={declared !== null} />}
    </HangulTypingContext.Provider>
  );
}

/**
 * The status register: a small flag disc, no label, no hint. Sits right of
 * the clock in the board's header (and anywhere else a screen wants the
 * fact without the badge). Reads the live mode from context; draws nothing
 * outside a provider that is enabled.
 */
export function LanguageDisc({ className = '' }) {
  const { mode } = useHangulTyping();
  return (
    <span
      className={`school-ime-disc school-ime-disc--${mode.toLowerCase()} ${className}`.trim()}
      data-testid="school-ime-disc"
      role="img"
      aria-label={`Typing ${NAMES[mode]}`}
      title={`Typing ${NAMES[mode]} — F6 to switch`}
    >
      <Icon name={FLAG_ICON[mode]} />
    </span>
  );
}
