import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import HangulTypingProvider from './HangulTypingProvider.jsx';

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

beforeEach(() => { document.body.innerHTML = ''; });

describe('HangulTypingProvider', () => {
  it('starts in English and says so', () => {
    render(<HangulTypingProvider><Field /></HangulTypingProvider>);
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
    expect(badge()).toHaveTextContent('한국어');
    const el = screen.getByLabelText('field');
    el.focus();
    type(el, 'dkssud');
    expect(el.value).toBe('안녕');
  });

  it('F6 toggles back', () => {
    render(<HangulTypingProvider><Field /></HangulTypingProvider>);
    act(() => { pressF6(); });
    act(() => { pressF6(); });
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
