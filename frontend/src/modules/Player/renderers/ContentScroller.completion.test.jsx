// ContentScroller completion log (jsdom).
//
// 2026-10-02: progress is logged at most every 10s and never at the end, so a
// 17-second poem's only record was "10s, 59%". Short poems therefore never
// counted as heard, and the office-program poetry rotation kept serving them.
// A read-along that reaches its natural end now logs 100%.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import ContentScroller from './ContentScroller.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve({})) }));

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, writable: true, value: vi.fn(() => Promise.resolve()) });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, writable: true, value: vi.fn() });
});
beforeEach(() => { DaylightAPI.mockClear(); });

const renderPoem = (onAdvance = vi.fn()) => render(
  <ContentScroller
    type="poetry"
    title="your Task"
    assetId="readalong:poetry/remedy/60"
    listId="office-program"
    mainMediaUrl="/media/poem60.mp3"
    contentData={{ type: 'verses', data: [{ verse: 1, text: 'line' }] }}
    parseContent={() => <div><p>line</p></div>}
    onAdvance={onAdvance}
  />
);

const endedAt = (audio, seconds) => {
  Object.defineProperty(audio, 'duration', { configurable: true, value: seconds });
  act(() => { audio.dispatchEvent(new Event('loadedmetadata')); });
  audio.currentTime = seconds;
  act(() => { audio.dispatchEvent(new Event('ended')); });
};

const playLogCalls = () => DaylightAPI.mock.calls.filter(([path]) => path === 'api/v1/play/log');

describe('ContentScroller completion log', () => {
  it('logs 100% at the full duration when the read-along ends, then advances', () => {
    const onAdvance = vi.fn();
    const { container } = renderPoem(onAdvance);
    endedAt(container.querySelector('audio'), 17.2);
    expect(playLogCalls()).toEqual([[
      'api/v1/play/log',
      { title: 'your Task', type: 'readalong', assetId: 'readalong:poetry/remedy/60', seconds: 17, percent: 100, listId: 'office-program' },
    ]]);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('logs the completion once even if ended fires twice', () => {
    const { container } = renderPoem();
    const audio = container.querySelector('audio');
    endedAt(audio, 17);
    act(() => { audio.dispatchEvent(new Event('ended')); });
    expect(playLogCalls()).toHaveLength(1);
  });
});
