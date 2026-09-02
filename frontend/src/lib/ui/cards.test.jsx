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

  it('SectionCard with neither title nor actions renders NO header element', () => {
    const { container } = render(
      <SectionCard>
        <span>body content</span>
      </SectionCard>
    );
    expect(container.querySelector('.ds-card__header')).toBeNull();
    expect(screen.getByText('body content')).toBeTruthy();
  });

  it('SectionCard with title only renders header with title and no actions', () => {
    const { container } = render(
      <SectionCard title="Metrics">
        <span>body</span>
      </SectionCard>
    );
    expect(screen.getByText('Metrics')).toBeTruthy();
    expect(container.querySelector('.ds-card__header')).toBeTruthy();
    expect(container.querySelector('.ds-card__actions')).toBeNull();
  });

  it('StatCard with only label and value renders minimal content', () => {
    const { container } = render(
      <StatCard label="Steps" value={8423} />
    );
    expect(screen.getByText('Steps')).toBeTruthy();
    expect(screen.getByText('8423')).toBeTruthy();
    expect(container.querySelector('.ds-stat__unit')).toBeNull();
    expect(container.querySelector('.ds-stat__trend')).toBeNull();
    expect(container.querySelector('.ds-stat__spark')).toBeNull();
    expect(container.querySelector('.ds-stat--emphasis')).toBeNull();
  });
});
