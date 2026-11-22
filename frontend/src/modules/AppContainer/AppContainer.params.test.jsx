import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../../__app_modules/household/supervision/browser/index.js', () => ({ SupervisedActivity: ({ children }) => children }));
import { appPropsFromOpen } from './AppContainer.jsx';

describe('appPropsFromOpen', () => {
  it('passes item params as a params prop', () => {
    const entry = { param: { name: 'definitionId' } };
    expect(appPropsFromOpen(entry, { app: 'party-games/charades:fhe', params: { autostart: true } }))
      .toEqual({ definitionId: 'charades:fhe', params: { autostart: true } });
  });
  it('omits params when the item has none', () => {
    expect(appPropsFromOpen({ param: null }, 'weekly-review')).toEqual({});
  });
});

describe('appPropsFromOpen params checks', () => {
  const entry = { param: { name: 'definitionId' } };
  it('drops params that are not an object', () => {
    expect(appPropsFromOpen(entry, { app: 'party-games/charades:fhe', params: 'autostart' }))
      .toEqual({ definitionId: 'charades:fhe' });
    expect(appPropsFromOpen(entry, { app: 'party-games/charades:fhe', params: true }))
      .toEqual({ definitionId: 'charades:fhe' });
    expect(appPropsFromOpen(entry, { app: 'party-games/charades:fhe', params: ['a'] }))
      .toEqual({ definitionId: 'charades:fhe' });
  });
  it('gives no params for a string open', () => {
    expect(appPropsFromOpen(entry, 'party-games/charades:fhe')).toEqual({ definitionId: 'charades:fhe' });
  });
});
