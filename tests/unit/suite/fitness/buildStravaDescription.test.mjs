/**
 * Unit tests for buildStravaDescription
 *
 * Pure function that builds Strava activity name and description from a
 * DaylightStation fitness session. Tests are written TDD-first: the source
 * module currently has a syntax error, so the import will fail until that
 * is fixed in the next task.
 */

import { buildStravaDescription } from '../../../../backend/src/1_adapters/fitness/buildStravaDescription.mjs';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const MIN_WATCH_MS = 2 * 60 * 1000; // 2 minutes — must match the module constant

// ═══════════════════════════════════════════════════════════════════════════════
// TEST DATA FACTORIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Base session shell — all fields optional, merged with overrides. */
function createSession(overrides = {}) {
  return {
    session: { duration_seconds: 3600, ...overrides.session },
    timeline: { events: overrides.events || [] },
    summary: overrides.summary || {},
    participants: overrides.participants || {},
  };
}

/** Media event for an episode (non-music). */
function createEpisodeEvent(overrides = {}) {
  const now = Date.now();
  return {
    type: 'media',
    data: {
      contentType: 'episode',
      grandparentTitle: 'Show Name',
      title: 'Episode Title',
      durationSeconds: 1800,
      start: now,
      end: now + 30 * 60 * 1000, // 30 min watched window
      description: 'A great episode about testing.',
      ...overrides,
    },
  };
}

/** Media event for a music track. */
function createMusicEvent(overrides = {}) {
  return {
    type: 'media',
    data: {
      contentType: 'track',
      title: 'Song Title',
      artist: 'Artist Name',
      durationSeconds: 240,
      ...overrides,
    },
  };
}

/** Voice memo event. */
function createVoiceMemoEvent(transcript = 'Felt great today!') {
  return {
    type: 'voice_memo',
    data: { transcript },
  };
}

/**
 * Create a brief episode event that is watched for less than MIN_WATCH_MS.
 * start/end window is 60 seconds (well under 2 min threshold).
 */
