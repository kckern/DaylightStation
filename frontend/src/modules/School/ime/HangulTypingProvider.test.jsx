import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import HangulTypingProvider, { LanguageDisc, useHangulTyping } from './HangulTypingProvider.jsx';

/** A controlled field, so the test also proves React sees the composed text. */
function Field({ lang = null, off = false, label = 'field' }) {
  const [value, setValue] = useState('');
  const input = (
    <input
      aria-label={label}
      type="text"
      value={value}
      {...(lang ? { 'data-ime-lang': lang } : {})}
      onChange={(e) => setValue(e.target.value)}
    />
  );
  return off ? <div data-ime="off">{input}</div> : input;
}

const type = (el, s) => {
  for (const ch of s) {
    fireEvent.keyDown(el, { code: `Key${ch.toUpperCase()}`, key: ch });
  }
};

const pressF6 = () => fireEvent.keyDown(document.body, { code: 'F6', key: 'F6' });
const badge = () => screen.getByTestId('school-ime-badge');
// The labelled badge is the PROMINENT register: it exists only while a text
// field has focus. Every test that reads it focuses the field first.
const focusField = (label = 'field') => act(() => { screen.getByLabelText(label).focus(); });

beforeEach(() => { document.body.innerHTML = ''; });

describe('HangulTypingProvider', () => {
  it('starts in English and says so', () => {
    render(<HangulTypingProvider><Field /></HangulTypingProvider>);
    focusField();
    expect(badge()).toHaveTextContent('English');
    expect(badge().className).toContain('school-ime-badge--en');
  });

  it('leaves typing alone in English mode', () => {
    render(<HangulTypingProvider><Field /></HangulTypingProvider>);
    const el = screen.getByLabelText('field');
    type(el, 'gks');
    // Nothing composed: the browser would have inserted the letters itself,
    // which fireEvent does not simulate. What matters is that the provider
    // did not write Hangul into the field.
    expect(el.value).toBe('');
  });

  it('composes Hangul after F6', () => {
    render(<HangulTypingProvider><Field /></HangulTypingProvider>);
    act(() => { pressF6(); });
    const el = screen.getByLabelText('field');
    act(() => { el.focus(); });
    expect(badge()).toHaveTextContent('한국어');
    type(el, 'dkssud');
    expect(el.value).toBe('안녕');
  });

  it('F6 toggles back', () => {
    render(<HangulTypingProvider><Field /></HangulTypingProvider>);
    act(() => { pressF6(); });
    act(() => { pressF6(); });
    focusField();
    expect(badge()).toHaveTextContent('English');
    const el = screen.getByLabelText('field');
    type(el, 'gks');
    expect(el.value).toBe('');
  });

  it('adopts a field that declares Korean, with no keypress', () => {
    render(<HangulTypingProvider><Field lang="KR" /></HangulTypingProvider>);
    const el = screen.getByLabelText('field');
    act(() => { el.focus(); });
    expect(badge()).toHaveTextContent('한국어');
    type(el, 'gks');
    expect(el.value).toBe('한');
  });

  it('a field declaring the source language turns Korean back off', () => {
    render(
      <HangulTypingProvider>
        <Field lang="KR" label="korean" />
        <Field lang="EN" label="english" />
      </HangulTypingProvider>,
    );
    const kr = screen.getByLabelText('korean');
    const en = screen.getByLabelText('english');
    act(() => { kr.focus(); });
    expect(badge()).toHaveTextContent('한국어');
    act(() => { en.focus(); });
    expect(badge()).toHaveTextContent('English');
    type(en, 'gks');
    expect(en.value).toBe('');
  });

  it('F6 overrides a declaring field until focus moves again', () => {
    render(<HangulTypingProvider><Field lang="KR" /></HangulTypingProvider>);
    const el = screen.getByLabelText('field');
    act(() => { el.focus(); });
    expect(badge()).toHaveTextContent('한국어');
    act(() => { pressF6(); });
    expect(badge()).toHaveTextContent('English');
  });

  it('never composes into an opted-out subtree', () => {
    render(<HangulTypingProvider><Field off /></HangulTypingProvider>);
    act(() => { pressF6(); });
    const el = screen.getByLabelText('field');
    type(el, 'gks');
    expect(el.value).toBe('');
  });

  it('renders the badge outside the app subtree, so a locked panel still shows it', () => {
    const { container } = render(
      <HangulTypingProvider><div className="school-app"><Field /></div></HangulTypingProvider>,
    );
    focusField();
    expect(container.querySelector('.school-app .school-ime-badge')).toBeNull();
    expect(container.querySelector('.school-ime-badge')).not.toBeNull();
  });

  it('can be switched off entirely, badge and all', () => {
    render(<HangulTypingProvider enabled={false}><Field /></HangulTypingProvider>);
    expect(screen.queryByTestId('school-ime-badge')).toBeNull();
    const el = screen.getByLabelText('field');
    type(el, 'gks');
    expect(el.value).toBe('');
  });
});

