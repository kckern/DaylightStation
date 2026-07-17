import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { IconSeeding } from '@tabler/icons-react';
import { LifePage, EmptyState, LoadingState, ErrorState, SectionCard } from './index.js';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

describe('Life primitives', () => {
  it('LifePage renders a title and actions', () => {
    wrap(<LifePage title="Goals" actions={<button>Add</button>}>body</LifePage>);
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
  it('EmptyState shows message and CTA', () => {
    wrap(<EmptyState icon={IconSeeding} message="No goals yet" cta={<button>Add goal</button>} />);
    expect(screen.getByText('No goals yet')).toBeInTheDocument();
    expect(screen.getByText('Add goal')).toBeInTheDocument();
  });
  it('LoadingState shows an optional label', () => {
    wrap(<LoadingState label="Loading plan" />);
    expect(screen.getByText('Loading plan')).toBeInTheDocument();
  });
  it('ErrorState renders the message and a retry when given', () => {
    let retried = false;
    wrap(<ErrorState error="HTTP 500" onRetry={() => { retried = true; }} />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    screen.getByText(/try again/i).click();
    expect(retried).toBe(true);
  });
  it('SectionCard renders a heading', () => {
    wrap(<SectionCard title="Priorities">inner</SectionCard>);
    expect(screen.getByText('Priorities')).toBeInTheDocument();
    expect(screen.getByText('inner')).toBeInTheDocument();
  });
});
