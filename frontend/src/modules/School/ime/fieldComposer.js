/**
 * Maps the Hangul automaton onto a real `<input>` / `<textarea>`.
 *
 * Kept apart from React on purpose: this is where every awkward DOM fact
 * lives (the native value setter, selection restoration, session anchoring),
 * and it is testable without rendering anything.
 *
 * A SESSION is one run of jamo keys anchored at a caret offset. It owns the
 * slice of the field's value that the automaton produced, and rewrites that
 * slice on every keystroke. Anything that is not a jamo — space, punctuation,
 * Enter, an arrow key, a click elsewhere — ends the session and is handled by
 * the browser and the app exactly as before. A word boundary is therefore also
 * a session boundary, which keeps the owned slice short and makes the field's
 * own text authoritative between words.
 */
import { Hangul } from './hangul.js';

const TEXT_INPUT_TYPES = new Set(['text', 'search', '']);

/**
 * Whether this element takes free text we may compose into. Deliberately
 * narrow: a number, date, tel, or password field is never composable, and
 * neither is anything that opted out.
 */
export function isComposableField(el) {
  if (!el || el.disabled || el.readOnly) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return !optedOut(el);
  if (tag !== 'INPUT') return false;
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (!TEXT_INPUT_TYPES.has(type)) return false;
  return !optedOut(el);
}

/**
 * Opt-out is declared, never inferred. `data-ime="off"` on the field or on any
 * ancestor — so a whole subtree (the teacher workspace, a keypad) is marked
 * once rather than field by field.
 */
export function optedOut(el) {
  return typeof el?.closest === 'function' && el.closest('[data-ime="off"]') !== null;
}

/**
 * A field may name the language it wants. Nearest declaration wins, so a rung
 * can override the section around it.
 */
export function declaredLanguage(el) {
  if (typeof el?.closest !== 'function') return null;
  const host = el.closest('[data-ime-lang]');
  return host ? (host.getAttribute('data-ime-lang') || null) : null;
}

/**
 * Write into a controlled input so React notices.
 *
 * Assigning `.value` is not enough: React holds the node's previous value on a
 * tracker and skips the change event when the property is set directly. Going
 * through the prototype's own setter updates the tracker, and the dispatched
 * `input` event is what React's synthetic `onChange` listens for.
 */
export function writeField(el, value, caret) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
  try { el.setSelectionRange(caret, caret); } catch { /* not all inputs allow it */ }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  // React may re-render between the dispatch and here; the caret is restored
  // again so it survives that pass.
  try { el.setSelectionRange(caret, caret); } catch { /* see above */ }
}

export class FieldComposer {
  #el = null;
  #hangul = null;
  #anchor = 0;

  /** Whether a run of jamo is currently in flight. */
  get active() { return this.#el !== null; }

  /** Drop the session without touching the field — its text is already there. */
  end() {
    this.#el = null;
    this.#hangul = null;
    this.#anchor = 0;
  }

  /**
   * Offer one keydown. Returns true if it was consumed (the caller should
   * preventDefault) and false if the browser and the app should handle it.
   */
  handleKey(event, el) {
    if (event.ctrlKey || event.altKey || event.metaKey) { this.end(); return false; }
    if (!isComposableField(el)) { this.end(); return false; }

    if (event.key === 'Backspace') return this.#backspace(el);

    const jamo = Hangul.jamoFor(event.code, event.shiftKey);
    if (!jamo) { this.end(); return false; }

    this.#ensureSession(el);
    const before = this.#hangul.text;
    this.#hangul.jamo(jamo);
    this.#apply(el, before, this.#hangul.text);
    return true;
  }

  /**
   * Split what the field holds into text that has settled and the one syllable
   * still in flight.
   *
   * The field's own `value` cannot answer this, and in 두벌식 the difference
   * decides what a reader may trust. A consonant is genuinely ambiguous until
   * its vowel arrives: typing 오늘, the ㄴ lands as 오's batchim (the field
   * reads 온) and only migrates out to start 늘 on the next key. Anything
   * matching `value` against a target therefore loses the glyph the child is
   * in the middle of typing, on the first keystroke of every syllable — which
   * is exactly the glyph they most need on screen.
   *
   * `#hangul.committed` is only what THIS session settled; whatever was in the
   * field before the anchor — Latin, a previous run, text the app put there —
   * is settled too, and is included. With no live session everything is
   * settled: Latin typing and fields this composer is not driving are done
   * being ambiguous.
   *
   * `committed + pending` is the field up to the caret. Composing before
   * existing text, the tail after the caret belongs to neither half; a caller
   * that needs the whole field reads `value`.
   */
  compositionState(el) {
    if (!this.#continuous(el)) return { committed: el?.value ?? '', pending: '' };
    return {
      committed: el.value.slice(0, this.#anchor) + this.#hangul.committed,
      pending: this.#hangul.pending,
    };
  }

  #backspace(el) {
    // Only a live session's own text is ours to peel. Outside one, Backspace is
    // an ordinary delete and must stay that way.
    if (!this.#continuous(el) || !this.#hangul?.text) { this.end(); return false; }
    const before = this.#hangul.text;
    this.#hangul.backspace();
    this.#apply(el, before, this.#hangul.text);
    if (!this.#hangul.text) this.end();
    return true;
  }

  #ensureSession(el) {
    if (this.#continuous(el)) return;
    this.end();
    this.#el = el;
    this.#hangul = new Hangul();
    this.#anchor = el.selectionStart ?? el.value.length;
  }

  /**
   * Is the session still anchored to reality? A click, an arrow key, or an edit
   * from elsewhere moves the caret or rewrites the text under us, and composing
   * onto a stale anchor would corrupt the field. Both facts are checked because
   * either alone can be coincidentally right.
   */
  #continuous(el) {
    if (this.#el !== el || !this.#hangul) return false;
    const owned = this.#hangul.text;
    if (el.selectionStart !== el.selectionEnd) return false;
    if (el.selectionStart !== this.#anchor + owned.length) return false;
    return el.value.slice(this.#anchor, this.#anchor + owned.length) === owned;
  }

  #apply(el, before, after) {
    const head = el.value.slice(0, this.#anchor);
    const tail = el.value.slice(this.#anchor + before.length);
    writeField(el, head + after + tail, this.#anchor + after.length);
  }
}