/** Reads the register out of context, for the tests below. */
function Register() {
  const { register } = useHangulTyping();
  return <output data-testid="register">{register}</output>;
}

describe('the two registers', () => {
  it('rests in the status register with no badge; a focused text field makes it prominent', () => {
    render(<HangulTypingProvider><Field /><Register /><button type="button">elsewhere</button></HangulTypingProvider>);
    expect(screen.getByTestId('register')).toHaveTextContent('status');
    expect(screen.queryByTestId('school-ime-badge')).toBeNull();
    focusField();
    expect(screen.getByTestId('register')).toHaveTextContent('prominent');
    expect(badge()).toBeInTheDocument();
    // Focus moving to something that is not a text field steps the badge back.
    act(() => { screen.getByRole('button', { name: 'elsewhere' }).focus(); });
    expect(screen.getByTestId('register')).toHaveTextContent('status');
    expect(screen.queryByTestId('school-ime-badge')).toBeNull();
  });

  it('focus leaving a field for nothing at all also steps back', () => {
    render(<HangulTypingProvider><Field /><Register /></HangulTypingProvider>);
    focusField();
    expect(screen.getByTestId('register')).toHaveTextContent('prominent');
    act(() => { screen.getByLabelText('field').blur(); });
    expect(screen.getByTestId('register')).toHaveTextContent('status');
  });

  it('the status disc shows the live mode as an SVG flag, never an emoji', () => {
    const { container } = render(<HangulTypingProvider><LanguageDisc /></HangulTypingProvider>);
    const disc = screen.getByTestId('school-ime-disc');
    expect(disc).toHaveAttribute('aria-label', 'Typing English');
    expect(disc.querySelector('svg')).not.toBeNull();
    expect(container.textContent).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
    act(() => { pressF6(); });
    expect(screen.getByTestId('school-ime-disc')).toHaveAttribute('aria-label', 'Typing 한국어');
    expect(screen.getByTestId('school-ime-disc').className).toContain('school-ime-disc--kr');
  });
});

/**
 * A field that reads the composition inside its own `onChange` — the way a
 * rung does it. It has to be the same component: the composer writes the
 * field and dispatches `input`, and the answer is only current in the handler
 * that write triggered.
 */
function ComposingField({ label = 'field' }) {
  const { compositionState } = useHangulTyping();
  const [value, setValue] = useState('');
  const [state, setState] = useState({ committed: '', pending: '' });
  return (
    <>
      <input
        aria-label={label}
        type="text"
        value={value}
        onChange={(e) => { setValue(e.target.value); setState(compositionState(e.target)); }}
      />
      <output data-testid="composition">{`${state.committed}|${state.pending}`}</output>
    </>
  );
}

describe('the composition seam', () => {
  it('tells a consumer which syllable is still in flight', () => {
    render(<HangulTypingProvider><ComposingField /></HangulTypingProvider>);
    act(() => { pressF6(); });
    const el = screen.getByLabelText('field');
    act(() => { el.focus(); });
    act(() => { type(el, 'dhs'); });
    // 온 on screen, nothing settled: the ㄴ has not chosen a syllable yet, so
    // a rung matching the field against 오늘 must not be told 온 is final.
    expect(el.value).toBe('온');
    expect(screen.getByTestId('composition')).toHaveTextContent('|온');
    act(() => { type(el, 'mf'); });
    expect(el.value).toBe('오늘');
    expect(screen.getByTestId('composition')).toHaveTextContent('오|늘');
  });

  it('reports a field nobody is composing into as settled', () => {
    render(<HangulTypingProvider><ComposingField /></HangulTypingProvider>);
    const el = screen.getByLabelText('field');
    act(() => { fireEvent.change(el, { target: { value: 'plain' } }); });
    expect(screen.getByTestId('composition')).toHaveTextContent('plain|');
  });
});
