import { describe, expect, it } from 'vitest';
import { MAX_ANNOTATION_LOCATOR_LENGTH } from '../../../shared/annotationLocator.mjs';
import { FeedStateService } from './FeedStateService.mjs';

describe('FeedStateService annotation locator persistence', () => {
  it('preserves a valid near-limit locator through annotation creation', async () => {
    const quote = 'q'.repeat(860);
    const locator = JSON.stringify({ type: 'TextQuoteSelector', exact: quote, prefix: 'p'.repeat(32), suffix: 's'.repeat(32), offset: 42 });
    expect(locator.length).toBeLessThanOrEqual(MAX_ANNOTATION_LOCATOR_LENGTH);

    const data = { annotations: {} };
    const service = new FeedStateService({
      store: {
        load: () => data,
        update: async (_username, change) => { change(data); return data; },
      },
      historyStore: { findById: () => ({ id: 'item-1', stateKey: 'state-1' }) },
      clock: { now: () => 0 },
      createId: () => 'annotation-1',
      scheduler: { after: () => {} },
    });

    const saved = await service.createAnnotation('reader', { itemId: 'item-1', quote, locator });

    expect(saved.locator).toBe(locator);
    expect(JSON.parse(saved.locator).exact).toBe(quote);
  });
});
