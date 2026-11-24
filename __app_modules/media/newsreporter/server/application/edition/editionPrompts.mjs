/**
 * Prompts for the two model steps of an edition (pure). The shapes asked for
 * here are the zod contracts in editionContracts.mjs.
 */

const clip = (text, n) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/**
 * Paper length → words. Body copy sets ~27 words per cm of paper at 22 px;
 * the masthead, day box, headlines, bars and notes take roughly 16 cm
 * whatever the news, so the rest is the word budget.
 */
export function wordBudget(targetCm) {
  return Math.max(250, Math.round((targetCm - 16) * 24));
}

export function buildPickMessages({ cfg, candidates, date }) {
  const categories = cfg.news.categories.map((c) => ({
    id: c.id,
    label: c.label,
    topic: c.topic || null,
    stories: c.stories,
    ...(c.sources ? { only_sources: c.sources } : {}),
    ...(c.exclude ? { never_sources: c.exclude } : {}),
    ...(c.balance === 'lean' ? { balance: 'pick coverage that spans the grid columns (col), so no one side of the outlet grid dominates' } : {}),
  }));
  const rows = candidates.map((c) => [c.id, c.sourceId, c.sourceLabel, c.col, c.clusterId ? 'multi' : '', clip(c.title, 140), clip(c.desc, 160)]);
  const system = [
    `You are the front-page editor of "${cfg.title}", a one-page printed morning paper for ${date}.`,
    'From the candidate headlines, choose the stories for each category. A story is a group of',
    'candidate ids that report the SAME event (several outlets on one event make one story).',
    'Prefer events covered by several outlets and events that matter for the day ahead.',
    'Use only candidate ids. Each id may be used once. Respect only_sources/never_sources.',
    `Give each category at most its "stories" count, ranked 1 = most important.${cfg.news.lead.enabled ? ' Also choose ONE lead story (the most important event of the day) — its ids must not repeat in a category.' : ''}`,
    'Reply with ONLY this JSON:',
    '{ "lead": { "ids": ["h1","h7"] }, "categories": [ { "id": "<category id>", "stories": [ { "ids": ["h3"], "rank": 1 } ] } ] }',
  ].join('\n');
  const user = JSON.stringify({
    categories,
    candidate_columns: ['id', 'source_id', 'source', 'col', 'cluster', 'title', 'blurb'],
    candidates: rows,
  });
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/**
 * @param {object} args
 * @param {object} args.cfg
 * @param {string} args.date
 * @param {Array} args.groups - [{ key, category, label, rank, lead, thin, items: [{ id, source, title, blurb }], texts: [{ source, text }] }]
 * @param {object} args.dayFacts - module → facts (only modules on the page that want words)
 */
export function buildWriteMessages({ cfg, date, groups, dayFacts }) {
  const budget = wordBudget(cfg.length.target_cm);
  const units = groups.reduce((n, g) => n + (g.lead ? 2.5 : g.thin ? 0.6 : 1), 0) || 1;
  const perStory = Math.max(45, Math.round(budget / units));
  const leadWords = Math.round(perStory * 2.5);
  const system = [
    `You write "${cfg.title}", a one-page printed morning paper for ${date}.`,
    cfg.voice ? `Voice:\n${cfg.voice.trim()}` : null,
    'Rules:',
    '- Write ONLY from the supplied headlines, blurbs and article text. Never add facts, names or numbers that are not there.',
    '- When the outlets disagree, say who claims what, naming the outlet.',
    ...(cfg.family_safe?.enabled === false ? [] : ['- This is a family paper a child may read. Report war, crime and disasters plainly, without sexual, graphic or gory detail; never describe sexual content, abuse, or suicide or self-harm methods.']),
    '- Headlines are plain and specific, no clickbait, no "breaking", at most 11 words.',
    `- The lead body is about ${leadWords} words${cfg.news.lead.enabled ? ` (${cfg.news.lead.sentences} sentences or so)` : ''}; other stories about ${perStory} words; a story marked thin (headline and blurb only) gets one or two sentences.`,
    '- "sources" lists the outlet names you drew on, as given. "ids" are the candidate ids of the story, copied from the input.',
    '- Keep each story in the category it was given, and keep the given rank.',
    '- "briefs" is optional: up to 3 one-line items from the leftover headlines of the given stories, or [].',
    '- "day.notes": one short line per day module given (module = its key), plain and warm, no advice. "day.weather_note": one short line on the weather if there is something worth saying, else null.',
    'Reply with ONLY this JSON:',
    '{ "lead": { "headline": "", "body": "", "sources": [""], "ids": [""] },',
    '  "sections": [ { "category": "<id>", "label": "", "stories": [ { "headline": "", "body": "", "sources": [""], "ids": [""], "rank": 1 } ] } ],',
    '  "briefs": [ { "text": "", "source": "", "ids": [""] } ],',
    '  "day": { "weather_note": null, "notes": [ { "module": "", "label": "", "text": "" } ] } }',
  ].filter(Boolean).join('\n');
  const user = JSON.stringify({
    date,
    lead: groups.filter((g) => g.lead).map(groupPayload)[0] || null,
    sections: cfg.news.categories
      .map((c) => ({ category: c.id, label: c.label, stories: groups.filter((g) => !g.lead && g.category === c.id).map(groupPayload) }))
      .filter((s) => s.stories.length),
    day: dayFacts,
  });
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function groupPayload(g) {
  return {
    rank: g.rank,
    thin: g.thin,
    headlines: g.items.map((i) => ({ id: i.id, source: i.source, title: i.title, blurb: clip(i.blurb, 300) })),
    articles: g.texts.map((t) => ({ source: t.source, text: t.text })),
  };
}
