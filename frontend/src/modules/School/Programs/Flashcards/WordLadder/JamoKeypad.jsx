import { useState } from 'react';
import { TouchButton } from '../../../../../lib/ui/index.js';
import { useHangulTyping } from '../../../ime/HangulTypingProvider.jsx';
import './JamoKeypad.scss';

/**
 * 두벌식 (two-set) rows (spec §6). Only these five consonants and two vowels
 * carry a Shift form — everything else on the board reads the same either
 * way. `[base, shift]` — `shift` is undefined where there is none.
 */
const ROW_1 = [
  ['ㅂ', 'ㅃ'], ['ㅈ', 'ㅉ'], ['ㄷ', 'ㄸ'], ['ㄱ', 'ㄲ'], ['ㅅ', 'ㅆ'],
  ['ㅛ'], ['ㅕ'], ['ㅑ'], ['ㅐ', 'ㅒ'], ['ㅔ', 'ㅖ'],
];
const ROW_2 = [['ㅁ'], ['ㄴ'], ['ㅇ'], ['ㄹ'], ['ㅎ'], ['ㅗ'], ['ㅓ'], ['ㅏ'], ['ㅣ']];
const ROW_3 = [['ㅋ'], ['ㅌ'], ['ㅊ'], ['ㅍ'], ['ㅠ'], ['ㅜ'], ['ㅡ']];

/**
 * On-screen 두벌식 jamo keypad (spec §6). A TOGGLE, not a detector — there is
 * no web API that tells a page a Bluetooth keyboard is attached, so this
 * component only knows HOW to type Korean by touch; `TypedItem` decides
 * WHEN it shows (the toggle button, the 10 s auto-open, the close-on-real-
 * keydown).
 *
 * Every key fires on `onPointerDown`, never `onClick`, and calls
 * `preventDefault()` first: a `click` is preceded by the browser moving
 * focus to the button being pressed, and `offerJamo` / `offerBackspace` act
 * on `document.activeElement` — losing focus mid-tap would land every key on
 * nothing. Backspace and Enter get the same treatment so a run of taps never
 * bounces focus off the field.
 */
export default function JamoKeypad({ open, onSubmit, onToggle }) {
  const { offerJamo, offerBackspace } = useHangulTyping();
  const [shift, setShift] = useState(false);

  if (!open) return null;

  const jamoFor = (base, shifted) => (shift && shifted ? shifted : base);

  // Shift is a ONE-SHOT modifier: it releases the instant it is spent on a
  // jamo key, whether or not that key had a shifted form — a key with no
  // Shift variant (ㅗ, ㅋ, …) still consumes the modifier, the way a real
  // Shift+letter does even when the letter has no capital worth pressing it for.
  const pressKey = (base, shifted) => (event) => {
    event.preventDefault();
    offerJamo(jamoFor(base, shifted));
    if (shift) setShift(false);
  };
  const pressShift = (event) => { event.preventDefault(); setShift((s) => !s); };
  const pressBackspace = (event) => {
    event.preventDefault();
    offerBackspace();
    if (shift) setShift(false);
  };
  const pressSubmit = (event) => {
    event.preventDefault();
    if (shift) setShift(false);
    onSubmit?.();
  };
  const pressClose = (event) => { event.preventDefault(); onToggle?.(); };

  // A plain render function, deliberately NOT a component: declaring one
  // inside JamoKeypad's body would give it a fresh function identity every
  // render, and React treats each render's `<Key .../>` as a different
  // component type — remounting the button (and its DOM node) on every
  // keystroke instead of updating it in place.
  const renderKey = (base, shifted) => (
    <TouchButton
      key={base}
      variant={shift && shifted ? 'primary' : 'secondary'}
      className="wl-keypad__key"
      data-jamo={base}
      onPointerDown={pressKey(base, shifted)}
    >
      {jamoFor(base, shifted)}
    </TouchButton>
  );

  return (
    <div className="wl-keypad" data-testid="jamo-keypad">
      {onToggle && (
        <TouchButton
          variant="secondary"
          className="wl-keypad__close"
          aria-label="Close keypad"
          onPointerDown={pressClose}
        >
          ✕
        </TouchButton>
      )}
      <div className="wl-keypad__row">
        {ROW_1.map(([base, shifted]) => renderKey(base, shifted))}
      </div>
      <div className="wl-keypad__row">
        {ROW_2.map(([base]) => renderKey(base))}
      </div>
      <div className="wl-keypad__row">
        <TouchButton
          variant={shift ? 'primary' : 'secondary'}
          className="wl-keypad__key wl-keypad__shift"
          aria-pressed={shift}
          aria-label="Shift"
          onPointerDown={pressShift}
        >
          ⇧
        </TouchButton>
        {ROW_3.map(([base]) => renderKey(base))}
        <TouchButton
          variant="secondary"
          className="wl-keypad__key wl-keypad__backspace"
          aria-label="Backspace"
          onPointerDown={pressBackspace}
        >
          ⌫
        </TouchButton>
      </div>
      <TouchButton
        variant="primary"
        className="wl-keypad__enter"
        onPointerDown={pressSubmit}
      >
        Enter
      </TouchButton>
    </div>
  );
}
