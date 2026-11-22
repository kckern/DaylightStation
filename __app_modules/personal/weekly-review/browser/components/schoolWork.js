// Shared wording for school work items (reel card, grid strip, context panel).
// Items never carry scores; nothing here reads or prints one.

const SUBJECT_GLYPHS = {
  reading: '📕',
  activity: '🧩',
  scripture: '✝️',
  language: '🔤',
};

export function subjectGlyph(subject) {
  return SUBJECT_GLYPHS[subject] || '✏️';
}

export function verbLabel(item) {
  switch (item?.verb) {
    case 'finished': return 'Finished';
    case 'started': return 'Started';
    case 'completed': return 'Completed';
    case 'worked': return item.kind === 'course' ? 'Worked on' : 'Practiced';
    default: return '';
  }
}

// "Thursday · 7:12 PM" from the item's ISO time, in local time.
export function workWhen(at) {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

export function kidStyle(color) {
  return color ? { '--kid': color } : undefined;
}
