import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../../../__app_modules/household/supervision/browser/index.js', () => ({ SupervisedActivity: ({ children }) => children }));
import { appOpenForPlayable } from './PlayableAppShell.jsx';
import { appPropsFromOpen } from '../../../../../frontend/src/modules/AppContainer/AppContainer.jsx';

describe('appOpenForPlayable', () => {
  it('opens {app, params} when the queue item carries params', () => {
    expect(appOpenForPlayable('app:party-games/charades:fhe', { autostart: true }))
      .toEqual({ app: 'party-games/charades:fhe', params: { autostart: true } });
  });

  it('opens the plain id when the queue item has no params', () => {
    expect(appOpenForPlayable('app:wrapup', undefined)).toBe('wrapup');
  });

  it('ignores params that are not an object', () => {
    expect(appOpenForPlayable('app:wrapup', 'autostart')).toBe('wrapup');
  });

  it('gives the app the same props a menu selection would', () => {
    const entry = { param: { name: 'definitionId' } };
    expect(appPropsFromOpen(entry, appOpenForPlayable('app:party-games/charades:fhe', { autostart: true })))
      .toEqual({ definitionId: 'charades:fhe', params: { autostart: true } });
  });
});