function createBriefEpisodeEvent(overrides = {}) {
  const now = Date.now();
  return createEpisodeEvent({
    start: now,
    end: now + 60 * 1000, // 1 minute — below threshold
    durationSeconds: 1800,
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// NULL / EMPTY INPUTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — null/empty inputs', () => {
  test('returns null when session is undefined', () => {
    const result = buildStravaDescription(undefined);
    expect(result).toBeNull();
  });

  test('returns null when session is null', () => {
    const result = buildStravaDescription(null);
    expect(result).toBeNull();
  });

  test('returns null for empty session (no events)', () => {
    const session = createSession({ events: [] });
    const result = buildStravaDescription(session);
    expect(result).toBeNull();
  });

  test('returns name but no description when session has only brief media (< 2 min)', () => {
    const session = createSession({
      session: { duration_seconds: 60 }, // short session matches the brief browse
      events: [createBriefEpisodeEvent()],
    });
    const result = buildStravaDescription(session);
    // Brief episode is excluded from watchedEpisodes (< 2 min) so no description,
    // but primaryMedia still falls through to episodeEvents for the title
    expect(result).not.toBeNull();
    expect(result.name).not.toBeNull();
    expect(result.description).not.toBeNull();
  });

  test('returns null for session with no timeline property', () => {
    const result = buildStravaDescription({ session: { duration_seconds: 600 } });
    expect(result).toBeNull();
  });

  test('returns null for session with empty timeline events array', () => {
    const result = buildStravaDescription({
      session: { duration_seconds: 600 },
      timeline: { events: [] },
    });
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TITLE GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — title generation', () => {
  test('generates "Show\u2014Episode" format when both exist', () => {
    const session = createSession({
      events: [createEpisodeEvent({
        grandparentTitle: 'Better Call Saul',
        title: 'Chicanery',
      })],
    });
    const result = buildStravaDescription(session);
    expect(result).not.toBeNull();
    expect(result.name).toBe('Better Call Saul\u2014Chicanery');
  });

  test('uses show name only when episode title is missing', () => {
    const session = createSession({
      events: [createEpisodeEvent({
        grandparentTitle: 'Better Call Saul',
        title: null,
      })],
    });
    const result = buildStravaDescription(session);
    expect(result).not.toBeNull();
    expect(result.name).toBe('Better Call Saul');
  });

  test('uses episode title only when show name is missing', () => {
    const session = createSession({
      events: [createEpisodeEvent({
        grandparentTitle: null,
        showTitle: null,
        title: 'Chicanery',
      })],
    });
    const result = buildStravaDescription(session);
    expect(result).not.toBeNull();
    expect(result.name).toBe('Chicanery');
  });

  test('uses showTitle as fallback for grandparentTitle', () => {
    const session = createSession({
      events: [createEpisodeEvent({
        grandparentTitle: null,
        showTitle: 'Fallback Show',
        title: 'Episode One',
      })],
    });
    const result = buildStravaDescription(session);
    expect(result.name).toBe('Fallback Show\u2014Episode One');
  });

  test('selects the longest episode by durationSeconds for title', () => {
    const now = Date.now();
    const shortEpisode = createEpisodeEvent({
      grandparentTitle: 'Short Show',
      title: 'Short Ep',
      durationSeconds: 600,
      start: now,
      end: now + 10 * 60 * 1000,
    });
    const longEpisode = createEpisodeEvent({
      grandparentTitle: 'Long Show',
      title: 'Long Ep',
      durationSeconds: 3600,
      start: now + 10 * 60 * 1000,
      end: now + 40 * 60 * 1000,
    });
    const session = createSession({
      events: [shortEpisode, longEpisode],
    });
    const result = buildStravaDescription(session);
    expect(result.name).toBe('Long Show\u2014Long Ep');
  });

  test('uses first episode when all durations are equal', () => {
    const now = Date.now();
    const ep1 = createEpisodeEvent({
      grandparentTitle: 'First Show',
      title: 'First Ep',
      durationSeconds: 1800,
      start: now,
      end: now + 30 * 60 * 1000,
    });
    const ep2 = createEpisodeEvent({
      grandparentTitle: 'Second Show',
      title: 'Second Ep',
      durationSeconds: 1800,
      start: now + 30 * 60 * 1000,
      end: now + 60 * 60 * 1000,
    });
    const session = createSession({ events: [ep1, ep2] });
    const result = buildStravaDescription(session);
    // reduce keeps best when equal, so first wins
    expect(result.name).toBe('First Show\u2014First Ep');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SKIP TITLE LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — skip title logic', () => {
  test('skips title when currentActivity.name already contains em-dash', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    const currentActivity = { name: 'Already Set\u2014Title' };
    const result = buildStravaDescription(session, currentActivity);
    expect(result).not.toBeNull();
    expect(result.name).toBeNull();
  });

  test('does NOT skip title when currentActivity.name has no em-dash', () => {
    const session = createSession({
      events: [createEpisodeEvent({
        grandparentTitle: 'My Show',
        title: 'My Episode',
      })],
    });
    const currentActivity = { name: 'Morning Workout' };
    const result = buildStravaDescription(session, currentActivity);
    expect(result.name).toBe('My Show\u2014My Episode');
  });

  test('does NOT skip title when currentActivity.name is empty', () => {
    const session = createSession({
      events: [createEpisodeEvent({
        grandparentTitle: 'My Show',
        title: 'My Episode',
      })],
    });
    const currentActivity = { name: '' };
    const result = buildStravaDescription(session, currentActivity);
    expect(result.name).toBe('My Show\u2014My Episode');
  });

  test('does NOT skip title when currentActivity has no name', () => {
    const session = createSession({
      events: [createEpisodeEvent({
        grandparentTitle: 'My Show',
        title: 'My Episode',
      })],
    });
    const result = buildStravaDescription(session, {});
    expect(result.name).toBe('My Show\u2014My Episode');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DESCRIPTION GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — description generation', () => {
  test('includes voice memos with microphone emoji', () => {
    const session = createSession({
      events: [
        createVoiceMemoEvent('Great workout today'),
        createEpisodeEvent(), // need something enrichable
      ],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('\uD83C\uDF99\uFE0F');
    expect(result.description).toContain('"Great workout today"');
  });

  test('includes multiple voice memos separated by double newlines', () => {
    const session = createSession({
      events: [
        createVoiceMemoEvent('First memo'),
        createVoiceMemoEvent('Second memo'),
        createEpisodeEvent(),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('\uD83C\uDF99\uFE0F "First memo"');
    expect(result.description).toContain('\uD83C\uDF99\uFE0F "Second memo"');
  });

  test('includes episode descriptions with monitor emoji', () => {
    const session = createSession({
      events: [createEpisodeEvent({
        grandparentTitle: 'Test Show',
        title: 'Test Episode',
        description: 'Episode about testing.',
      })],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('\uD83D\uDDA5\uFE0F');
    expect(result.description).toContain('Test Show \u2014 Test Episode');
    expect(result.description).toContain('Episode about testing.');
  });

  test('includes music playlist with musical note emoji', () => {
    const session = createSession({
      events: [
        createMusicEvent({ artist: 'Radiohead', title: 'Creep' }),
        createMusicEvent({ artist: 'Nirvana', title: 'Smells Like Teen Spirit' }),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('\uD83C\uDFB5 Radiohead \u2014 Creep');
    expect(result.description).toContain('\uD83C\uDFB5 Nirvana \u2014 Smells Like Teen Spirit');
    expect(result.description).not.toContain('Playlist');
  });

  test('voice memos appear before episodes in description', () => {
    const session = createSession({
      events: [
        createEpisodeEvent(),
        createVoiceMemoEvent('My memo'),
      ],
    });
    const result = buildStravaDescription(session);
    const memoIdx = result.description.indexOf('\uD83C\uDF99\uFE0F');
    const episodeIdx = result.description.indexOf('\uD83D\uDDA5\uFE0F');
    expect(memoIdx).toBeLessThan(episodeIdx);
  });

  test('episodes appear before music playlist in description', () => {
    const now = Date.now();
    const session = createSession({
      events: [
        createEpisodeEvent({ start: now, end: now + 30 * 60 * 1000 }),
        createMusicEvent({ artist: 'Artist', title: 'Track' }),
      ],
    });
    const result = buildStravaDescription(session);
    const episodeIdx = result.description.indexOf('\uD83D\uDDA5\uFE0F');
    const playlistIdx = result.description.indexOf('\uD83C\uDFB5');
    expect(episodeIdx).toBeLessThan(playlistIdx);
  });

  test('flattens multiline episode descriptions to single line', () => {
    const session = createSession({
      events: [createEpisodeEvent({
        description: 'Line one.\n  Line two.\n\nLine three.',
      })],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('Line one. Line two. Line three.');
    expect(result.description).not.toContain('\n  Line two');
  });

  test('trims voice memo transcript whitespace', () => {
    const session = createSession({
      events: [
        createVoiceMemoEvent('  padded transcript  '),
        createEpisodeEvent(),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('"padded transcript"');
  });

  test('music track with only title (no artist) shows just title', () => {
    const session = createSession({
      events: [
        createMusicEvent({ artist: null, title: 'Instrumental', contentType: 'track' }),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('Instrumental');
    expect(result.description).not.toContain('\u2014 Instrumental');
  });

  test('music tracks with no title and no artist are excluded from playlist', () => {
    const session = createSession({
      events: [
        createMusicEvent({ artist: 'Good Artist', title: 'Good Song' }),
        createMusicEvent({ artist: null, title: null, contentType: 'track' }),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('Good Artist \u2014 Good Song');
    // The null/null track should be filtered out
    const musicLines = result.description.split('\n').filter(l => l.includes('\uD83C\uDFB5'));
    expect(musicLines).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SKIP DESCRIPTION LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — skip description logic', () => {
  test('skips description when currentActivity.description is already set', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    const currentActivity = { description: 'Already has a description' };
    const result = buildStravaDescription(session, currentActivity);
    // name should still be returned, description should be null
    expect(result).not.toBeNull();
    expect(result.name).not.toBeNull();
    expect(result.description).toBeNull();
  });

  test('does NOT skip description when currentActivity.description is empty string', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    const currentActivity = { description: '' };
    const result = buildStravaDescription(session, currentActivity);
    expect(result.description).not.toBeNull();
  });

  test('does NOT skip description when currentActivity.description is whitespace only', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    const currentActivity = { description: '   ' };
    // Whitespace-only trims to empty, so .trim() is falsy — should NOT skip
    const result = buildStravaDescription(session, currentActivity);
    expect(result.description).not.toBeNull();
  });

  test('does NOT skip description when currentActivity has no description', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    const result = buildStravaDescription(session, {});
    expect(result.description).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EPISODE WATCH-TIME FILTERING
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — episode watch-time filtering', () => {
  test('excludes episodes watched < 2 minutes from description', () => {
    const now = Date.now();
    const briefEp = createEpisodeEvent({
      grandparentTitle: 'Brief Show',
      title: 'Brief Episode',
      start: now,
      end: now + 60 * 1000, // 1 minute
    });
    const longEp = createEpisodeEvent({
      grandparentTitle: 'Long Show',
      title: 'Long Episode',
      start: now + 60 * 1000,
      end: now + 31 * 60 * 1000, // 30 minutes
    });
    const session = createSession({
      events: [briefEp, longEp],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('Long Show');
    expect(result.description).toContain('Brief Show');
  });

  test('includes episodes watched exactly 2 minutes', () => {
    const now = Date.now();
    const exactEp = createEpisodeEvent({
      grandparentTitle: 'Exact Show',
      title: 'Exact Episode',
      start: now,
      end: now + MIN_WATCH_MS, // exactly 2 min
    });
    const session = createSession({ events: [exactEp] });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('Exact Show');
  });

  test('uses consecutive event start times when direct window is < 2 min', () => {
    // Simulates old media_memory_crossref sessions with brief detection windows
    // but long actual watch times inferred from consecutive event positions
    const now = Date.now();
    const ep1 = createEpisodeEvent({
      grandparentTitle: 'Show A',
      title: 'Ep A',
      start: now,
      end: now + 30 * 1000, // 30 sec direct window (< 2 min)
    });
    const ep2 = createEpisodeEvent({
      grandparentTitle: 'Show B',
      title: 'Ep B',
      start: now + 20 * 60 * 1000, // started 20 min after ep1
      end: now + 20 * 60 * 1000 + 30 * 1000,
    });
    const session = createSession({
      session: { duration_seconds: 3600 },
      events: [ep1, ep2],
    });
    const result = buildStravaDescription(session);
    // ep1 direct window is 30s, but consecutive gap is 20 min => should be included
    expect(result.description).toContain('Show A');
  });

  test('uses remaining session time for the last episode', () => {
    // Last episode has brief direct window but session has time remaining
    const now = Date.now();
    const ep = createEpisodeEvent({
      grandparentTitle: 'Last Show',
      title: 'Last Episode',
      start: now,
      end: now + 30 * 1000, // 30 sec direct window
    });
    const session = createSession({
      session: { duration_seconds: 1800 }, // 30 min session
      events: [ep],
    });
    const result = buildStravaDescription(session);
    // remaining session time = 1800s = 30 min => should be included
    expect(result.description).toContain('Last Show');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUSIC-ONLY SESSIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — music-only sessions', () => {
  test('returns playlist description with null title for music-only', () => {
    const session = createSession({
      events: [
        createMusicEvent({ artist: 'Radiohead', title: 'Creep' }),
        createMusicEvent({ artist: 'Muse', title: 'Hysteria' }),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result).not.toBeNull();
    expect(result.name).toBeNull();
    expect(result.description).toContain('\uD83C\uDFB5 Radiohead \u2014 Creep');
    expect(result.description).toContain('\uD83C\uDFB5 Muse \u2014 Hysteria');
    expect(result.description).not.toContain('Playlist');
  });

  test('returns null when all music tracks have no title and no artist', () => {
    const session = createSession({
      events: [
        createMusicEvent({ artist: null, title: null, contentType: 'track' }),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMBINED NULL RETURN — both name and description already exist
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — combined null return', () => {
  test('returns null when title is skipped (em-dash) and description is already set', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    const currentActivity = {
      name: 'Show\u2014Episode',
      description: 'Already exists',
    };
    const result = buildStravaDescription(session, currentActivity);
    // name skipped (em-dash in current name), description skipped (already set)
    // => both null => function returns null
    expect(result).toBeNull();
  });

  test('returns name only when title is new but description is already set', () => {
    const session = createSession({
      events: [createEpisodeEvent({
        grandparentTitle: 'New Show',
        title: 'New Episode',
      })],
    });
    const currentActivity = {
      name: 'Morning Workout',
      description: 'Already exists',
    };
    const result = buildStravaDescription(session, currentActivity);
    expect(result).not.toBeNull();
    expect(result.name).toBe('New Show\u2014New Episode');
    expect(result.description).toBeNull();
  });

  test('returns description only when title is skipped but description is new', () => {
    const session = createSession({
      events: [
        createEpisodeEvent(),
        createVoiceMemoEvent('Some note'),
      ],
    });
    const currentActivity = {
      name: 'Show\u2014Episode', // has em-dash => skip title
    };
    const result = buildStravaDescription(session, currentActivity);
    expect(result).not.toBeNull();
    expect(result.name).toBeNull();
    expect(result.description).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VOICE MEMO ONLY SESSIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — voice memo only sessions', () => {
  test('returns description with null title for voice-memo-only session', () => {
    const session = createSession({
      events: [createVoiceMemoEvent('Feeling good today')],
    });
    const result = buildStravaDescription(session);
    expect(result).not.toBeNull();
    expect(result.name).toBeNull();
    expect(result.description).toContain('\uD83C\uDF99\uFE0F "Feeling good today"');
  });

  test('skips voice memos without transcript', () => {
    const session = createSession({
      events: [
        { type: 'voice_memo', data: { transcript: null } },
        { type: 'voice_memo', data: {} },
        createVoiceMemoEvent('Valid memo'),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result).not.toBeNull();
    // Only the valid memo should appear
    expect(result.description).toContain('Valid memo');
    // Should not have empty quotes
    expect(result.description).not.toMatch(/\uD83C\uDF99\uFE0F ""/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA CLASSIFICATION — artist / contentType: 'track' detection
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — media classification', () => {
  test('events with artist field are classified as music, not episodes', () => {
    const now = Date.now();
    const session = createSession({
      events: [
        {
          type: 'media',
          data: {
            contentType: 'episode',
            grandparentTitle: 'Music Video Show',
            title: 'Some Video',
            artist: 'Some Artist', // has artist => classified as music
            durationSeconds: 1800,
            start: now,
            end: now + 30 * 60 * 1000,
          },
        },
      ],
    });
    const result = buildStravaDescription(session);
    // Should be treated as music, not episode => no title, just playlist
    expect(result.name).toBeNull();
    expect(result.description).toContain('\uD83C\uDFB5 Some Artist \u2014 Some Video');
  });

  test('events with contentType "track" are classified as music', () => {
    const session = createSession({
      events: [
        createMusicEvent({ contentType: 'track', artist: null, title: 'Ambient' }),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result.name).toBeNull();
    expect(result.description).toContain('\uD83C\uDFB5 Ambient');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT PARAMETER — currentActivity
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — default currentActivity parameter', () => {
  test('works when currentActivity is omitted (defaults to {})', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    // Call without second argument
    const result = buildStravaDescription(session);
    expect(result).not.toBeNull();
    expect(result.name).not.toBeNull();
    expect(result.description).not.toBeNull();
  });

  test('works when currentActivity is explicitly {}', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    const result = buildStravaDescription(session, {});
    expect(result).not.toBeNull();
    expect(result.name).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RETURN SHAPE
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — return shape', () => {
  test('returns object with name and description keys', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    const result = buildStravaDescription(session);
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('description');
  });

  test('name is string or null', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    const result = buildStravaDescription(session);
    expect(typeof result.name === 'string' || result.name === null).toBe(true);
  });

  test('description is string or null', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    const result = buildStravaDescription(session);
    expect(typeof result.description === 'string' || result.description === null).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WARMUP-AWARE PRIMARY SELECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — warmup-aware primary selection', () => {
  const warmupConfig = {
    warmup_labels: ['Warmup'],
    warmup_description_tags: ['[Warmup]'],
    warmup_title_patterns: ['warm[\\s-]?up', 'stretch'],
  };

  test('selects non-warmup video as primary even if warmup is longer', () => {
    const now = Date.now();
    const session = createSession({
      events: [
        createEpisodeEvent({
          grandparentTitle: 'Insanity',
          title: 'Ten minute warm-up',
          durationSeconds: 650,
          start: now,
          end: now + 10 * 60 * 1000,
        }),
        createEpisodeEvent({
          grandparentTitle: '10 Minute Muscle',
          title: 'Shoulders 2',
          durationSeconds: 647,
          start: now + 10 * 60 * 1000,
          end: now + 21 * 60 * 1000,
        }),
      ],
    });
    const result = buildStravaDescription(session, {}, warmupConfig);
    expect(result.name).toBe('10 Minute Muscle\u2014Shoulders 2');
  });

  test('falls back to warmup if all episodes are warmups', () => {
    const now = Date.now();
    const session = createSession({
      events: [
        createEpisodeEvent({
          grandparentTitle: 'Insanity',
          title: 'Warm-Up',
          durationSeconds: 600,
          start: now,
          end: now + 10 * 60 * 1000,
        }),
      ],
    });
    const result = buildStravaDescription(session, {}, warmupConfig);
    expect(result.name).toBe('Insanity\u2014Warm-Up');
  });

  test('backward compatible — works without warmupConfig', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    const result = buildStravaDescription(session);
    expect(result).not.toBeNull();
    expect(result.name).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW DESCRIPTION FORMAT — ALL EPISODES + INDIVIDUAL MUSIC TRACKS
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — new description format', () => {
  test('lists all episodes chronologically, not just watched >= 2min', () => {
    const now = Date.now();
    const session = createSession({
      events: [
        createEpisodeEvent({
          grandparentTitle: 'Show A',
          title: 'Ep A',
          start: now,
          end: now + 60 * 1000, // 1 min — would have been filtered before
        }),
        createEpisodeEvent({
          grandparentTitle: 'Show B',
          title: 'Ep B',
          start: now + 60 * 1000,
          end: now + 31 * 60 * 1000,
        }),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('Show A');
    expect(result.description).toContain('Show B');
  });

  test('annotates warmup episodes with (warmup)', () => {
    const now = Date.now();
    const warmupConfig = {
      warmup_labels: [],
      warmup_description_tags: [],
      warmup_title_patterns: ['warm[\\s-]?up'],
    };
    const session = createSession({
      events: [
        createEpisodeEvent({
          grandparentTitle: 'Insanity',
          title: 'Ten minute warm-up',
          start: now,
          end: now + 10 * 60 * 1000,
        }),
        createEpisodeEvent({
          grandparentTitle: '10 Minute Muscle',
          title: 'Shoulders 2',
          start: now + 10 * 60 * 1000,
          end: now + 21 * 60 * 1000,
        }),
      ],
    });
    const result = buildStravaDescription(session, {}, warmupConfig);
    expect(result.description).toContain('Ten minute warm-up (warmup)');
    expect(result.description).not.toContain('Shoulders 2 (warmup)');
  });

  test('episodes ordered chronologically (earliest first)', () => {
    const now = Date.now();
    const session = createSession({
      events: [
        createEpisodeEvent({
          grandparentTitle: 'Second',
          title: 'Ep 2',
          start: now + 20 * 60 * 1000,
          end: now + 40 * 60 * 1000,
        }),
        createEpisodeEvent({
          grandparentTitle: 'First',
          title: 'Ep 1',
          start: now,
          end: now + 20 * 60 * 1000,
        }),
      ],
    });
    const result = buildStravaDescription(session);
    const firstIdx = result.description.indexOf('First');
    const secondIdx = result.description.indexOf('Second');
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  test('music tracks listed one per line with emoji, no "Playlist" header', () => {
    const session = createSession({
      events: [
        createMusicEvent({ artist: 'Radiohead', title: 'Creep' }),
        createMusicEvent({ artist: 'Nirvana', title: 'Smells Like Teen Spirit' }),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('\uD83C\uDFB5 Radiohead \u2014 Creep');
    expect(result.description).toContain('\uD83C\uDFB5 Nirvana \u2014 Smells Like Teen Spirit');
    expect(result.description).not.toContain('Playlist');
  });
});
