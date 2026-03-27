import { selectPrimaryMedia } from '../../../../backend/src/1_adapters/fitness/selectPrimaryMedia.mjs';

// ─── Test data factories ───

function episodeEvent(title, durationSeconds, overrides = {}) {
  return {
    type: 'media',
    timestamp: Date.now(),
    data: {
      contentType: 'episode',
      title,
      durationSeconds,
      grandparentTitle: overrides.grandparentTitle || 'Show',
      ...overrides,
    },
  };
}

function trackEvent(title, durationSeconds, artist = 'Artist') {
  return {
    type: 'media',
    timestamp: Date.now(),
    data: { contentType: 'track', title, artist, durationSeconds },
  };
}

const defaultConfig = {
  warmup_labels: ['Warmup', 'Cooldown'],
  warmup_description_tags: ['[Warmup]', '[Cooldown]'],
  warmup_title_patterns: ['warm[\\s-]?up', 'cool[\\s-]?down', 'stretch', 'recovery'],
};

// ─── Tests ───

describe('selectPrimaryMedia (backend)', () => {
  test('returns null for empty array', () => {
    expect(selectPrimaryMedia([], defaultConfig)).toBeNull();
  });

  test('returns null for null/undefined', () => {
    expect(selectPrimaryMedia(null)).toBeNull();
    expect(selectPrimaryMedia(undefined)).toBeNull();
  });

  test('picks longest episode', () => {
    const items = [episodeEvent('Short', 300), episodeEvent('Long', 600)];
    expect(selectPrimaryMedia(items, defaultConfig).data.title).toBe('Long');
  });

  test('filters out music tracks', () => {
    const items = [trackEvent('Song', 9999), episodeEvent('Workout', 300)];
    expect(selectPrimaryMedia(items, defaultConfig).data.title).toBe('Workout');
  });

  test('filters warmup by title', () => {
    const items = [
      episodeEvent('Ten minute warm-up', 650),
      episodeEvent('Shoulders 2', 647),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).data.title).toBe('Shoulders 2');
  });

  test('filters warmup by labels', () => {
    const items = [
      episodeEvent('Generic', 650, { labels: ['Warmup'] }),
      episodeEvent('Real Workout', 600),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).data.title).toBe('Real Workout');
  });

  test('filters warmup by description tag', () => {
    const items = [
      episodeEvent('Intro', 650, { description: '[Warmup] get ready' }),
      episodeEvent('Main', 600),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).data.title).toBe('Main');
  });

  test('falls back to longest video when all are warmups', () => {
    const items = [
      episodeEvent('Short Warm-Up', 300),
      episodeEvent('Long Warm-Up', 600),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).data.title).toBe('Long Warm-Up');
  });

  test('returns full event object, not just .data', () => {
    const items = [episodeEvent('Workout', 600)];
    const result = selectPrimaryMedia(items, defaultConfig);
    expect(result).toHaveProperty('type', 'media');
    expect(result).toHaveProperty('data');
    expect(result.data.title).toBe('Workout');
  });

  test('uses built-in defaults without config', () => {
    const items = [
      episodeEvent('Warm-Up', 650),
      episodeEvent('Workout', 600),
    ];
    expect(selectPrimaryMedia(items).data.title).toBe('Workout');
  });
});
