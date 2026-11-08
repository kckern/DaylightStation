/**
 * railItems — the preview rail's model of a film's filter, in the units a parent
 * thinks in. Pure; the rail renders these.
 *
 * A MOMENT is one thing the filter does: one word, one blurred thing on screen,
 * one scene. Resolution splits a cue into pieces (a tracked blur is one piece per
 * keyframe), so pieces are folded by `unitKey` — the same key the summary and the
 * timeline legend count by, so all three agree.
 *
 * A moment belongs to one of three GROUPS the rail filters by:
 *   words   — muted or bleeped words
 *   picture — something on screen blurred, pixelated or barred
 *   scenes  — anything hidden or skipped, scene or lone moment
 */
import { kindOf, categoryText, effectWord } from './effectKinds.js';
import { unitKey } from '../filterSummary.js';
import { baseId } from '../contentFilter.js';

export const GROUPS = Object.freeze([
  { key: 'all', name: 'All', hint: 'Everything the filter changes' },
  { key: 'words', name: 'Words', hint: 'Words that are muted or bleeped' },
  { key: 'picture', name: 'Picture', hint: 'Things on screen that are blurred' },
  { key: 'scenes', name: 'Scenes', hint: 'Scenes and moments that are hidden or skipped' },
]);
export const GROUP_KEYS = ['words', 'picture', 'scenes'];

/** The rail group for a timeline kind. */
export const groupOfKind = (kind) => (kind === 'words' ? 'words' : kind === 'picture' ? 'picture' : 'scenes');

/** How strongly an effect changes the film, so a moment shows its strongest piece. */
const RANK = { mute: 1, bleep: 1, blur: 2, pixelate: 2, 'censor-bar': 2, 'full-blur': 3, 'title-card': 4, blackout: 4, black: 4, skip: 5, 'skip-card': 5 };

const SCENE_GROUP_NAME = {
  violence_blood_gore: 'Violence',
  sex_nudity_immodesty: 'Nudity',
  sex_any: 'Sexual content',
};

/** A scene's name from its groups: "Violence", "Nudity and sexual content". */
export function sceneName(scene) {
  if (scene?.label) return scene.label;
  const names = (scene?.groups || Object.keys(scene?.level || {})).map((g) => SCENE_GROUP_NAME[g]).filter(Boolean);
  if (!names.length) return 'Flagged scene';
  const lower = names.map((n, i) => (i ? n.toLowerCase() : n));
  const list = lower.length === 1 ? lower[0] : `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`;
  return `${list} scene`;
}

/** Plain words for the judged levels, per group (situation, then picture). */
const LEVEL_WORDS = {
  violence_blood_gore: {
    name: 'Violence',
    situation: ['incidental', 'peril or action', 'people hurt or killed', 'torture or cruel killing'],
    picture: ['nothing shown', 'mild on screen', 'injury shown', 'gore shown'],
  },
  sex_nudity_immodesty: {
    name: 'Nudity',
    situation: ['incidental', 'brief immodesty', 'nudity in the scene', 'the scene is about nudity'],
    picture: ['all clothed', 'partial undress', 'nudity visible', 'explicit nudity'],
  },
  sex_any: {
    name: 'Sexual content',
    situation: ['incidental', 'flirting or kissing', 'sexual situation implied', 'sexual content or assault'],
    picture: ['nothing shown', 'kissing on screen', 'implied on screen', 'shown on screen'],
  },
};
const pick = (list, n) => (Number.isFinite(n) ? list[Math.max(0, Math.min(list.length - 1, Math.round(n)))] : null);

/** One line per judged group: "Violence: people hurt or killed, mild on screen". */
export function levelLines(scene) {
  const out = [];
  for (const [g, lv] of Object.entries(scene?.level || {})) {
    const w = LEVEL_WORDS[g];
    if (!w || !lv) continue;
    const parts = [pick(w.situation, lv.situation), pick(w.picture, lv.picture)].filter(Boolean);
    if (parts.length) out.push(`${w.name}: ${parts.join(', ')}`);
  }
  return out;
}

/**
 * Fold effective cues into moments, in film order. Each:
 * { key, id, kind: 'scene'|'cue', group, effect, in, out, label, category, cue }
 * `cue` is the first piece (what a selection and a jump use); `id` is the scene
 * id or the base cue id (what rulings and peek use).
 */
