import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LearnCard from "./LearnCard.jsx";

describe('LearnCard', () => {
  it('shows the reference, translation, text, and note', () => {
    render(<LearnCard learn={{ ref: 'Lamentations 3:23', translation: 'NIrV', text: 'His great love is new every morning.', note: 'Every day is a fresh start.' }} />);
    expect(screen.getByText('Lamentations 3:23')).not.toBeNull();
    expect(screen.getByText('NIrV')).not.toBeNull();
    expect(screen.getByText('His great love is new every morning.').className).toContain('gp-learn__text--lg');
    expect(screen.getByText('Every day is a fresh start.')).not.toBeNull();
  });

  it('long passages step down a type size', () => {
    const text = 'x'.repeat(240);
    render(<LearnCard learn={{ text }} />);
    expect(screen.getByText(text).className).toContain('gp-learn__text--sm');
  });

  it('renders nothing without text', () => {
    const { container } = render(<LearnCard learn={null} />);
    expect(container.innerHTML).toBe('');
  });
});
