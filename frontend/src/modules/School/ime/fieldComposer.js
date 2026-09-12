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
import { isTraceableTarget, isViablePrefix } from './syllable.js';

const TEXT_INPUT_TYPES = new Set(['text', 'search', '']);

/**
 * Key codes that get PRESSED during a syllable without producing one — not keys
 * that produce no jamo, which would be most of the keyboard. They must pass
 * through without ending the session.
 *
 * Treating them as ordinary non-jamo keys cost us every syllable needing Shift
 * after an initial had landed — ㅖ, ㅒ, and ㄲ/ㅆ as batchim — so 예 came out
 * ㅇㅖ. None of these keys moves the caret or rewrites text, so `#continuous()`
 * still holds across them and the session stays anchored where it was.
 *
 * CapsLock earns its place by position, not by meaning: it sits one row above
 * left Shift, we are asking a child to hunt for Shift repeatedly mid-word on a
 * Bluetooth keyboard, and `Hangul.jamoFor` reads only `event.shiftKey` — so a
 * stray press changes nothing a child can see except that the syllable breaks.
 *
 * Matched on `code`, not `key`, because `key` depends on whatever layout
 * Android believes is attached.
 */
const PASSTHROUGH_CODES = new Set(['ShiftLeft', 'ShiftRight', 'CapsLock']);

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
   *
   * `oracle` is OPTIONAL and is the whole of copy mode. Absent — which is the
   * default, and is what listen mode and every other School field pass — this
   * behaves exactly as it did before copy mode existed: the plain automaton,
   * every key lands, nothing is corrected. It is a parameter rather than
   * state on this class so that "no oracle" is not a mode anything can fall
   * into by forgetting to clear it.
   *
   * It comes from React context via the provider, deliberately not from a
   * `data-` attribute: the target syllable is not a string to leave in the DOM
   * where a child can read the answer out of devtools. On a copy-mode screen
   * the sentence is on display anyway, but listen mode will use the same seam
   * and there it matters.
   *
   *   { currentTarget(): string|null, onRefused?(jamo): void }
   *
   * `currentTarget` names the ONE syllable being traced right now, or null for
   * "no opinion" — past the end of the sentence, between words, anywhere the
   * caller cannot say. Null switches both halves off for that keystroke.
   *
   * @param {{ currentTarget: () => (string|null), onRefused?: (jamo: string) => void }} [oracle]
   */
  handleKey(event, el, oracle) {
    if (event.ctrlKey || event.altKey || event.metaKey) { this.end(); return false; }
    if (!isComposableField(el)) { this.end(); return false; }

    // A modifier's own keydown is not a key the child typed — it is the keyboard
    // announcing itself mid-syllable, and ending the session on it breaks the
    // syllable in flight. Below the branch above on purpose, so a real shortcut
    // still wins. See PASSTHROUGH_CODES for what belongs there and why.
    if (PASSTHROUGH_CODES.has(event.code)) return false;

    if (event.key === 'Backspace') return this.#backspace(el);

    const jamo = Hangul.jamoFor(event.code, event.shiftKey);
    if (!jamo) { this.end(); return false; }

    // Before the gate, because judging the key needs the automaton this run is
    // holding. Starting a session writes nothing to the field and moves no
    // caret, so a key refused immediately after still leaves the field exactly
    // as the child left it.
    this.#ensureSession(el);
    const target = oracle ? (oracle.currentTarget?.() ?? null) : null;

    // THE GATE. Offered before the automaton mutates, so a refused key changes
    // nothing at all. Returning true (consumed) without applying is what makes
    // the key "not land": the learner sees nothing move, and `onRefused` gives
    // the UI something to show so a refused key does not feel like a dead
    // keyboard.
    if (target !== null && this.#refuses(jamo, target)) {
      oracle.onRefused?.(jamo);
      return true;
    }

    const before = this.#hangul.text;
    this.#hangul.jamo(jamo);

    // AUTO-LOCK. In copy mode we know the target, so the instant the syllable
    // in flight IS the target it is settled — there is nothing left to type
    // into it. 오 locks the moment ㅗ lands, so a following ㄴ has no syllable
    // to attach to and starts 늘 directly.
    //
    // This is why the 온 transient never happens here. In the plain automaton
    // the ㄴ of 오늘 lands as 오's batchim and the field reads 온 until the next
    // key, which is what collapsed the prompt: the ambiguity is not papered
    // over, it ceases to exist. Copy mode is the only place we may do this —
    // see the warning at the top of syllable.js.
    if (target !== null && this.#hangul.pending === target) this.#hangul.flush();

    this.#apply(el, before, this.#hangul.text);
    return true;
  }

  /**
   * Would this jamo stop the syllable in flight being a viable prefix of
   * `target`?
   *
   * Asked of a COPY of the automaton, so the 두벌식 rules that decide what a
   * key does — a final joining, a final stealing forward, a syllable flushing —
   * are answered by the automaton itself rather than re-derived here, where the
   * second copy would drift from the first.
   */
  #refuses(jamo, target) {
    // Fail open on anything the oracle cannot reason about. A gate that
    // refuses what it does not understand is a dead keyboard with no
    // explanation, which is worse for a child than no gate at all.
    if (!isTraceableTarget(target)) return false;

    const probe = this.#hangul.clone();
    probe.jamo(jamo);

    // A key that SETTLES text has abandoned the syllable rather than built it.
    // Under auto-lock the only legitimate commit is the one performed above the
    // instant `pending` reaches the target, so a commit the automaton makes on
    // its own means this key was not the next stroke of the shape being traced:
    // a second consonant pushing the first out (ㅇ then ㄱ), a vowel with no
    // initial standing alone as a bare jamo (ㅗ typed before its ㅇ), a vowel
    // that will not join the one already there. None of those show up in the
    // `{ cho, jung, jong }` comparison below, because by then the wrong jamo
    // has already moved into committed text where that comparison cannot see
    // it — the state left in flight looks like an innocent fresh start.
    if (probe.committed !== this.#hangul.committed) return true;

    return !isViablePrefix(probe, target);
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