export function buildMoments(cues, scenes) {
  const sceneById = new Map((scenes || []).map((s) => [String(s.id), s]));
  const byKey = new Map();
  const sorted = [...(cues || [])].filter((c) => Number.isFinite(c.in)).sort((a, b) => a.in - b.in);
  for (const c of sorted) {
    const key = unitKey(c);
    const m = byKey.get(key);
    const out = Number.isFinite(c.out) ? c.out : c.in;
    if (!m) {
      const isScene = c.scene != null;
      const scene = isScene ? sceneById.get(String(c.scene)) : null;
      byKey.set(key, {
        key,
        id: isScene ? String(c.scene) : baseId(c.id),
        kind: isScene ? 'scene' : 'cue',
        effect: c.effect,
        in: c.in,
        out,
        label: isScene ? sceneName(scene || { groups: [String(c.category || '').replace(/^scene\//, '').split('/')[0]] }) : (c.label || String(c.id)),
        category: c.category || null,
        scene: scene || null,
        cue: c,
      });
    } else {
      if (out > m.out) m.out = out;
      if ((RANK[c.effect] || 0) > (RANK[m.effect] || 0)) m.effect = c.effect;
    }
  }
  const list = [...byKey.values()];
  for (const m of list) m.group = groupOfKind(kindOf(m.effect));
  return list;
}

/** Moments per group, plus `all`. */
export function groupCounts(moments) {
  const n = { all: 0, words: 0, picture: 0, scenes: 0 };
  for (const m of moments || []) { n[m.group] += 1; n.all += 1; }
  return n;
}

/** The next `count` moments of `group` ('all' for any) that start after `position`. */
export function upcoming(moments, group, position, count = 5) {
  const out = [];
  for (const m of moments || []) {
    if (m.in <= position) continue;
    if (group !== 'all' && m.group !== group) continue;
    out.push(m);
    if (out.length >= count) break;
  }
  return out;
}

/** Per group: the next moment after `position` and how many more of it follow. */
export function nextOfEach(moments, position) {
  const res = {};
  for (const g of GROUP_KEYS) {
    const ahead = (moments || []).filter((m) => m.group === g && m.in > position);
    res[g] = { next: ahead[0] || null, after: Math.max(0, ahead.length - 1) };
  }
  return res;
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does `query` find this moment? Plain text in the label or its category, or a
 * word whose label is censored: "hell" finds "h*ll" (each * stands for a letter).
 */
export function matchesFind(m, query) {
  const q = norm(query);
  if (!q) return true;
  const label = norm(m.label);
  if (label.includes(q)) return true;
  if (norm(categoryText(m.category)).includes(q) || norm(effectWord(m.effect)).includes(q)) return true;
  if (label.includes('*')) {
    const pattern = new RegExp(`^${escape(label).replace(/\*/g, '[a-z]')}$`);
    if (q.split(/[^a-z']+/).some((w) => w && pattern.test(w))) return true;
  }
  return false;
}

/** Card status for a scene or a lone skip: 'approved' | 'draft' | 'none', and its text. */
export function cardOf(item, override) {
  if (item.kind === 'scene') {
    const ruling = override?.sceneOverrides?.[item.id] || {};
    if (ruling.card?.text) return { status: 'approved', text: ruling.card.text };
    const draft = item.scene?.card?.text;
    return draft ? { status: 'draft', text: draft } : { status: 'none', text: '' };
  }
  const ruling = override?.cueOverrides?.[item.id] || {};
  if (ruling.card?.text) return { status: 'approved', text: ruling.card.text };
  return ruling.cardDraft?.text ? { status: 'draft', text: ruling.cardDraft.text } : { status: 'none', text: '' };
}

/** Does this effect show a title card (so a card is worth writing)? */
export const takesCard = (effect) => ['skip', 'skip-card', 'title-card', 'blackout', 'black'].includes(effect);

/**
 * The Scenes view. `cut`: every scene or lone moment that is hidden or skipped, in
 * film order. `shown`: flagged scenes the filter lets play (their own moments
 * may still be blurred or muted), so a parent can choose to cut them.
 */
export function sceneRows(moments, scenes) {
  const cut = (moments || []).filter((m) => m.group === 'scenes');
  const cutIds = new Set(cut.filter((m) => m.kind === 'scene').map((m) => m.id));
  const shown = (scenes || [])
    .filter((s) => !cutIds.has(String(s.id)) && Number.isFinite(s.in))
    .map((s) => ({
      key: `scene:${s.id}`, id: String(s.id), kind: 'scene', group: 'scenes', effect: null,
      in: s.in, out: Number.isFinite(s.out) ? s.out : s.in, label: sceneName(s), category: null, scene: s, cue: null,
    }))
    .sort((a, b) => a.in - b.in);
  return { cut, shown };
}

/** The key a selection matches a moment by (timeline pieces and rail rows agree). */
export function selectionKey(sel) {
  if (!sel || sel.id == null) return null;
  if (sel.kind === 'scene') return `scene:${sel.id}`;
  return unitKey(sel);
}
