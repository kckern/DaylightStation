import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { LifePage, EmptyState, LoadingState, ErrorState, SectionCard } from './index.js';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

describe('Life primitives', () => {
  it('LifePage renders a title and actions', () => {
    wrap(<LifePage title="Goals" actions={<button>Add</button>}>body</LifePage>);
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
  // EmptyState/LoadingState/SectionCard are straight re-exports of the DS
  // components now (see index.js) — their own contracts are covered by
  // frontend/src/lib/ui/states.test.jsx and cards.test.jsx. Here we just pin
  // that Life's call-site prop shape (title/hint/action) still renders.
  it('EmptyState shows title, hint, and an action', () => {
    wrap(<EmptyState title="No goals yet" hint="Add one to get started." action={{ label: 'Add goal', onClick: () => {} }} />);
    expect(screen.getByText('No goals yet')).toBeInTheDocument();
    expect(screen.getByText('Add one to get started.')).toBeInTheDocument();
    expect(screen.getByText('Add goal')).toBeInTheDocument();
  });
  it('LoadingState is busy while loading', () => {
    const { container } = wrap(<LoadingState label="plan" />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading plan')).toBeInTheDocument();
  });
  it('ErrorState normalizes a string error into the DS message field and retries', () => {
    let retried = false;
    wrap(<ErrorState error="HTTP 500" onRetry={() => { retried = true; }} />);
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
    screen.getByText(/retry/i).click();
    expect(retried).toBe(true);
  });
  it('SectionCard renders a heading', () => {
    wrap(<SectionCard title="Priorities">inner</SectionCard>);
    expect(screen.getByText('Priorities')).toBeInTheDocument();
    expect(screen.getByText('inner')).toBeInTheDocument();
  });
});
