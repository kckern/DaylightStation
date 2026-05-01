import { selectPrimaryMedia } from '../../../frontend/src/hooks/fitness/selectPrimaryMedia.js';

// ─── Test data factories ───

function vid(title, durationMs, overrides = {}) {
  return { contentId: `plex:${Math.random()}`, title, mediaType: 'video', durationMs, ...overrides };
}

function audio(title, durationMs) {
  return { contentId: `plex:${Math.random()}`, title, mediaType: 'audio', artist: 'Artist', durationMs };
}

const defaultConfig = {
  warmup_labels: ['Warmup', 'Cooldown'],
  warmup_description_tags: ['[Warmup]', '[Cooldown]', '[Stretch]'],
  warmup_title_patterns: ['warm[\\s-]?up', 'cool[\\s-]?down', 'stretch', 'recovery'],
  deprioritized_labels: ['KidsFun'],
};

// ─── Tests ───

describe('selectPrimaryMedia', () => {
  test('returns null for empty array', () => {
    expect(selectPrimaryMedia([], defaultConfig)).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(selectPrimaryMedia(null)).toBeNull();
    expect(selectPrimaryMedia(undefined)).toBeNull();
  });

  test('picks longest video when no warmups', () => {
    const items = [vid('Short', 5 * 60_000), vid('Long', 10 * 60_000)];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Long');
  });

  test('filters out audio — never selected as primary', () => {
    const items = [audio('Long Song', 999999), vid('Short Video', 5 * 60_000)];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Short Video');
  });

  test('filters out warmup by title pattern — "warm-up"', () => {
    const items = [
      vid('Ten minute warm-up', 10 * 60_000),
      vid('Shoulders 2', 9 * 60_000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Shoulders 2');
  });

  test('filters out warmup by title pattern — "Stretch"', () => {
    const items = [
      vid('LIIFT4 Stretch', 12 * 60_000),
      vid('Chest Day', 10 * 60_000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Chest Day');
  });

  test('filters out warmup by title pattern — "cool-down"', () => {
    const items = [
      vid('5 Minute Cool-Down', 11 * 60_000),
      vid('Leg Day', 10 * 60_000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Leg Day');
  });

  test('filters out warmup by title pattern — "Recovery"', () => {
    const items = [
      vid('Recovery Day', 11 * 60_000),
      vid('Chest Day', 10 * 60_000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Chest Day');
  });

  test('title matching is case-insensitive', () => {
    const items = [
      vid('WARM UP Session', 10 * 60_000),
      vid('Real Workout', 9 * 60_000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Real Workout');
  });

  test('filters out warmup by labels', () => {
    const items = [
      vid('Generic Title', 10 * 60_000, { labels: ['Warmup'] }),
      vid('Real Workout', 9 * 60_000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Real Workout');
  });

  test('filters out warmup by description tag — "[Warmup]"', () => {
    const items = [
      vid('Generic Title', 10 * 60_000, { description: 'A [Warmup] for beginners' }),
      vid('Real Workout', 9 * 60_000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Real Workout');
  });

  test('filters out warmup by description tag — "[Cooldown]"', () => {
    const items = [
      vid('Post Workout', 10 * 60_000, { description: '[Cooldown] stretch routine' }),
      vid('Main Workout', 9 * 60_000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Main Workout');
  });

  test('falls back to longest video when ALL videos are warmups', () => {
    const items = [
      vid('Short Warm-Up', 5 * 60_000),
      vid('Long Warm-Up', 10 * 60_000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Long Warm-Up');
  });

  test('falls back to longest video when only audio + warmups', () => {
    const items = [
      audio('Song', 999999),
      vid('Warm-Up', 10 * 60_000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Warm-Up');
  });

  test('works with no warmupConfig — uses built-in defaults', () => {
    const items = [
      vid('Ten minute warm-up', 10 * 60_000),
      vid('Shoulders 2', 9 * 60_000),
    ];
    expect(selectPrimaryMedia(items).title).toBe('Shoulders 2');
  });

  test('works with empty warmupConfig — uses built-in defaults only', () => {
    const items = [
      vid('Ten minute warm-up', 10 * 60_000),
      vid('Shoulders 2', 9 * 60_000),
    ];
    expect(selectPrimaryMedia(items, {}).title).toBe('Shoulders 2');
  });

  test('config title patterns extend built-in defaults', () => {
    const config = { ...defaultConfig, warmup_title_patterns: ['cardio blast'] };
    const items = [
      vid('Cardio Blast', 10 * 60_000),
      vid('Real Workout', 9 * 60_000),
    ];
    expect(selectPrimaryMedia(items, config).title).toBe('Real Workout');
  });

  test('mixed session — warmup + workout + music', () => {
    const items = [
      vid('Ten minute warm-up', 650000),
      vid('Shoulders 2', 647000),
      audio('Harlem Shake', 196000),
      audio('Gangnam Style', 217000),
    ];
    const result = selectPrimaryMedia(items, defaultConfig);
    expect(result.title).toBe('Shoulders 2');
  });

  test('filters out deprioritized by labels — workout wins over longer kids video', () => {
    // Session-persisted labels are lowercase (kidsfun); config is CamelCase (KidsFun).
    // The matcher must compare case-insensitively.
    const items = [
      vid('Mario Kart World', 763000, { labels: ['kidsfun', 'resumable', 'sequential'] }),
      vid('Lower Body Workout', 675000, { labels: ['nomusic'] }),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Lower Body Workout');
  });

  test('falls back to longest deprioritized when only deprioritized + audio', () => {
    const items = [
      vid('Mario Kart World', 763000, { labels: ['kidsfun'] }),
      vid('Danny Go Dance', 500000, { labels: ['kidsfun'] }),
      audio('Workout Mix', 999999),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Mario Kart World');
  });

  test('combined skip — warmup + deprioritized + workout, workout wins', () => {
    const items = [
      vid('Ten minute warm-up', 600000),
      vid('Mario Kart World', 763000, { labels: ['kidsfun'] }),
      vid('Real Workout', 500000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Real Workout');
  });

  test('deprioritized matching is case-insensitive (CamelCase config vs lowercase labels)', () => {
    const items = [
      vid('Mario Kart World', 763000, { labels: ['kidsfun'] }),
      vid('Real Workout', 500000),
    ];
    // defaultConfig has deprioritized_labels: ['KidsFun'] — must still match 'kidsfun'.
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Real Workout');
  });
});
