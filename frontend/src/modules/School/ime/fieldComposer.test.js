import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FieldComposer, isComposableField, declaredLanguage, optedOut, writeField,
} from './fieldComposer.js';

const key = (code, extra = {}) => ({ code, key: code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...extra });

function field({ type = 'text', value = '', caret = null, tag = 'input' } = {}) {
  const el = document.createElement(tag);
  if (tag === 'input') el.setAttribute('type', type);
  document.body.appendChild(el);
  el.value = value;
  const at = caret ?? value.length;
  // number/date/email inputs throw on setSelectionRange, which is part of why
  // they are not composable in the first place.
  try { el.setSelectionRange(at, at); } catch { /* not selectable */ }
  return el;
}

// Type a QWERTY string into the field through the composer, the way the
// keyboard would. Returns whether every key was consumed.
function typeInto(composer, el, s) {
  let allConsumed = true;
  for (const ch of s) {
    const code = ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`;
    const consumed = composer.handleKey(key(code, { shiftKey: ch !== ch.toLowerCase() && /[a-z]/i.test(ch) }), el);
    if (!consumed) allConsumed = false;
  }
  return allConsumed;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('isComposableField', () => {
  it('accepts free-text inputs and textareas', () => {
    expect(isComposableField(field())).toBe(true);
    expect(isComposableField(field({ type: 'search' }))).toBe(true);
    expect(isComposableField(field({ tag: 'textarea' }))).toBe(true);
  });

  it.each(['number', 'date', 'tel', 'password', 'email', 'url'])('refuses type=%s', (type) => {
    expect(isComposableField(field({ type }))).toBe(false);
  });

  it('refuses disabled and readonly fields', () => {
    const disabled = field(); disabled.disabled = true;
    const readOnly = field(); readOnly.readOnly = true;
    expect(isComposableField(disabled)).toBe(false);
    expect(isComposableField(readOnly)).toBe(false);
  });

  it('refuses anything under an opted-out ancestor', () => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-ime', 'off');
    const el = document.createElement('input');
    wrap.appendChild(el);
    document.body.appendChild(wrap);
    expect(optedOut(el)).toBe(true);
    expect(isComposableField(el)).toBe(false);
  });
});

describe('declaredLanguage', () => {
  it('reads the nearest declaration, so a field overrides its section', () => {
    const outer = document.createElement('div');
    outer.setAttribute('data-ime-lang', 'KR');
    const inner = document.createElement('div');
    inner.setAttribute('data-ime-lang', 'EN');
    const el = document.createElement('input');
    inner.appendChild(el); outer.appendChild(inner); document.body.appendChild(outer);
    expect(declaredLanguage(el)).toBe('EN');
    expect(declaredLanguage(outer.querySelector('input'))).toBe('EN');
  });

  it('is null when nobody declared one', () => {
    expect(declaredLanguage(field())).toBeNull();
  });
});

describe('writeField', () => {
  it('dispatches input so a React onChange fires', () => {
    const el = field();
    const onInput = vi.fn();
    el.addEventListener('input', onInput);
    writeField(el, '한', 1);
    expect(el.value).toBe('한');
    expect(el.selectionStart).toBe(1);
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput.mock.calls[0][0].bubbles).toBe(true);
  });
});

describe('FieldComposer', () => {
  it('composes into an empty field', () => {
    const el = field();
    const c = new FieldComposer();
    expect(typeInto(c, el, 'gks')).toBe(true);
    expect(el.value).toBe('한');
    expect(el.selectionStart).toBe(1);
  });

  it('composes a whole phrase', () => {
    const el = field();
    typeInto(new FieldComposer(), el, 'dkssud');
    expect(el.value).toBe('안녕');
  });

  it('composes at a caret in the middle of existing text', () => {
    const el = field({ value: 'ab', caret: 1 });
    typeInto(new FieldComposer(), el, 'gks');
    expect(el.value).toBe('a한b');
    expect(el.selectionStart).toBe(2);
  });

  it('peels one jamo per backspace inside its own run', () => {
    const el = field();
    const c = new FieldComposer();
    typeInto(c, el, 'dks');
    expect(el.value).toBe('안');
    expect(c.handleKey(key('Backspace', { key: 'Backspace' }), el)).toBe(true);
    expect(el.value).toBe('아');
    expect(c.handleKey(key('Backspace', { key: 'Backspace' }), el)).toBe(true);
    expect(el.value).toBe('ㅇ');
  });

  it('hands Backspace back to the browser once its own run is gone', () => {
    const el = field({ value: 'abc' });
    const c = new FieldComposer();
    expect(c.handleKey(key('Backspace', { key: 'Backspace' }), el)).toBe(false);
    expect(el.value).toBe('abc');
  });

  it('ends the run on a non-jamo key and leaves it to the app', () => {
    const el = field();
    const c = new FieldComposer();
    typeInto(c, el, 'gks');
    expect(c.handleKey(key('Enter', { key: 'Enter' }), el)).toBe(false);
    expect(c.active).toBe(false);
    expect(el.value).toBe('한');
  });

  it('starts a fresh syllable after a space, so a word boundary is a run boundary', () => {
    const el = field();
    const c = new FieldComposer();
    typeInto(c, el, 'gks');
    expect(c.handleKey(key('Space', { key: ' ' }), el)).toBe(false);
    // The browser would insert the space; emulate that, then keep typing.
    el.value = '한 ';
    el.setSelectionRange(2, 2);
    typeInto(c, el, 'rnr');
    expect(el.value).toBe('한 국');
  });

  it('passes modified keys through untouched', () => {
    const el = field();
    const c = new FieldComposer();
    expect(c.handleKey(key('KeyG', { ctrlKey: true }), el)).toBe(false);
    expect(c.handleKey(key('KeyG', { metaKey: true }), el)).toBe(false);
    expect(el.value).toBe('');
  });

  it('never composes into an opted-out field', () => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-ime', 'off');
    const el = document.createElement('input');
    el.setAttribute('type', 'text');
    wrap.appendChild(el); document.body.appendChild(wrap);
    expect(new FieldComposer().handleKey(key('KeyG'), el)).toBe(false);
    expect(el.value).toBe('');
  });

  it('re-anchors when the caret moves out from under it', () => {
    const el = field();
    const c = new FieldComposer();
    typeInto(c, el, 'gks');       // 한, caret at 1
    el.value = 'xx한';            // something else edited the field
    el.setSelectionRange(2, 2);   // and the caret moved
    typeInto(c, el, 'rnr');
    // The stale run is abandoned rather than rewritten: the new syllable lands
    // at the caret and the existing text is untouched.
    expect(el.value).toBe('xx국한');
  });

  it('abandons its run when focus moves to another field', () => {
    const a = field();
    const b = field();
    const c = new FieldComposer();
    typeInto(c, a, 'gks');
    typeInto(c, b, 'rnr');
    expect(a.value).toBe('한');
    expect(b.value).toBe('국');
  });
});

/**
 * The field's `value` cannot tell a reader which glyph the child is still
 * typing, and in 두벌식 that difference is the whole story: a bare consonant
 * lands as the previous syllable's batchim and only migrates out when its
 * vowel arrives. A reveal driven off `value` therefore erases the glyph being
 * typed on the first keystroke of every syllable. These cases pin the seam the
 * automaton already has — settled text vs. the one syllable in flight — so a
 * caller can ask instead of guessing.
 */
describe('FieldComposer.compositionState', () => {
  it('keeps the syllable in flight out of committed text, through 오늘', () => {
    const el = field();
    const c = new FieldComposer();
    const state = () => c.compositionState(el);
    const whole = () => state().committed + state().pending;

    typeInto(c, el, 'd');            // ㅇ
    expect(state()).toEqual({ committed: '', pending: 'ㅇ' });
    expect(whole()).toBe(el.value);

    typeInto(c, el, 'h');            // ㅗ -> 오
    expect(state()).toEqual({ committed: '', pending: '오' });
    expect(whole()).toBe(el.value);

    // THE ROW THAT MOTIVATES ALL OF THIS. The ㄴ attaches as 오's batchim, so
    // the field reads 온 — nothing is settled yet, and a reader that trusted
    // `value` would conclude the learner had un-typed 오.
    typeInto(c, el, 's');            // ㄴ
    expect(el.value).toBe('온');
    expect(state()).toEqual({ committed: '', pending: '온' });
    expect(whole()).toBe(el.value);

    typeInto(c, el, 'm');            // ㅡ — the ㄴ migrates out to start 늘
    expect(state()).toEqual({ committed: '오', pending: '느' });
    expect(whole()).toBe(el.value);

    typeInto(c, el, 'f');            // ㄹ
    expect(state()).toEqual({ committed: '오', pending: '늘' });
    expect(whole()).toBe(el.value);
  });

  it('reports a field it is not driving as entirely committed', () => {
    const el = field({ value: 'already here' });
    const c = new FieldComposer();
    expect(c.compositionState(el)).toEqual({ committed: 'already here', pending: '' });

    // Composing elsewhere does not make this field's text provisional.
    typeInto(c, field(), 'dks');
    expect(c.compositionState(el)).toEqual({ committed: 'already here', pending: '' });
  });

  it('counts text that predates the session as committed', () => {
    // Latin typed before the session, or text the app put there — settled, and
    // it lives before the anchor where the automaton cannot see it.
    const el = field({ value: 'hi ' });
    const c = new FieldComposer();
    typeInto(c, el, 'dhs');
    expect(el.value).toBe('hi 온');
    expect(c.compositionState(el)).toEqual({ committed: 'hi ', pending: '온' });
    typeInto(c, el, 'mf');
    expect(c.compositionState(el)).toEqual({ committed: 'hi 오', pending: '늘' });
  });

  it('reports the text up to the caret when composing before existing text', () => {
    // Composing mid-field, the tail after the caret belongs to neither half —
    // it is the app's text, not this run's. Callers that need it read `value`.
    const el = field({ value: 'ab', caret: 1 });
    const c = new FieldComposer();
    typeInto(c, el, 'gks');
    expect(el.value).toBe('a한b');
    expect(c.compositionState(el)).toEqual({ committed: 'a', pending: '한' });
  });

  it('settles everything once the run ends', () => {
    const el = field();
    const c = new FieldComposer();
    typeInto(c, el, 'dhsmf');
    expect(c.compositionState(el).pending).toBe('늘');
    c.end();
    expect(c.compositionState(el)).toEqual({ committed: '오늘', pending: '' });
  });
});

describe('FieldComposer and a modifier pressed mid-syllable', () => {
  // A real keyboard reports Shift as its own keydown, and for half the syllables
  // a child needs — ㅖ, ㅒ, and the doubled batchim ㄲ/ㅆ — that keydown lands
  // between the initial and the jamo it modifies.
  const shiftDown = () => key('ShiftLeft', { key: 'Shift', shiftKey: true });

  it('keeps the run alive across the Shift keydown', () => {
    const el = field();
    const c = new FieldComposer();
    expect(c.handleKey(key('KeyD'), el)).toBe(true);
    expect(c.handleKey(shiftDown(), el)).toBe(false);
    expect(c.active).toBe(true);
  });

  it('composes 예 from KeyD, Shift, Shift+KeyP', () => {
    const el = field();
    const c = new FieldComposer();
    c.handleKey(key('KeyD'), el);
    c.handleKey(shiftDown(), el);
    expect(c.handleKey(key('KeyP', { shiftKey: true }), el)).toBe(true);
    expect(el.value).toBe('예');
  });

  it('composes 얘 from KeyD, Shift, Shift+KeyO', () => {
    const el = field();
    const c = new FieldComposer();
    c.handleKey(key('KeyD'), el);
    c.handleKey(shiftDown(), el);
    expect(c.handleKey(key('KeyO', { shiftKey: true }), el)).toBe(true);
    expect(el.value).toBe('얘');
  });

  it('composes 있 from KeyD, KeyL, Shift, Shift+KeyT', () => {
    const el = field();
    const c = new FieldComposer();
    c.handleKey(key('KeyD'), el);
    c.handleKey(key('KeyL'), el);
    c.handleKey(shiftDown(), el);
    expect(c.handleKey(key('KeyT', { shiftKey: true }), el)).toBe(true);
    expect(el.value).toBe('있');
  });

  // CapsLock sits one row above left Shift — a fumbled Shift must not break the
  // syllable either.
  it('composes 예 even when CapsLock is fumbled instead of Shift', () => {
    const el = field();
    const c = new FieldComposer();
    c.handleKey(key('KeyD'), el);
    expect(c.handleKey(key('CapsLock'), el)).toBe(false);
    expect(c.active).toBe(true);
    expect(c.handleKey(key('KeyP', { shiftKey: true }), el)).toBe(true);
    expect(el.value).toBe('예');
  });

  it.each([['Ctrl', 'ctrlKey'], ['Alt', 'altKey'], ['Meta', 'metaKey']])('still ends the run on %s shortcuts', (_name, modifier) => {
    const el = field();
    const c = new FieldComposer();
    typeInto(c, el, 'gks');
    expect(c.active).toBe(true);
    expect(c.handleKey(key('KeyC', { [modifier]: true }), el)).toBe(false);
    expect(c.active).toBe(false);
  });
});
