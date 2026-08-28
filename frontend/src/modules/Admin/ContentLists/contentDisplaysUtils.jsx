// frontend/src/modules/Admin/ContentLists/contentDisplaysUtils.jsx
//
// Type/source display metadata + pure helpers, split out of ContentDisplays.jsx
// (which keeps the display-mode card components) so Fast Refresh can
// hot-reload those components without a full remount.
import {
  IconMusic, IconDeviceTv, IconMovie, IconDeviceTvOld, IconStack2,
  IconUser, IconDisc, IconPhoto, IconPlaylist, IconFile, IconBook,
  IconList, IconMicrophone, IconVideo, IconFolder, IconFileText, IconSearch,
  IconBroadcast, IconPresentation, IconSchool, IconUsers, IconStack3,
  IconDeviceGamepad2,
} from '@tabler/icons-react';


// Types that represent containers (can be drilled into)
export const CONTAINER_TYPES = [
  'show', 'season', 'artist', 'album', 'collection', 'playlist', 'watchlist', 'container',
  'series', 'channel', 'conference', 'query', 'menu', 'program', 'console'
];

/**
 * Check if an item is a container that can be browsed into
 */
export function isContainerItem(item) {
  if (!item) return false;
  if (item.isContainer || item.itemType === 'container') return true;
  const type = item.type || item.metadata?.type;
  return CONTAINER_TYPES.includes(type);
}

// Type to icon mapping
const TYPE_ICONS = {
  track: IconMusic,
  episode: IconDeviceTv,
  movie: IconMovie,
  show: IconDeviceTvOld,
  season: IconStack2,
  artist: IconUser,
  album: IconDisc,
  image: IconPhoto,
  photo: IconPhoto,
  playlist: IconPlaylist,
  book: IconBook,
  // Custom types for DaylightStation
  watchlist: IconList,
  program: IconList,
  menu: IconList,
  query: IconSearch,
  talk: IconMicrophone,
  freshvideo: IconVideo,
  folder: IconFolder,
  container: IconFolder,
  media: IconFileText,
  audio: IconMusic,
  video: IconVideo,
  // Container types for talks/channels
  channel: IconBroadcast,
  series: IconStack3,
  conference: IconPresentation,
  course: IconSchool,
  meeting: IconUsers,
  collection: IconStack2,
  // Format-based icons (preferred over collection-specific)
  singalong: IconMusic,
  readalong: IconBook,
  chapter: IconBook,
  game: IconDeviceGamepad2,
  // Legacy collection names (backward compat)
  hymn: IconMusic,
  primary: IconMusic,
  scripture: IconBook,
  poem: IconFileText,
  default: IconFile
};

export function normalizeListSource(source) {
  return source === 'list' ? 'menu' : source;
}

// Source badge colors
export const SOURCE_COLORS = {
  plex: 'orange',
  immich: 'blue',
  abs: 'green',
  media: 'gray',
  watchlist: 'violet',
  query: 'cyan',
  menu: 'teal',
  program: 'teal',
  freshvideo: 'lime',
  canvas: 'yellow',
  talk: 'pink',
  'local-content': 'pink',
  list: 'violet',
  singalong: 'indigo',
  readalong: 'orange',
  hymn: 'indigo',
  primary: 'grape',
  app: 'teal',
  default: 'gray'
};

/**
 * Parse source prefix from raw input value
 * @param {string} input - Raw input like "plex:12345"
 * @returns {string} Source name uppercase or "UNKNOWN"
 */
export function parseSource(input) {
  if (!input) return 'UNKNOWN';
  const match = input.match(/^([a-z]+):/i);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}

export function getTypeIcon(type) {
  const Icon = TYPE_ICONS[type] || TYPE_ICONS.default;
  return <Icon size={14} />;
}

// Type labels for display
export const TYPE_LABELS = {
  track: 'Track',
  episode: 'Episode',
  movie: 'Movie',
  show: 'Show',
  season: 'Season',
  artist: 'Artist',
  album: 'Album',
  image: 'Image',
  photo: 'Photo',
  playlist: 'Playlist',
  book: 'Book',
  clip: 'Clip',
  // Custom types for DaylightStation
  watchlist: 'Watchlist',
  program: 'Program',
  menu: 'Menu',
  query: 'Query',
  talk: 'Talk',
  freshvideo: 'Video',
  folder: 'Folder',
  container: 'Container',
  media: 'Media',
  audio: 'Audio',
  video: 'Video',
  // Container types for talks/channels
  channel: 'Channel',
  series: 'Series',
  conference: 'Conference',
  course: 'Course',
  meeting: 'Meeting',
  collection: 'Collection',
  singalong: 'Song',
  readalong: 'Reading',
  chapter: 'Chapter',
  hymn: 'Hymn',
  primary: 'Primary',
  app: 'App'
};
