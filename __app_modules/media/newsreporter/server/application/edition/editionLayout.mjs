/**
 * Layout and fit (pure).
 *
 * `buildLayout` merges the code-owned blocks (masthead, weather, agenda,
 * tasks, footer) with the written ones into the layout contract the renderer
 * draws. Written stories keep `rank` and `ids`, and sections their
 * `category` / `optional`, so `fitLayout` can drop the right thing; the
 * renderer ignores those fields.
 *
 * `fitLayout` measures and, while the page is longer than `max_cm`, drops in
 * order: briefs; then the lowest-ranked story of the section with the most
 * stories (while one has more than one); then optional sections; then notes,
 * tasks and the last plain sections. Never the masthead, weather, agenda or
 * lead. A page that still does not fit is printed long, and says so.
 */
import { dateLabel } from './editionTime.mjs';

export const NEVER_DROP = Object.freeze(['weather', 'agenda', 'lead']);

const NOTE_LABEL = { yesterday: 'Yesterday', school: 'School', reflective: 'Today, again' };

/** A line per learner: "Sam 5 of 6 done, 3 silver". */
function schoolLine(facts) {
  return facts.learners.map((l) => `${l.child} ${l.served} of ${l.asked} done${l.silver ? `, ${l.silver} silver` : ''}`).join('. ');
}

/** The code's own words for a module, used when the writer gave none. */
function fallbackNote(name, facts) {
  if (name === 'yesterday') return facts.lines.map((l) => l.text).join('. ');
  if (name === 'school') return schoolLine(facts);
  if (name === 'reflective') return facts.text;
  return null;
}

/**
 * @param {object} args
 * @param {object} args.cfg - parsed edition config
 * @param {string} args.date
 * @param {number|null} args.number
 * @param {string[]} args.modules - modules on the page
 * @param {object} args.facts - module facts
 * @param {object} args.written - checked write output
 * @param {object} args.candidatesById - Map id → candidate (for source labels)
 * @param {string} args.composedLabel - "5:31 AM"
 * @param {number} args.headlineCount
 */
export function buildLayout({ cfg, date, number, modules, facts, written, composedLabel, headlineCount }) {
  const on = new Set(modules);
  const weather = on.has('weather') ? facts.weather : null;
  const blocks = [];

  if (weather) {
    blocks.push({
      type: 'weather',
      condition: weather.condition,
      high: weather.highF,
      low: weather.lowF,
      ...(weather.precipPct != null ? { precipPct: weather.precipPct } : {}),
      ...(written.day?.weather_note ? { note: written.day.weather_note } : {}),
    });
  }
  if (on.has('calendar')) blocks.push({ type: 'agenda', label: facts.calendar.today ? 'Today' : 'Coming up', items: facts.calendar.items.map(({ time, text }) => ({ time, text })) });
  if (on.has('todoist')) blocks.push({ type: 'tasks', label: 'To do', items: facts.todoist.items });

  if (written.lead) {
    blocks.push({ type: 'lead', headline: written.lead.headline, body: written.lead.body, sources: written.lead.sources, ids: written.lead.ids });
  }
  for (const category of cfg.news.categories) {
    const section = written.sections.find((s) => s.category === category.id);
    if (!section) continue;
    blocks.push({
      type: 'section',
      category: category.id,
      label: category.label,
      optional: !!category.optional,
      stories: [...section.stories].sort((a, b) => a.rank - b.rank)
        .map((s) => ({ headline: s.headline, body: s.body, sources: s.sources, ids: s.ids, rank: s.rank })),
    });
  }
  if (written.briefs?.length) {
    blocks.push({ type: 'briefs', label: 'In brief', items: written.briefs.map((b) => ({ text: b.text, source: b.source || null, ids: b.ids })) });
  }
  for (const name of ['yesterday', 'school', 'reflective']) {
    if (!on.has(name)) continue;
    const note = written.day?.notes?.find((n) => n.module === name);
    const text = note?.text || fallbackNote(name, facts[name]);
    if (!text) continue;
    const label = name === 'reflective' ? (facts.reflective?.label || NOTE_LABEL.reflective) : (note?.label || NOTE_LABEL[name]);
    blocks.push({ type: 'note', module: name, label, text });
  }
  const storyCount = blocks.reduce((n, b) => n + (b.type === 'lead' ? 1 : b.type === 'section' ? b.stories.length : 0), 0);
  blocks.push({ type: 'footer', text: `Composed ${composedLabel} from ${headlineCount} headlines · ${storyCount} stories` });

  return {
    masthead: {
      title: cfg.title,
      ...(cfg.tagline ? { tagline: cfg.tagline } : {}),
      dateLabel: dateLabel(date),
      number,
      ...(weather && weather.highF != null ? { weatherLabel: `${Math.round(weather.highF)}°/${Math.round(weather.lowF)}°` } : {}),
    },
    blocks,
  };
}

const clone = (layout) => JSON.parse(JSON.stringify(layout));

/** One drop step; returns a description, or null when nothing droppable is left. */
function dropOne(layout) {
  const blocks = layout.blocks;
  const briefs = blocks.find((b) => b.type === 'briefs');
  if (briefs) {
    if (briefs.items.length > 1) { const item = briefs.items.pop(); return { what: 'brief', text: item.text }; }
    blocks.splice(blocks.indexOf(briefs), 1);
    return { what: 'briefs' };
  }
  const sections = blocks.filter((b) => b.type === 'section');
  const longest = sections
    .filter((s) => s.stories.length > 1)
    .sort((a, b) => b.stories.length - a.stories.length
      || JSON.stringify(b.stories).length - JSON.stringify(a.stories).length)[0];
  if (longest) {
    const lowest = [...longest.stories].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))[0];
    longest.stories.splice(longest.stories.indexOf(lowest), 1);
    return { what: 'story', section: longest.label, headline: lowest.headline };
  }
  const optional = [...sections].reverse().find((s) => s.optional);
  if (optional) {
    blocks.splice(blocks.indexOf(optional), 1);
    return { what: 'section', section: optional.label, optional: true };
  }
  const note = [...blocks].reverse().find((b) => b.type === 'note');
  if (note) { blocks.splice(blocks.indexOf(note), 1); return { what: 'note', label: note.label }; }
  const tasks = blocks.find((b) => b.type === 'tasks');
  if (tasks) { blocks.splice(blocks.indexOf(tasks), 1); return { what: 'tasks' }; }
  if (sections.length > 1) {
    const last = sections[sections.length - 1];
    blocks.splice(blocks.indexOf(last), 1);
    return { what: 'section', section: last.label, optional: false };
  }
  return null;
}

/**
 * @param {object} layout
 * @param {(layout) => Promise<{ heightCm: number }>} measure
 * @param {number} maxCm
 * @returns {Promise<{ layout: object, heightCm: number, dropped: object[], overflow: boolean }>}
 */
export async function fitLayout(layout, measure, maxCm, { onDrop = null } = {}) {
  const working = clone(layout);
  const dropped = [];
  let { heightCm } = await measure(working);
  while (heightCm > maxCm) {
    const step = dropOne(working);
    if (!step) return { layout: working, heightCm, dropped, overflow: true };
    dropped.push(step);
    onDrop?.(step);
    // eslint-disable-next-line no-await-in-loop
    ({ heightCm } = await measure(working));
  }
  return { layout: working, heightCm, dropped, overflow: false };
}
