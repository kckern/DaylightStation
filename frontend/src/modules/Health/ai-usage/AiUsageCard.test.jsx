import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { AiUsageCard, featureCost } from './AiUsageCard.jsx';
import { aiUsagePath } from './useHealthAiUsage.js';
import { featureLabel } from './aiUsageFormat.js';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
beforeEach(() => { resetApiResourceCache(); api.mockReset(); });

const days = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 7, 27 + i)).toISOString().slice(0, 10);
  return i === 29 ? { date: d, total: 0.05, byFeature: { 'photo-log': 0.04, 'text-log': 0.01 } } : { date: d, total: 0, byFeature: {} };
});
const usage = {
  range: { from: days[0].date, to: days[29].date, days: 30 },
  today: 0.05, week: 0.31, month: 1.2,
  byFeature: [
    { feature: 'auditor', calls: 12, costUsd: 0.6, avgUsd: 0.05, unpriced: 0 },
    { feature: 'photo-log', calls: 20, costUsd: 0.4, avgUsd: 0.02, unpriced: 0 },
    { feature: 'text-log', calls: 30, costUsd: 0.15, avgUsd: 0.005, unpriced: 0 },
    { feature: 'voice-log', calls: 4, costUsd: 0, avgUsd: null, unpriced: 4 },
  ],
  days,
  beforeTracking: { costUsd: 3.21, calls: 140 },
};
const mount = (ui, path = '/health/settings') => render(<MantineProvider><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></MantineProvider>);

describe('Health AI usage card', () => {
  it('shows the totals, every feature in plain words, and the untracked note', async () => {
    api.mockImplementation(async path => { expect(path).toBe(aiUsagePath); return usage; });
    mount(<AiUsageCard />, '/health/auditor');
    await screen.findByText('Photo logging');
    for (const [label, value] of [['Today', '$0.05'], ['7 days', '$0.31'], ['This month', '$1.20']]) {
      expect(within(screen.getByText(label).closest('.ds-stat')).getByText(value)).toBeTruthy();
    }
    const table = screen.getByRole('table', { name: 'Health AI cost by feature' });
    expect(within(table).getByText('Nutrition auditor')).toBeTruthy();
    expect(within(table).getByText('Voice logging')).toBeTruthy();
    // a feature with calls but no priced call: cost unknown, not $0
    const voiceRow = within(table).getByText('Voice logging').closest('tr');
    expect(within(voiceRow).getAllByText('cost unknown')).toHaveLength(2);
    expect(screen.getByText(/Before tracking: \$3\.21 across all apps \(140 calls, not attributable/)).toBeTruthy();
    expect(screen.getByText('Last 30 days: $0.05 over 66 calls.')).toBeTruthy();
  });

  it('reads a day on the chart with its features by cost', async () => {
    api.mockResolvedValue(usage);
    mount(<AiUsageCard />, '/health/auditor');
    const chart = await screen.findByRole('img', { name: /Daily Health AI cost/ });
    fireEvent.focus(chart);
    expect(screen.getByRole('status').textContent).toMatch(/: \$0\.05 · Photo logging \$0\.04, Text logging \$0\.01$/);
  });

  it('links the auditor row to its page from Settings, not from the auditor page itself', async () => {
    api.mockResolvedValue(usage);
    const { unmount } = mount(<AiUsageCard />, '/health/auditor');
    await screen.findByText('Nutrition auditor');
    expect(screen.getByText('Nutrition auditor').closest('a')).toBeNull();
    unmount();
    resetApiResourceCache();
    mount(<AiUsageCard compact />);
    const link = (await screen.findByText('Nutrition auditor')).closest('a');
    expect(link.getAttribute('href')).toBe('/health/auditor');
  });

  it('compact: totals, the top three features and See all', async () => {
    api.mockResolvedValue(usage);
    mount(<AiUsageCard compact />);
    await screen.findByText('Photo logging');
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(4); // header + 3
    expect(screen.queryByText('Voice logging')).toBeNull();
    expect(screen.queryByRole('img', { name: /Daily Health AI cost/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'See all' }).getAttribute('href')).toBe('/health/auditor#ai-usage');
  });

  it('says so when Health used no AI, and still shows untracked spend', async () => {
    api.mockResolvedValue({ ...usage, byFeature: [], days: days.map(d => ({ ...d, total: 0, byFeature: {} })) });
    mount(<AiUsageCard />);
    await screen.findByText('No Health AI use in the last 30 days');
    expect(screen.getByText(/Before tracking/)).toBeTruthy();
  });

  it('offers a retry when the read fails', async () => {
    api.mockRejectedValue(new Error('boom'));
    mount(<AiUsageCard />);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('labels every feature tag, falling back to the tag', () => {
    expect(featureLabel('unspecified')).toBe('Other');
    expect(featureLabel('auditor-triage')).toBe('Auditor triage');
    expect(featureLabel('new-thing')).toBe('new-thing');
    expect(featureCost({ calls: 2, unpriced: 2, costUsd: 0 })).toBe('cost unknown');
    expect(featureCost({ calls: 2, unpriced: 1, costUsd: 0.01 })).toBe('$0.01');
  });
});
