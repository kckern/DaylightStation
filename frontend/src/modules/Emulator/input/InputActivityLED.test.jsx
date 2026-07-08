import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { InputActivityLED } from './InputActivityLED.jsx';

describe('InputActivityLED', () => {
  it('marks both dots inactive by default', () => {
    const { container } = render(<InputActivityLED />);
    const root = container.querySelector('.emulator-input-led');
    expect(root.getAttribute('data-browser')).toBe('off');
    expect(root.getAttribute('data-emulator')).toBe('off');
    expect(container.querySelectorAll('.is-active')).toHaveLength(0);
  });

  it('lights only the browser dot when input reaches the page but not the core', () => {
    const { container } = render(<InputActivityLED browserActive emulatorActive={false} />);
    expect(container.querySelector('.is-browser').classList.contains('is-active')).toBe(true);
    expect(container.querySelector('.is-emulator').classList.contains('is-active')).toBe(false);
  });

  it('lights both dots when the pad is driving the game', () => {
    const { container } = render(<InputActivityLED browserActive emulatorActive />);
    expect(container.querySelectorAll('.is-active')).toHaveLength(2);
  });
});
