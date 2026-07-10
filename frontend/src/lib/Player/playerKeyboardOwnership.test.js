import { describe, it, expect, beforeEach } from 'vitest';
import {
  acquirePlayerKeyboard,
  isPlayerKeyboardActive,
  __resetPlayerKeyboardOwnership,
} from './playerKeyboardOwnership.js';

describe('playerKeyboardOwnership', () => {
  beforeEach(() => __resetPlayerKeyboardOwnership());

  it('is inactive by default', () => {
    expect(isPlayerKeyboardActive()).toBe(false);
  });

  it('acquire makes it active, release makes it inactive', () => {
    const release = acquirePlayerKeyboard();
    expect(isPlayerKeyboardActive()).toBe(true);
    release();
    expect(isPlayerKeyboardActive()).toBe(false);
  });

  it('is ref-counted: two acquires need two releases', () => {
    const r1 = acquirePlayerKeyboard();
    const r2 = acquirePlayerKeyboard();
    expect(isPlayerKeyboardActive()).toBe(true);
    r1();
    expect(isPlayerKeyboardActive()).toBe(true); // still one holder
    r2();
    expect(isPlayerKeyboardActive()).toBe(false);
  });

  it('double-release is idempotent (never drives the count negative)', () => {
    const r1 = acquirePlayerKeyboard();
    const r2 = acquirePlayerKeyboard();
    r1();
    r1(); // second call must be a no-op
    expect(isPlayerKeyboardActive()).toBe(true); // r2 still holds
    r2();
    expect(isPlayerKeyboardActive()).toBe(false);
  });
});
