import { describe, it, expect } from 'vitest';
import { ScreensQueryService } from './ScreensQueryService.mjs';
import { builtInScreen } from './builtInScreens.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const repo = (screens) => ({
  listScreenDocuments: async () => ({ entries: [], unreadable: 0, directoryMissing: false }),
  findScreenById: async (id) => (id in screens ? screens[id] : null),
});

describe('built-in screens', () => {
  it('serves adhoc when the household has no file of that name', async () => {
    const result = await new ScreensQueryService({ screensRepository: repo({}), logger }).getScreen('adhoc');
    expect(result.outcome).toBe('found');
    expect(result.screen.screen).toBe('adhoc');
    expect(result.screen.websocket).toEqual({ commands: true, publishState: true, guardrails: { device: '$browser' } });
    expect(result.screen.layout.children.map((c) => c.widget)).toEqual(['clock', 'screen-identity']);
  });

  it('lets a household file replace it', async () => {
    const own = { screen: 'adhoc', websocket: { guardrails: { device: '$browser' } }, layout: { widget: 'clock' } };
    const result = await new ScreensQueryService({ screensRepository: repo({ adhoc: own }), logger }).getScreen('adhoc');
    expect(result.screen).toBe(own);
  });

  it('is not a way to reach any other name, and hands out copies', async () => {
    expect((await new ScreensQueryService({ screensRepository: repo({}), logger }).getScreen('office')).outcome).toBe('not-found');
    const a = builtInScreen('adhoc');
    a.websocket.guardrails.device = 'office-tv';
    expect(builtInScreen('adhoc').websocket.guardrails.device).toBe('$browser');
    expect(builtInScreen('nope')).toBeNull();
  });
});
