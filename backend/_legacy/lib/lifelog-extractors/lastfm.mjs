/**
 * Last.fm Scrobbles Lifelog Extractor
 * 
 * Extracts music listening history from lastfm.yml
 * Structure: Array with 'date' string field (formatted timestamp)
 * 
 * Note: Last.fm stores timestamps in UTC. We convert them to America/Denver (user's local timezone)
 * when extracting for a specific date to ensure scrobbles are grouped by local date, not UTC date.
 */

import moment from 'moment-timezone';

// User's local timezone
const USER_TIMEZONE = 'America/Denver';

export const lastfmExtractor = {
  source: 'lastfm',
  category: 'music',
  filename: 'lastfm',
  
  /**
   * Extract scrobbles for a specific date
   * @param {Array} data - Full lastfm.yml data (array)
   * @param {string} date - Target date 'YYYY-MM-DD' in user's local timezone
   * @returns {Array|null} Array of scrobbles or null
   */
  extractForDate(data, date) {
    if (!Array.isArray(data)) return null;
    
    // Filter scrobbles by local date (convert Unix timestamp to user timezone)
    const items = data.filter(scrobble => {
      // Convert Unix timestamp to user's local date
      const scrobbleDate = moment.unix(scrobble.timestamp).tz(USER_TIMEZONE).format('YYYY-MM-DD');
      return scrobbleDate === date;
    }).map(scrobble => ({
      time: moment.unix(scrobble.timestamp).tz(USER_TIMEZONE).format('h:mm A'),
      artist: scrobble.artist,
      title: scrobble.title,
      album: scrobble.album,
      timestamp: scrobble.timestamp
    }));
    
    return items.length ? items : null;
  },

  /**
   * Format extracted data as human-readable summary
   * @param {Array} entries - Extracted scrobbles
   * @returns {string|null} Formatted summary or null
   */
  summarize(entries) {
    if (!entries?.length) return null;
    
    // Calculate overall stats
    const uniqueArtists = [...new Set(entries.map(e => e.artist))];
    const uniqueAlbums = [...new Set(entries.map(e => e.album).filter(Boolean))];
    
    const lines = [
      `MUSIC LISTENING (${entries.length} tracks, ${uniqueArtists.length} artists, ${uniqueAlbums.length} albums):`
    ];
    
    // Identify listening sessions (1hr+ silence gaps)
    const sessions = identifyListeningSessions(entries);
    
    if (sessions.length > 0) {
      lines.push(`  Found ${sessions.length} listening session${sessions.length > 1 ? 's' : ''}:`);
      lines.push('');
      
      sessions.forEach((session, idx) => {
        const sessionNum = idx + 1;
        const duration = Math.round((session.end - session.start) / 60); // minutes
        const timeOfDay = getTimeOfDay(session.start);
        
        lines.push(`  Session ${sessionNum} (${timeOfDay}, ${session.tracks.length} tracks, ${duration} min):`);
        lines.push(`    Started: ${session.firstTrack.time} - ${session.firstTrack.artist} - "${session.firstTrack.title}"`);
        
        // Add ~3 middle tracks (randomly sampled) if session has more than 2 tracks
        if (session.tracks.length > 2) {
          const middleTracks = session.tracks.slice(1, -1); // Exclude first and last
          const sampleCount = Math.min(3, middleTracks.length);
          const sampled = sampleRandom(middleTracks, sampleCount);
          sampled.forEach(track => {
            lines.push(`    Middle: ${track.time} - ${track.artist} - "${track.title}"`);
          });
        }
        
        lines.push(`    Ended: ${session.lastTrack.time} - ${session.lastTrack.artist} - "${session.lastTrack.title}"`);
        
        // Session top artists
        const topArtists = getTopArtists(session.tracks, 3);
        if (topArtists.length > 0) {
          lines.push(`    Top artists: ${topArtists.map(a => `${a.name} (${a.count})`).join(', ')}`);
        }
        
        // Session top albums (if diverse)
        const sessionAlbums = [...new Set(session.tracks.map(t => t.album).filter(Boolean))];
        if (sessionAlbums.length > 1) {
          const topAlbums = getTopAlbums(session.tracks, 2);
          lines.push(`    Top albums: ${topAlbums.map(a => `"${a.name}"`).join(', ')}`);
        }
        
        lines.push('');
      });
    } else {
      // Fallback if no sessions (single tracks scattered)
      lines.push(`  Scattered tracks throughout the day:`);
      entries.slice(0, 5).forEach(track => {
        lines.push(`    - ${track.time}: ${track.artist} - "${track.title}"`);
      });
    }
    
    return lines.join('\n');
  }
};

