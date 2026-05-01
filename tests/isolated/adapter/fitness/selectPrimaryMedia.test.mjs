// tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs
import { selectPrimaryMedia, buildWarmupChecker } from '#adapters/fitness/selectPrimaryMedia.mjs';

// ─── Test data factories (event shape, matches backend timeline events) ───

function videoEvent(title, durationSeconds, dataOverrides = {}) {
  return {
    type: 'media',
    data: {
      contentId: `plex:${Math.floor(Math.random() * 1e9)}`,
      title,
      durationSeconds,
      ...dataOverrides,
    },
  };
}

function audioEvent(title, durationSeconds) {
  return {
    type: 'media',
    data: {
      contentId: `plex:${Math.floor(Math.random() * 1e9)}`,
      title,
      durationSeconds,
      contentType: 'track',
      artist: 'Some Artist',
    },
  };
}

const defaultConfig = {
  warmup_labels: ['Warmup', 'Cooldown'],
  warmup_description_tags: ['[Warmup]', '[Cooldown]', '[Stretch]'],
  warmup_title_patterns: ['warm[\\s-]?up', 'cool[\\s-]?down', 'stretch', 'recovery'],
  deprioritized_labels: ['KidsFun'],
};

describe('selectPrimaryMedia (backend)', () => {
  test('picks longest video when no warmups or deprioritized', () => {
    const events = [videoEvent('Short', 60), videoEvent('Long', 600)];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Long');
  });

  test('filters out audio events', () => {
    const events = [audioEvent('Long Song', 9999), videoEvent('Real Workout', 8 * 60)];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Real Workout');
  });

  test('filters out warmup by title pattern', () => {
    const events = [
      videoEvent('Ten minute warm-up', 600),
      videoEvent('Real Workout', 500),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Real Workout');
  });

  test('filters out deprioritized — workout wins over longer kids video', () => {
    // Real session timeline events use lowercase labels (kidsfun) regardless
    // of how they appear in the Plex API or in config (KidsFun).
    const events = [
      videoEvent('Mario Kart World', 763, { labels: ['kidsfun', 'resumable'] }),
      videoEvent('Lower Body Workout', 675, { labels: ['nomusic'] }),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Lower Body Workout');
  });

  test('returns null when only deprioritized + audio (no longer falls back to deprioritized)', () => {
    const events = [
      videoEvent('Mario Kart World', 763, { labels: ['kidsfun'] }),
      videoEvent('Danny Go Dance', 500, { labels: ['kidsfun'] }),
      audioEvent('Workout Mix', 9999),
    ];
    expect(selectPrimaryMedia(events, defaultConfig)).toBeNull();
  });

  test('combined skip — warmup + deprioritized + workout, workout wins', () => {
    const events = [
      videoEvent('Ten minute warm-up', 600),
      videoEvent('Mario Kart World', 763, { labels: ['kidsfun'] }),
      videoEvent('Real Workout', 500),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Real Workout');
  });

  test('deprioritized matching is case-insensitive', () => {
    const events = [
      videoEvent('Mario Kart World', 763, { labels: ['kidsfun'] }),
      videoEvent('Real Workout', 500),
    ];
    // defaultConfig has deprioritized_labels: ['KidsFun'] — must still match 'kidsfun'.
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Real Workout');
  });

  test('buildWarmupChecker does NOT match deprioritized labels', () => {
    // Warmup checker is reused by buildStravaDescription for "(warmup)" annotation.
    // It MUST stay warmup-only — kids videos must not get the warmup tag.
    const isWarmup = buildWarmupChecker(defaultConfig);
    const kidsEvent = videoEvent('Mario Kart World', 763, { labels: ['kidsfun'] });
    expect(isWarmup(kidsEvent)).toBe(false);
  });
});

describe('positional bias for multiple ≥10-min survivors (Plan 1 Task 2b)', () => {
  const TEN_MIN_SEC = 10 * 60;

  test('prefers the LAST ≥10-min event when two or more survive warmup filtering', () => {
    const events = [
      videoEvent('First Workout',  TEN_MIN_SEC + 60),
      videoEvent('Second Workout', TEN_MIN_SEC + 30),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Second Workout');
  });

  test('prefers the LAST ≥10-min event even when an earlier one is longer', () => {
    const events = [
      videoEvent('First',  TEN_MIN_SEC + 5 * 60), // 15 min
      videoEvent('Second', TEN_MIN_SEC + 30),     // 10.5 min
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Second');
  });

  test('falls back to longest when only ONE survivor is ≥10 min', () => {
    const events = [
      videoEvent('Short', 5 * 60),               // 5 min
      videoEvent('Long',  TEN_MIN_SEC + 2 * 60), // 12 min
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Long');
  });
});

describe('"Cold Start" warmup pattern (Plan 1 Task 4)', () => {
  test('treats "22 Minute Hard Corps—Cold Start" as a warmup', () => {
    const events = [
      videoEvent('22 Minute Hard Corps—Cold Start', 686), // ~11.4 min
      videoEvent('Week 1 Day 4 - Upper Body',       642), // ~10.7 min
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Week 1 Day 4 - Upper Body');
  });

  test('drops "cold start" (case-insensitive) when it is the only ≥10-min video and a shorter non-warmup exists', () => {
    const events = [
      videoEvent('cold start',    12 * 60), // 12 min — would win without filter
      videoEvent('Workout Short', 8 * 60),  // 8 min
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Workout Short');
  });
});

describe('minimum primary duration floor (Plan 4)', () => {
  const MIN_PRIMARY_SEC = 5 * 60;

  test('returns null when only a sub-floor non-warmup event survives (regression for 2026-04-30 session)', () => {
    const events = [
      videoEvent('F-Zero',              1254, { labels: ['kidsfun'] }),
      videoEvent('Strength Challenge 1', 48,  { labels: [] }),
    ];
    const cfg = { ...defaultConfig, deprioritized_labels: ['kidsfun'] };
    expect(selectPrimaryMedia(events, cfg)).toBeNull();
  });

  test('returns null when only a deprioritized event exists', () => {
    const events = [videoEvent('Cartoon Marathon', 30 * 60, { labels: ['kidsfun'] })];
    const cfg = { ...defaultConfig, deprioritized_labels: ['kidsfun'] };
    expect(selectPrimaryMedia(events, cfg)).toBeNull();
  });

  test('returns null when only a sub-floor real event exists', () => {
    const events = [videoEvent('Quick Demo', 4 * 60)];
    expect(selectPrimaryMedia(events, defaultConfig)).toBeNull();
  });

  test('returns the eligible event when it meets exactly MIN_PRIMARY_SEC', () => {
    const events = [videoEvent('Workout', MIN_PRIMARY_SEC)];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Workout');
  });

  test('picks the longer real candidate when only the longer clears the floor', () => {
    const events = [
      videoEvent('Brief', 4 * 60),
      videoEvent('Real',  12 * 60),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Real');
  });

  test('falls back to longest non-deprioritized warmup when only warmups exist (≥ MIN_PRIMARY_SEC)', () => {
    const events = [
      videoEvent('Stretch Routine', 10 * 60),
      videoEvent('Cool Down',        6 * 60),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Stretch Routine');
  });

  test('returns null when only sub-floor warmups exist', () => {
    const events = [videoEvent('Stretch', 4 * 60)];
    expect(selectPrimaryMedia(events, defaultConfig)).toBeNull();
  });
});
