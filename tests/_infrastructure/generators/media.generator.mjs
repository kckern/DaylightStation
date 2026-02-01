/**
 * Media data generator
 * Generates watchlist, watch history, and playlists
 */

import {
  USERS,
  getActiveUsers,
  randomInt,
  randomFloat,
  randomChoice,
  randomChoices,
  randomBool,
  formatDate,
  formatDateTime,
  addDays,
  subDays,
  today,
  uuid,
  shortId,
} from './utils.mjs';

// Sample movies (public domain classics + made-up titles)
const MOVIES = [
  { title: 'Nosferatu', year: 1922, genre: 'Horror', runtime: 94, rating: 7.9 },
  { title: 'The General', year: 1926, genre: 'Comedy', runtime: 67, rating: 8.1 },
  { title: 'Metropolis', year: 1927, genre: 'Sci-Fi', runtime: 153, rating: 8.3 },
  { title: 'The Kid', year: 1921, genre: 'Comedy', runtime: 68, rating: 8.3 },
  { title: 'Sherlock Jr.', year: 1924, genre: 'Comedy', runtime: 45, rating: 8.2 },
  { title: 'The Cabinet of Dr. Caligari', year: 1920, genre: 'Horror', runtime: 76, rating: 8.0 },
  { title: 'Safety Last!', year: 1923, genre: 'Comedy', runtime: 73, rating: 8.1 },
  { title: 'The Phantom of the Opera', year: 1925, genre: 'Horror', runtime: 93, rating: 7.6 },
  { title: 'Battleship Potemkin', year: 1925, genre: 'Drama', runtime: 75, rating: 8.0 },
  { title: 'The Gold Rush', year: 1925, genre: 'Comedy', runtime: 95, rating: 8.2 },
  { title: 'City Lights', year: 1931, genre: 'Comedy', runtime: 87, rating: 8.5 },
  { title: 'M', year: 1931, genre: 'Thriller', runtime: 117, rating: 8.3 },
  { title: 'Frankenstein', year: 1931, genre: 'Horror', runtime: 70, rating: 7.8 },
  { title: 'Dracula', year: 1931, genre: 'Horror', runtime: 75, rating: 7.4 },
  { title: 'Modern Times', year: 1936, genre: 'Comedy', runtime: 87, rating: 8.5 },
];

// Sample TV shows (made-up titles inspired by public domain concepts)
const TV_SHOWS = [
  { title: 'Tales from the Public Domain', seasons: 4, episodesPerSeason: 12, genre: 'Anthology', runtime: 42 },
  { title: 'Classic Cinema Hour', seasons: 2, episodesPerSeason: 10, genre: 'Documentary', runtime: 60 },
  { title: 'The Silent Era', seasons: 3, episodesPerSeason: 8, genre: 'Drama', runtime: 45 },
  { title: 'Vintage Mysteries', seasons: 5, episodesPerSeason: 10, genre: 'Mystery', runtime: 44 },
  { title: 'Old Hollywood', seasons: 2, episodesPerSeason: 6, genre: 'Documentary', runtime: 50 },
  { title: 'Gothic Tales', seasons: 3, episodesPerSeason: 10, genre: 'Horror', runtime: 42 },
  { title: 'Adventure Classics', seasons: 4, episodesPerSeason: 12, genre: 'Adventure', runtime: 48 },
  { title: 'Comedy Gold', seasons: 6, episodesPerSeason: 22, genre: 'Comedy', runtime: 30 },
];

// Sample music tracks (classical/public domain)
const MUSIC_TRACKS = [
  { title: 'Moonlight Sonata', artist: 'Ludwig van Beethoven', album: 'Piano Sonatas', duration: 360 },
  { title: 'The Four Seasons - Spring', artist: 'Antonio Vivaldi', album: 'The Four Seasons', duration: 210 },
  { title: 'Canon in D', artist: 'Johann Pachelbel', album: 'Baroque Classics', duration: 300 },
  { title: 'Clair de Lune', artist: 'Claude Debussy', album: 'Suite bergamasque', duration: 300 },
  { title: 'Ride of the Valkyries', artist: 'Richard Wagner', album: 'Die Walküre', duration: 315 },
  { title: 'Für Elise', artist: 'Ludwig van Beethoven', album: 'Bagatelles', duration: 180 },
  { title: 'Symphony No. 5', artist: 'Ludwig van Beethoven', album: 'Symphonies', duration: 420 },
  { title: 'Eine kleine Nachtmusik', artist: 'Wolfgang Amadeus Mozart', album: 'Serenades', duration: 330 },
  { title: 'The Blue Danube', artist: 'Johann Strauss II', album: 'Waltzes', duration: 600 },
  { title: 'Toccata and Fugue in D minor', artist: 'Johann Sebastian Bach', album: 'Organ Works', duration: 540 },
  { title: 'Bolero', artist: 'Maurice Ravel', album: 'Orchestral Works', duration: 900 },
  { title: 'Hungarian Rhapsody No. 2', artist: 'Franz Liszt', album: 'Hungarian Rhapsodies', duration: 600 },
];

