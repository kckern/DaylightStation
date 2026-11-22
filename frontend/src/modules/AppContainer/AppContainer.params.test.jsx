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
