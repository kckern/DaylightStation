// Shared wording for school work items (reel card, grid strip, context panel).
// Items never carry scores; nothing here reads or prints one.

const SUBJECT_GLYPHS = {
  reading: '📕',
  activity: '🧩',
  scripture: '✝️',
  language: '🔤',
  music: '🎹',
};

export function subjectGlyph(subject) {
  return SUBJECT_GLYPHS[subject] || '✏️';
}

// Null for a verb this screen does not know; callers leave the label out.
export function verbLabel(item) {
  switch (item?.verb) {
    case 'finished': return 'Finished';
    case 'started': return 'Started';
    case 'completed': return 'Completed';
    case 'worked': return item.kind === 'course' ? 'Worked on' : 'Practiced';
    default: return null;
  }
}

// The weekday the work counts for ("Saturday"), from its study day. No clock
// time: kids don't need it, and items without a real time carry a noon-UTC
// placeholder that would read as early morning.
export function workDay(studyDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(studyDay || '')) return '';
  return new Date(`${studyDay}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

export function kidStyle(color) {
  return color ? { '--kid': color } : undefined;
}

// How big to set a work title so it fits about two lines of the text column:
// 'm' for most, 'l' and 'xl' step down for long ones (and allow a third line).
// Wide glyphs (Hangul, CJK, full-width) count double: they take about twice
// the width of a Latin letter in the condensed face.
const WIDE = /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff00-\uff60]/;
export function titleSize(title) {
  let width = 0;
  for (const ch of String(title || '')) width += WIDE.test(ch) ? 2 : 1;
  if (width <= 36) return 'm';
  if (width <= 64) return 'l';
  return 'xl';
}
