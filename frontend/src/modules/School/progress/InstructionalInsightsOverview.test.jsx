import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import InstructionalInsightsOverview from './InstructionalInsightsOverview.jsx';

const item = (id, signal = 'review_instruction', extra = {}) => ({
  target: { id }, signal, accuracyPercent: 0, responseCount: 3, affectedLearnerCount: 1,
  lastActivityAt: '2026-07-22T00:00:00Z',
  suggestedAction: {
    recommendation: {
      basis: { kind: 'evidence_aggregate', correctCount: 0, responseCount: 3, evidenceCount: 3, learnerCount: 1 },
      policy: { version: 'school.instructional-review/v1', expiresAt: '2026-08-31T00:00:00Z' },
    },
  },
  ...extra,
});

const renderInsights = (items) => render(<InstructionalInsightsOverview insights={{ items, concepts: [], pacing: [] }} />);

// The inspector (with the basis copy) renders for the first item automatically.
describe('InstructionalInsightsOverview copy', () => {
  it('pluralizes learner and record counts honestly', () => {
    renderInsights([item('q2')]);
    expect(screen.getByText(/0\/3 correct across 3 records and 1 learner\./)).toBeTruthy();
    expect(screen.queryByText(/1 learners/)).toBeNull();
  });

  it('never prints the internal policy id', () => {
    renderInsights([item('q2')]);
    expect(screen.queryByText(/school\.instructional-review/)).toBeNull();
    expect(screen.getByText(/Suggested automatically from answer history/)).toBeTruthy();
  });

  it('renders q-ids as Question N and leaves slug ids prettified', () => {
    renderInsights([item('q2'), item('illinois-labor-unions', 'limited_evidence')]);
    expect(screen.getAllByText('Question 2').length).toBeGreaterThan(0);
    expect(screen.getByText('Illinois Labor Unions')).toBeTruthy();
  });
});
