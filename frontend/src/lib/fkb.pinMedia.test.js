import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// canPinMedia / pinMedia: the phone app's page-bridge members for pinning
// media to the home screen (phone.md, "Page bridge on the phone: pinning media").
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
vi.mock('./logging/Logger.js', () => ({
  default: () => ({ child: () => log }),
}));

const REQUEST = { contentId: 'plex:4242', label: 'Road trip' };
const REASONS = [
  'refused', 'not_top_frame', 'rate_limited', 'bad_request', 'invalid_content_id',
  'invalid_label', 'not_available', 'launcher_cannot_pin', 'launcher_refused', 'failed',
];

let fkb;

beforeEach(async () => {
  vi.resetModules();
  Object.values(log).forEach((fn) => fn.mockClear());
  delete global.daylight;
  delete global.fully;
  fkb = await import('./fkb.js');
});

afterEach(() => {
  delete global.daylight;
  delete global.fully;
});

/** Every logged payload, flattened, so a test can prove an id never reaches the log. */
const everythingLogged = () => JSON.stringify(Object.values(log).flatMap((fn) => fn.mock.calls));

describe('canPinMedia', () => {
  it('is false with no bridge at all', () => {
    expect(fkb.canPinMedia()).toBe(false);
  });

  it('is false on a kiosk bridge that has no pin members', () => {
    global.daylight = { launch: vi.fn(), screen: vi.fn() };
    expect(fkb.canPinMedia()).toBe(false);
  });

  it('is false on Fully', () => {
    global.fully = { turnScreenOff: vi.fn(), bind: vi.fn() };
    expect(fkb.canPinMedia()).toBe(false);
  });

  it('passes through true', () => {
    global.daylight = { canPinMedia: vi.fn(() => true), pinMedia: vi.fn() };
    expect(fkb.canPinMedia()).toBe(true);
  });

  it('passes through false', () => {
    global.daylight = { canPinMedia: vi.fn(() => false), pinMedia: vi.fn() };
    expect(fkb.canPinMedia()).toBe(false);
  });

  it('is false when pinMedia is missing even if canPinMedia says true', () => {
    global.daylight = { canPinMedia: vi.fn(() => true) };
    expect(fkb.canPinMedia()).toBe(false);
  });

  it('reads only a real boolean true as true', () => {
    global.daylight = { canPinMedia: vi.fn(() => 'true'), pinMedia: vi.fn() };
    expect(fkb.canPinMedia()).toBe(false);
  });

  it('is false when the member throws', () => {
    global.daylight = { canPinMedia: vi.fn(() => { throw new Error('bridge gone'); }), pinMedia: vi.fn() };
    expect(fkb.canPinMedia()).toBe(false);
  });

  it('is false when reading the bridge throws', () => {
    Object.defineProperty(global, 'daylight', {
      configurable: true,
      get() { throw new Error('no access'); },
    });
    expect(fkb.canPinMedia()).toBe(false);
  });
});

describe('pinMedia', () => {
  it('answers not_available when the member is absent', () => {
    expect(fkb.pinMedia(REQUEST)).toEqual({ accepted: false, reason: 'not_available' });
    global.daylight = { launch: vi.fn() };
    expect(fkb.pinMedia(REQUEST)).toEqual({ accepted: false, reason: 'not_available' });
  });

  it('sends exactly {contentId, label}', () => {
    const pinMedia = vi.fn(() => ({ accepted: true }));
    global.daylight = { canPinMedia: () => true, pinMedia };
    fkb.pinMedia({ ...REQUEST, extra: 'dropped' });
    expect(pinMedia).toHaveBeenCalledTimes(1);
    const sent = pinMedia.mock.calls[0][0];
    const parsed = typeof sent === 'string' ? JSON.parse(sent) : sent;
    expect(parsed).toEqual(REQUEST);
  });

  it('normalizes an object answer', () => {
    global.daylight = { pinMedia: vi.fn(() => ({ accepted: true })) };
    expect(fkb.pinMedia(REQUEST)).toEqual({ accepted: true });
  });

  it('parses a JSON-string answer', () => {
    global.daylight = { pinMedia: vi.fn(() => '{"accepted":false,"reason":"rate_limited"}') };
    expect(fkb.pinMedia(REQUEST)).toEqual({ accepted: false, reason: 'rate_limited' });
  });

  it('parses a JSON-string acceptance', () => {
    global.daylight = { pinMedia: vi.fn(() => '{"accepted":true}') };
    expect(fkb.pinMedia(REQUEST)).toEqual({ accepted: true });
  });

  it.each(REASONS)('passes the reason %s through', (reason) => {
    global.daylight = { pinMedia: vi.fn(() => ({ accepted: false, reason })) };
    expect(fkb.pinMedia(REQUEST)).toEqual({ accepted: false, reason });
  });

  it('answers failed when the member throws', () => {
    global.daylight = { pinMedia: vi.fn(() => { throw new Error('boom'); }) };
    expect(fkb.pinMedia(REQUEST)).toEqual({ accepted: false, reason: 'failed' });
  });

  it('answers failed for an unparseable string', () => {
    global.daylight = { pinMedia: vi.fn(() => 'not json') };
    expect(fkb.pinMedia(REQUEST)).toEqual({ accepted: false, reason: 'failed' });
  });

  it('answers failed for an answer of the wrong shape', () => {
    for (const answer of [undefined, null, true, 7, [], { accepted: 'yes' }]) {
      global.daylight = { pinMedia: vi.fn(() => answer) };
      expect(fkb.pinMedia(REQUEST)).toEqual({ accepted: false, reason: 'failed' });
    }
  });

  it('turns a refusal without a reason, or an odd reason, into failed', () => {
    global.daylight = { pinMedia: vi.fn(() => ({ accepted: false })) };
    expect(fkb.pinMedia(REQUEST)).toEqual({ accepted: false, reason: 'failed' });
    global.daylight = { pinMedia: vi.fn(() => ({ accepted: false, reason: 'Some Text <b>' })) };
    expect(fkb.pinMedia(REQUEST)).toEqual({ accepted: false, reason: 'failed' });
  });

  it('keeps nothing but accepted and reason', () => {
    global.daylight = { pinMedia: vi.fn(() => ({ accepted: true, link: 'daylight://x', key: 'k' })) };
    expect(fkb.pinMedia(REQUEST)).toEqual({ accepted: true });
  });

  it('logs fkb.pinMedia.result with accepted and reason, never the id or label', () => {
    global.daylight = { pinMedia: vi.fn(() => ({ accepted: false, reason: 'invalid_label' })) };
    fkb.pinMedia(REQUEST);
    const results = Object.values(log)
      .flatMap((fn) => fn.mock.calls)
      .filter(([name]) => name === 'fkb.pinMedia.result')
      .map(([, data]) => data);
    expect(results).toEqual([{ accepted: false, reason: 'invalid_label' }]);
    expect(everythingLogged()).not.toContain('plex:4242');
    expect(everythingLogged()).not.toContain('Road trip');
  });

  it('logs the result of a thrown call without the id', () => {
    global.daylight = { pinMedia: vi.fn(() => { throw new Error('plex:4242 failed'); }) };
    fkb.pinMedia(REQUEST);
    expect(everythingLogged()).toContain('fkb.pinMedia.result');
    expect(everythingLogged()).not.toContain('plex:4242');
  });
});