/**
 * Identify listening sessions (separated by 1hr+ gaps)
 * Tracks must be in reverse chronological order (newest first)
 */
function identifyListeningSessions(entries) {
  if (!entries || entries.length === 0) return [];
  
  const sessions = [];
  let currentSession = null;
  const SESSION_GAP_SECONDS = 3600; // 1 hour
  
  // Process in chronological order (oldest to newest)
  const chronological = [...entries].reverse();
  
  for (let i = 0; i < chronological.length; i++) {
    const track = chronological[i];
    const trackTime = track.timestamp;
    
    // Start a new session if:
    // 1. This is the first track
    // 2. Gap from last track > 1 hour
    if (!currentSession || (trackTime - currentSession.end > SESSION_GAP_SECONDS)) {
      if (currentSession) {
        sessions.push(currentSession);
      }
      
      currentSession = {
        start: trackTime,
        end: trackTime,
        tracks: [track],
        firstTrack: track,
        lastTrack: track
      };
    } else {
      // Add to current session
      currentSession.tracks.push(track);
      currentSession.end = trackTime;
      currentSession.lastTrack = track;
    }
  }
  
  // Don't forget the last session
  if (currentSession) {
    sessions.push(currentSession);
  }
  
  return sessions;
}

/**
 * Get time of day label for a timestamp
 */
function getTimeOfDay(timestamp) {
  const hour = moment.unix(timestamp).tz(USER_TIMEZONE).hour();
  
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/**
 * Get top N artists by play count
 */
function getTopArtists(entries, limit = 3) {
  const artistCounts = {};
  entries.forEach(e => {
    artistCounts[e.artist] = (artistCounts[e.artist] || 0) + 1;
  });
  
  return Object.entries(artistCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Get top N albums by play count
 */
function getTopAlbums(entries, limit = 3) {
  const albumCounts = {};
  entries.forEach(e => {
    if (e.album) {
      const key = `${e.album}|${e.artist}`;
      albumCounts[key] = (albumCounts[key] || 0) + 1;
    }
  });
  
  return Object.entries(albumCounts)
    .map(([key, count]) => {
      const [name, artist] = key.split('|');
      return { name, artist, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Randomly sample N items from an array
 */
function sampleRandom(arr, count) {
  if (arr.length <= count) return arr;
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Analyze listening sessions (morning, afternoon, evening)
 */
function analyzeListeningSessions(entries) {
  const sessions = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  
  entries.forEach(e => {
    const hour = moment.unix(e.timestamp).tz(USER_TIMEZONE).hour();
    if (hour >= 5 && hour < 12) sessions.morning++;
    else if (hour >= 12 && hour < 17) sessions.afternoon++;
    else if (hour >= 17 && hour < 22) sessions.evening++;
    else sessions.night++;
  });
  
  const parts = [];
  if (sessions.morning > 0) parts.push(`${sessions.morning} tracks in morning`);
  if (sessions.afternoon > 0) parts.push(`${sessions.afternoon} in afternoon`);
  if (sessions.evening > 0) parts.push(`${sessions.evening} in evening`);
  if (sessions.night > 0) parts.push(`${sessions.night} at night`);
  
  return parts;
}

/**
 * Get sample tracks evenly distributed throughout the day
 */
function getSampleTracks(entries, count = 5) {
  if (entries.length <= count) return entries;
  
  const step = Math.floor(entries.length / count);
  const samples = [];
  
  for (let i = 0; i < count; i++) {
    const index = Math.min(i * step, entries.length - 1);
    samples.push(entries[entries.length - 1 - index]); // Reverse order for chronological
  }
  
  return samples;
}

export default lastfmExtractor;
