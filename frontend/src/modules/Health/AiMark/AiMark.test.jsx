import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AiMark } from './index.jsx';

describe('AiMark', () => {
  it('renders at default size 24', () => {
    const { container } = render(<AiMark />);
    const el = container.querySelector('.ai-mark');
    expect(el).toBeTruthy();
    expect(el.style.width).toBe('24px');
    expect(el.style.height).toBe('24px');
  });

  it('renders at custom size', () => {
    const { container } = render(<AiMark size={16} />);
    const el = container.querySelector('.ai-mark');
    expect(el.style.width).toBe('16px');
    expect(el.style.height).toBe('16px');
  });

  it('contains the ✦ glyph', () => {
    const { container } = render(<AiMark />);
    expect(container.textContent).toContain('✦');
  });
});
