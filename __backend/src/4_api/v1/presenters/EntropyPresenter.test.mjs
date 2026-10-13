import { describe, expect, it } from 'vitest';
import { presentEntropyItem, presentEntropyReport } from './EntropyPresenter.mjs';

describe('EntropyPresenter', () => {
  const entity = {
    source: 'fitness', name: 'Fitness', icon: 'shoe', metricType: 'days_since',
    status: 'green', value: 0, label: 'Today', lastUpdate: '2026-08-28', url: '/fitness', weight: 4,
  };
  it('preserves the established item envelope without leaking metricType', () => {
    expect(presentEntropyItem(entity)).toEqual({
      id: 'fitness', source: 'fitness', name: 'Fitness', icon: 'shoe', status: 'green',
      value: 0, label: 'Today', lastUpdate: '2026-08-28', url: '/fitness', weight: 4,
    });
  });
  it('projects report items without changing report values', () => {
    expect(presentEntropyReport({ items: [entity], summary: { red: 0 } })).toEqual({
      items: [expect.objectContaining({ id: 'fitness' })], summary: { red: 0 },
    });
  });
});
