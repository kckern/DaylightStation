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
    const events = [audioEvent('Long Song', 9999), videoEvent('Short Video', 60)];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Short Video');
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

  test('falls back to longest deprioritized when only deprioritized + audio', () => {
    const events = [
      videoEvent('Mario Kart World', 763, { labels: ['kidsfun'] }),
      videoEvent('Danny Go Dance', 500, { labels: ['kidsfun'] }),
      audioEvent('Workout Mix', 9999),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Mario Kart World');
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
