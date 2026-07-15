import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RevealPanel from './RevealPanel.jsx';

describe('RevealPanel type buckets', () => {
  it('short prompts get the large bucket', () => {
    render(<RevealPanel prompt="Short clue" />);
    expect(screen.getByText('Short clue').className).toContain('gs-reveal__prompt--lg');
  });

  it('mid-length prompts step down to medium', () => {
    const prompt = 'x'.repeat(150);
    render(<RevealPanel prompt={prompt} />);
    expect(screen.getByText(prompt).className).toContain('gs-reveal__prompt--md');
  });

  it('long prompts get the small bucket', () => {
    const prompt = 'x'.repeat(240);
    render(<RevealPanel prompt={prompt} />);
    expect(screen.getByText(prompt).className).toContain('gs-reveal__prompt--sm');
  });

  it('answer renders only when revealed', () => {
    const { rerender } = render(<RevealPanel prompt="Q" answer="A" />);
    expect(screen.queryByText('A')).toBeNull();
    rerender(<RevealPanel prompt="Q" revealed answer="A" />);
    expect(screen.getByText('A')).not.toBeNull();
  });
});
