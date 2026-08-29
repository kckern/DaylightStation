const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_NAMES = 5;

export function formatPeopleList(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length <= MAX_NAMES) return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  const others = names.length - MAX_NAMES;
  return `${names.slice(0, MAX_NAMES).join(', ')}, and ${others} other${others === 1 ? '' : 's'}`;
}

function faceSortKey(face, orientation) {
  const cx = (Number(face.boundingBoxX1 ?? face.x1) + Number(face.boundingBoxX2 ?? face.x2)) / 2;
  const cy = (Number(face.boundingBoxY1 ?? face.y1) + Number(face.boundingBoxY2 ?? face.y2)) / 2;
  const w = Number(face.imageWidth) || 0;
  const h = Number(face.imageHeight) || 0;
  switch (Number(orientation)) {
    case 2: case 3: return w - cx;
    case 5: case 8: return cy;
    case 6: case 7: return h - cy;
    default: return cx;
  }
}

export function orderPeopleByFace(people, orientation) {
  const keyFor = (person) => {
    const faces = Array.isArray(person?.faces) ? person.faces : [];
    if (!faces.length) return null;
    return Math.min(...faces.map((face) => faceSortKey(face, orientation)));
  };
  return [...(people || [])]
    .map((person, index) => ({ person, index, key: keyFor(person) }))
    .sort((a, b) => {
      if (a.key == null && b.key == null) return a.index - b.index;
      if (a.key == null) return 1;
      if (b.key == null) return -1;
      return a.key - b.key || a.index - b.index;
    })
    .map(({ person }) => person);
}

export function getTimeOfDayLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hour = date.getUTCHours();
  if (hour < 6) return 'Late Night';
  if (hour < 9) return 'Morning';
  if (hour < 11) return 'Mid-Morning';
  if (hour < 13) return 'Lunchtime';
  if (hour < 17) return 'Afternoon';
  if (hour < 21) return 'Evening';
  return 'Night';
}

export function formatDayPeriod(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Memory';
  return `${DAYS_LONG[date.getUTCDay()]} ${getTimeOfDayLabel(iso)}`;
}

export function buildPhotoTitle(people, location, created) {
  const names = (people || []).filter((name) => name && name.trim());
  if (names.length > 0) return [formatPeopleList(names), location].filter(Boolean).join(' • ');
  if (location && created) {
    const period = getTimeOfDayLabel(created);
    return period ? `${period} in ${location}` : location;
  }
  if (location) return location;
  return created ? formatDayPeriod(created) : 'Memory';
}

export function formatPhotoDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Memory';
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const ampm = date.getUTCHours() >= 12 ? 'pm' : 'am';
  const hours = date.getUTCHours() % 12 || 12;
  return `${DAYS_SHORT[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}, ${date.getUTCFullYear()} ${hours}:${minutes}${ampm}`;
}
