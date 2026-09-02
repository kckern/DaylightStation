// frontend/src/lib/ui/cards.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionCard, StatCard } from './cards.jsx';

describe('cards', () => {
  it('SectionCard renders title, actions, children', () => {
    render(
      <SectionCard title="Weight" actions={<button>edit</button>}>
        <span>body</span>
      </SectionCard>
    );
    expect(screen.getByText('Weight')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'edit' })).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('StatCard renders label, value, unit and emphasis class', () => {
    const { container } = render(
      <StatCard label="Remaining" value={1140} unit="kcal" emphasis />
    );
    expect(screen.getByText('Remaining')).toBeTruthy();
    expect(screen.getByText('1140')).toBeTruthy();
    expect(screen.getByText('kcal')).toBeTruthy();
    expect(container.querySelector('.ds-stat--emphasis')).toBeTruthy();
  });
});
