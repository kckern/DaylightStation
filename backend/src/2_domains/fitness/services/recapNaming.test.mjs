import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlug, buildPlexMeta, primaryTitle, participantNames, recapDescription, sessionStart } from './recapNaming.mjs';

function espnSession() {
  return {
    sessionId: '20260629203200',
    session: { duration_seconds: 905 },
    participants: { 'device:10266': {}, felix: { display_name: 'Felix' }, milo: {} },
    summary: {
      media: [
        { showTitle: 'ESPN', mediaType: 'video', primary: null },
        { showTitle: 'Game Cycling', mediaType: 'video', primary: true }
      ]
    },
    strava_notes: { text: '🎙️ "We finished the Donkey Kong Cup."\n\n🖥️ Game Cycling' }
  };
}

test('primaryTitle honours the .primary flag over media order', () => {
  assert.equal(primaryTitle(espnSession()), 'Game Cycling');
});

test('participantNames title-cases bare slugs, excludes device:* ids', () => {
  assert.deepEqual(participantNames(espnSession()), ['Felix', 'Milo']);
});

test('participantNames uses resolveName when the session name is just the slug', () => {
  const data = { participants: { kckern: { display_name: 'kckern' }, felix: {} } };
  const resolve = (id) => ({ kckern: 'KC Kern' }[id] || id);
  assert.deepEqual(participantNames(data, resolve), ['KC Kern', 'Felix']);
});

test('buildSlug: {sessionId}_{Nm}_{users}_{video}', () => {
  assert.equal(buildSlug(espnSession()), '20260629203200_15m_felix-milo_game-cycling');
});

test('buildPlexMeta maps the full Plex episode tag set', () => {
  const m = buildPlexMeta(espnSession());
  assert.equal(m.title, 'Family Fitness - S2026E06292032 - Felix, Milo - Game Cycling');
  assert.equal(m.plexFileBase, 'Family Fitness - S2026E06292032 - Felix, Milo - Game Cycling');
  assert.equal(m.tags.show, 'Family Fitness');
  assert.equal(m.tags.episode_id, '06292032');
  assert.equal(m.tags.media_type, '10');
  // integer tvsn/tves atoms are intentionally omitted (ffmpeg byte-truncates them)
  assert.equal('season_number' in m.tags, false);
  assert.equal('episode_sort' in m.tags, false);
  assert.equal(m.epTag, 'S2026E06292032');
  assert.equal(m.tags.artist, 'Felix, Milo');
  assert.equal(m.tags.album, 'Game Cycling');
  assert.equal(m.tags.genre, 'Fitness');
  assert.equal(m.tags.date, '2026');
  assert.match(m.tags.description, /Donkey Kong Cup/);
});

test('sessionStart converts local wall time + tz to a UTC instant', () => {
  const s = sessionStart({ session: { start: '2026-06-19 16:37:12.696' }, timezone: 'America/Los_Angeles' });
  assert.equal(s.utcISO, '2026-06-19T23:37:12Z');          // PDT = UTC-7
  assert.equal(s.localWithOffset, '2026-06-19 16:37:12-07:00');
});

test('sessionStart falls back to sessionId (treated as UTC) when no session.start/tz', () => {
  const s = sessionStart({ sessionId: '20260629203200' });
  assert.equal(s.utcISO, '2026-06-29T20:32:00Z');
  assert.equal(s.offsetStr, 'Z');
});

test('buildPlexMeta sets creation_time to the session start instant', () => {
  const m = buildPlexMeta({ sessionId: '20260619163712', session: { start: '2026-06-19 16:37:12' }, timezone: 'America/Los_Angeles',
    summary: { media: [{ showTitle: 'X', primary: true }] } });
  assert.equal(m.tags.creation_time, '2026-06-19T23:37:12Z');
});

test('recapDescription falls back to voice-memo transcripts when no strava notes', () => {
  const data = { summary: { voiceMemos: [{ transcript: 'Great ride' }] } };
  assert.equal(recapDescription(data), '🎙️ "Great ride"');
});

test('plexFileBase strips filesystem-hostile characters', () => {
  const data = { sessionId: '20260101120000', participants: { kckern: {} },
    summary: { media: [{ showTitle: 'Yoga: Flow / Core', primary: true }] } };
  const m = buildPlexMeta(data);
  assert.equal(m.plexFileBase.includes('/'), false);
  assert.equal(m.plexFileBase.includes(':'), false);
});

test('blank metadata values are dropped (no empty -metadata)', () => {
  const data = { sessionId: '20260101120000', summary: { media: [{ showTitle: 'Yoga', primary: true }] } };
  const m = buildPlexMeta(data);
  assert.equal('comment' in m.tags, false);   // no notes/memos -> no description tags
  assert.equal('artist' in m.tags, false);    // no participants
});