// Workout playlists
const WORKOUT_PLAYLISTS = [
  { name: 'High Intensity Cardio', tracks: 8, description: 'Upbeat tracks for cardio sessions' },
  { name: 'Strength Training', tracks: 10, description: 'Power tracks for lifting' },
  { name: 'Yoga Flow', tracks: 6, description: 'Calm tracks for yoga and stretching' },
  { name: 'Morning Warmup', tracks: 5, description: 'Energizing tracks to start the day' },
  { name: 'Cool Down', tracks: 4, description: 'Relaxing tracks for post-workout' },
];

/**
 * Generate watchlist with movies and TV shows
 */
export function generateWatchlist() {
  const items = [];

  // Add random movies to watchlist
  const movieCount = randomInt(5, 10);
  const selectedMovies = randomChoices(MOVIES, movieCount);
  for (const movie of selectedMovies) {
    items.push({
      id: `wl-${shortId()}`,
      type: 'movie',
      title: movie.title,
      year: movie.year,
      genre: movie.genre,
      runtime: movie.runtime,
      rating: movie.rating,
      addedBy: randomChoice(getActiveUsers()).id,
      addedAt: formatDate(subDays(today(), randomInt(1, 60))),
      priority: randomChoice(['high', 'medium', 'low', 'low', 'medium']),
    });
  }

  // Add random TV shows to watchlist
  const showCount = randomInt(3, 6);
  const selectedShows = randomChoices(TV_SHOWS, showCount);
  for (const show of selectedShows) {
    items.push({
      id: `wl-${shortId()}`,
      type: 'tv_show',
      title: show.title,
      seasons: show.seasons,
      episodesPerSeason: show.episodesPerSeason,
      genre: show.genre,
      runtime: show.runtime,
      addedBy: randomChoice(getActiveUsers()).id,
      addedAt: formatDate(subDays(today(), randomInt(1, 90))),
      priority: randomChoice(['high', 'medium', 'low']),
      progress: {
        season: randomInt(1, Math.min(2, show.seasons)),
        episode: randomInt(1, show.episodesPerSeason),
      },
    });
  }

  // Sort by priority then date
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => {
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    return b.addedAt.localeCompare(a.addedAt);
  });

  return { items };
}

/**
 * Generate watch history
 */
export function generateWatchHistory(days = 30) {
  const history = [];
  const users = getActiveUsers();

  for (let i = 0; i < days; i++) {
    const date = subDays(today(), i);

    // 60% chance of watching something each day
    if (randomBool(0.6)) {
      const watchCount = randomInt(1, 3);

      for (let j = 0; j < watchCount; j++) {
        const user = randomChoice(users);
        const isMovie = randomBool(0.4);

        if (isMovie) {
          const movie = randomChoice(MOVIES);
          history.push({
            id: `wh-${shortId()}`,
            type: 'movie',
            title: movie.title,
            year: movie.year,
            genre: movie.genre,
            runtime: movie.runtime,
            watchedBy: user.id,
            watchedAt: formatDateTime(new Date(date.getTime() + randomInt(18, 23) * 3600000)),
            completed: randomBool(0.85),
            progressMinutes: randomBool(0.85) ? movie.runtime : randomInt(10, movie.runtime - 10),
          });
        } else {
          const show = randomChoice(TV_SHOWS);
          const season = randomInt(1, show.seasons);
          const episode = randomInt(1, show.episodesPerSeason);
          history.push({
            id: `wh-${shortId()}`,
            type: 'tv_episode',
            showTitle: show.title,
            season,
            episode,
            episodeTitle: `Episode ${episode}`,
            genre: show.genre,
            runtime: show.runtime,
            watchedBy: user.id,
            watchedAt: formatDateTime(new Date(date.getTime() + randomInt(18, 23) * 3600000)),
            completed: randomBool(0.9),
            progressMinutes: randomBool(0.9) ? show.runtime : randomInt(5, show.runtime - 5),
          });
        }
      }
    }
  }

  // Sort by watch date descending
  history.sort((a, b) => b.watchedAt.localeCompare(a.watchedAt));

  return { history };
}

