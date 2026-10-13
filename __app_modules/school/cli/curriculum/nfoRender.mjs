// cli/curriculum/nfoRender.mjs — pure NFO full-parse + canonical render (no I/O).
const unesc = (s) => (s == null ? s : s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/'/g, '&#39;').replace(/"/g, '&quot;');
const one = (xml, el) => { const m = xml.match(new RegExp(`<${el}>([\\s\\S]*?)</${el}>`)); return m ? unesc(m[1].trim()) : null; };
const tagVals = (xml, key) => { const re = new RegExp(`<tag>${key}:\\s*([^<]+)</tag>`, 'g'); const out = []; let m; while ((m = re.exec(xml))) out.push(unesc(m[1].trim())); return out; };

export function parseNfoFull(xml) {
  const genres = [...xml.matchAll(/<genre>([^<]+)<\/genre>/g)].map((m) => unesc(m[1].trim()));
  const wm = xml.match(/<uniqueid[^>]*type="wistia"[^>]*>([^<]+)<\/uniqueid>/);
  return {
    showtitle: one(xml, 'showtitle'), plot: one(xml, 'plot'), genres,
    skill: tagVals(xml, 'Skill Level')[0] || null,
    focus: tagVals(xml, 'Focus'),
    type: tagVals(xml, 'Type')[0] || null,
    credits: one(xml, 'credits'), studio: one(xml, 'studio'),
    wistia: wm ? wm[1].trim() : null,
    wistiaDefault: wm ? /default="true"/.test(wm[0]) : false,
  };
}

export function renderNfo(f) {
  if (f.title == null || f.title === '') throw new Error('renderNfo: missing title');
  if (!Number.isFinite(Number(f.season)) || !Number.isFinite(Number(f.episode))) throw new Error(`renderNfo: non-finite season/episode (${f.season}/${f.episode})`);
  const L = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<episodedetails>'];
  const line = (el, v) => { if (v != null && v !== '') L.push(`  <${el}>${esc(v)}</${el}>`); };
  const tag = (k, v) => { if (v != null && v !== '') L.push(`  <tag>${esc(k)}: ${esc(v)}</tag>`); };
  line('title', f.title);
  line('showtitle', f.showtitle);
  L.push(`  <season>${Number(f.season)}</season>`);
  L.push(`  <episode>${Number(f.episode)}</episode>`);
  line('plot', f.plot);
  for (const g of f.genres || []) line('genre', g);
  tag('Course', f.course);
  if (f.part != null) tag('Part', f.part);
  tag('Lane', f.lane);
  tag('Group', f.group);
  tag('Song', f.song);
  tag('Treatment', f.treatment);
  if (f.skillChallenge) L.push('  <tag>SkillChallenge: true</tag>');
  tag('Skill Level', f.skill);
  for (const x of f.focus || []) tag('Focus', x);
  tag('Type', f.type);
  line('credits', f.credits);
  line('studio', f.studio);
  if (f.wistia) L.push(`  <uniqueid type="wistia"${f.wistiaDefault ? ' default="true"' : ''}>${esc(f.wistia)}</uniqueid>`);
  L.push('</episodedetails>');
  return L.join('\n') + '\n';
}