/**
 * Generate media menu (currently playing/recommended)
 */
export function generateMediaMenu() {
  const continueWatching = [];
  const recommended = [];
  const users = getActiveUsers();

  // Continue watching - partially watched items
  for (const user of users.slice(0, 3)) {
    if (randomBool(0.7)) {
      const show = randomChoice(TV_SHOWS);
      continueWatching.push({
        id: `cw-${shortId()}`,
        type: 'tv_show',
        title: show.title,
        userId: user.id,
        progress: {
          season: randomInt(1, show.seasons),
          episode: randomInt(1, show.episodesPerSeason),
          progressPercent: randomInt(10, 90),
        },
        lastWatched: formatDate(subDays(today(), randomInt(0, 7))),
      });
    }
  }

  // Recommended items
  const recMovies = randomChoices(MOVIES, 5);
  for (const movie of recMovies) {
    recommended.push({
      id: `rec-${shortId()}`,
      type: 'movie',
      title: movie.title,
      year: movie.year,
      genre: movie.genre,
      rating: movie.rating,
      reason: randomChoice([
        'Because you watched similar titles',
        'Popular this week',
        'Top rated classic',
        'New to the library',
      ]),
    });
  }

  return {
    continueWatching,
    recommended,
    lastUpdated: formatDateTime(new Date()),
  };
}

/**
 * Generate music playlists
 */
export function generatePlaylists() {
  const playlists = [];

  for (const template of WORKOUT_PLAYLISTS) {
    const tracks = randomChoices(MUSIC_TRACKS, template.tracks, true);
    playlists.push({
      id: `pl-${shortId()}`,
      name: template.name,
      description: template.description,
      createdBy: 'popeye', // Fitness user creates workout playlists
      tracks: tracks.map((track, idx) => ({
        position: idx + 1,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
      })),
      totalDuration: tracks.reduce((sum, t) => sum + t.duration, 0),
      createdAt: formatDate(subDays(today(), randomInt(30, 180))),
    });
  }

  // Add a personal playlist for betty (music lover)
  const bettyTracks = randomChoices(MUSIC_TRACKS, 12, true);
  playlists.push({
    id: `pl-${shortId()}`,
    name: 'My Favorites',
    description: 'Personal collection of favorite classical pieces',
    createdBy: 'betty',
    tracks: bettyTracks.map((track, idx) => ({
      position: idx + 1,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
    })),
    totalDuration: bettyTracks.reduce((sum, t) => sum + t.duration, 0),
    createdAt: formatDate(subDays(today(), randomInt(60, 365))),
  });

  return { playlists };
}

/**
 * Generate gratitude entries
 */
export function generateGratitudeEntries(days = 30) {
  const entries = [];
  const users = getActiveUsers();

  const gratitudeItems = [
    'Good health',
    'Supportive family',
    'Beautiful weather',
    'A good workout',
    'Delicious meal',
    'Time with friends',
    'Quiet morning',
    'Productive day',
    'Restful sleep',
    'Learning something new',
    'Music that moves me',
    'Nature walk',
    'Comfortable home',
    'Good book',
    'Laughter',
    'Fresh coffee',
    'Sunny day',
    'Cozy evening',
    'Achievement at work',
    'Helping someone',
  ];

  for (let i = 0; i < days; i++) {
    const date = subDays(today(), i);

    // Each user has 50% chance of logging gratitude each day
    for (const user of users) {
      if (randomBool(0.5)) {
        const numItems = randomInt(1, 4);
        entries.push({
          id: `gr-${shortId()}`,
          userId: user.id,
          date: formatDate(date),
          items: randomChoices(gratitudeItems, numItems),
          createdAt: formatDateTime(new Date(date.getTime() + randomInt(19, 22) * 3600000)),
        });
      }
    }
  }

  // Sort by date descending
  entries.sort((a, b) => b.date.localeCompare(a.date));

  return { entries };
}
