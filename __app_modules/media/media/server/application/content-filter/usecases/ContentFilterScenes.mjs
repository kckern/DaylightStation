/**
 * A title's scenes for the grown-up's review: list them with the effect the
 * household profile gives each, draft title-card text with an LLM, and record
 * the grown-up's rulings in the override (`sceneOverrides`).
 *
 * The refined EDL holds scenes and *draft* cards (a re-run may rewrite them);
 * the override holds the household's rulings, including the only card text a
 * child ever sees. Design: ops:docs/superpowers/specs/2026-11-06-content-filter-scenes-design.md
 */
import { trustedAxes, sceneEffect } from '../../../../../../../shared/contracts/content-filter/sceneEffect.mjs';
import { mergeProfilePatch, applySettingsToProfile, settingsFromProfile, profilePatchFromSettings, mergeSettings, LEVELS, LANGUAGE_VALUES, LANGUAGE_GROUPS } from '../../../../../../../shared/contracts/content-filter/filterSettings.mjs';
import { mapTime } from '../../../../../../../shared/contracts/content-filter/syncMap.mjs';
import { createTitleQueue } from '../titleQueue.mjs';

export const CARD_MAX_CHARS = 90;
const EFFECTS = new Set(['off', 'blackout', 'skip']);
const CUE_EFFECTS = new Set(['mute', 'bleep', 'blur', 'full-blur', 'skip']);

export const CARD_SYSTEM = `You write the one-line title card a family movie filter shows a child in place of a part of the film it skipped or hid.
The child must be able to keep following the story, so say what HAPPENS in the story during the skipped part: who does what, and how it turns out (use your knowledge of this film and the dialogue around the gap).
Name the characters. Never describe what was hidden: no violence detail, injuries, nudity, or sexual detail.
One sentence, at most ${CARD_MAX_CHARS} characters, plain words a 7-year-old can read. Not "The fight is over." or "The scene ends.": say the story beat.
Examples: "George stands up to Biff and knocks him down. Lorraine goes with George." / "The Terminator escapes from the police station."
Reply with the sentence only.`;

export class ContentFilterScenes {
  #repo; #ai; #logger; #clock; #queue;

  /** Run fn after any earlier write for the same title (two Admin tabs must not clobber each other). */
  #serial(ratingKey, fn) {
    return this.#queue.run(ratingKey, fn);
  }

  constructor({ contentFilterRepository, aiGateway = null, logger = console, clock = () => new Date(), titleQueue = createTitleQueue() } = {}) {
    if (!contentFilterRepository) throw new Error('ContentFilterScenes requires contentFilterRepository');
    this.#repo = contentFilterRepository;
    this.#ai = aiGateway;
    this.#logger = logger;
    this.#clock = clock;
    this.#queue = titleQueue;
  }

  async #load(ratingKey, profileName) {
    const raw = await this.#repo.getEdl(ratingKey);
    const ref = raw?.sourceRef;
    const refined = ref ? await this.#repo.getRefinedEdl({ workId: ref.workId, tagSetId: ref.tagSetId }) : null;
    if (!refined) return null;
    const [profile, override] = await Promise.all([this.#repo.getProfile(profileName), this.#repo.getOverride(ratingKey)]);
    return { ref, refined, profile: mergeProfilePatch(profile, override?.profilePatch), override: override || {} };
  }

  /** Validate a (partial) settings object; throws on anything outside the vocabulary. Returns only known keys. */
  static #checkSettings(settings) {
    if (!settings || typeof settings !== 'object') throw new Error('settings required');
    const out = {};
    if ('language' in settings) {
      const lang = settings.language;
      if (typeof lang === 'string') {
        // Legacy single value: sets every group.
        if (!LANGUAGE_VALUES.includes(lang)) throw new Error(`unknown language setting: ${lang}`);
        out.language = lang;
      } else if (lang && typeof lang === 'object') {
        out.language = {};
        for (const [g, v] of Object.entries(lang)) {
          if (!LANGUAGE_GROUPS.includes(g)) throw new Error(`unknown language group: ${g}`);
          if (!LANGUAGE_VALUES.includes(v)) throw new Error(`unknown language setting for ${g}: ${v}`);
          out.language[g] = v;
        }
      } else throw new Error(`unknown language setting: ${lang}`);
    }
    for (const k of ['violence', 'nudity', 'sexual']) {
      if (!(k in settings)) continue;
      if (!LEVELS.includes(settings[k])) throw new Error(`unknown ${k} setting: ${settings[k]}`);
      out[k] = settings[k];
    }
    return out;
  }

  /** This film only: store the settings as `override.profilePatch`. */
  async setTitleSettings({ ratingKey, settings, profileName = 'family' }) {
    const partial = ContentFilterScenes.#checkSettings(settings);
    return this.#serial(ratingKey, async () => {
      const override = (await this.#repo.getOverride(ratingKey)) || { contentId: `plex:${ratingKey}` };
      // Partial settings merge over this film's current effective settings.
      const effective = mergeProfilePatch(await this.#repo.getProfile(profileName), override.profilePatch);
      const profilePatch = profilePatchFromSettings(mergeSettings(settingsFromProfile(effective), partial));
      await this.#repo.saveOverride(ratingKey, { ...override, profilePatch });
      this.#logger.info?.('content-filter.settings.title', { ratingKey, settings });
      return { profilePatch };
    });
  }

  /** Back to the household settings for this film. */
  async clearTitleSettings({ ratingKey }) {
    return this.#serial(ratingKey, async () => {
      const override = await this.#repo.getOverride(ratingKey);
      if (!override || !('profilePatch' in override)) return { cleared: false };
      const { profilePatch: _gone, ...rest } = override;
      await this.#repo.saveOverride(ratingKey, rest);
      this.#logger.info?.('content-filter.settings.title-cleared', { ratingKey });
      return { cleared: true };
    });
  }

  /** Everywhere: rewrite only the keys the settings own in the household profile. @returns null if no such profile */
  async setProfileSettings({ profileName, settings }) {
    const partial = ContentFilterScenes.#checkSettings(settings);
    return this.#serial(`profile:${profileName}`, async () => {
      const profile = await this.#repo.getProfile(profileName);
      if (!profile) return null;
      // Partial settings merge over the stored (unmerged) household profile, never a film's patch.
      const next = applySettingsToProfile(profile, mergeSettings(settingsFromProfile(profile), partial));
      await this.#repo.saveProfile(profileName, next);
      this.#logger.info?.('content-filter.settings.profile', { profile: profileName, settings });
      return { profile: next };
    });
  }

  /** Titles with a refined filter, for the Admin index. */
  async titles({ profileName = 'family' } = {}) {
    const out = [];
    for (const ratingKey of await this.#repo.listOverrides()) {
      const t = await this.#load(ratingKey, profileName);
      if (!t) continue;
      const trusted = trustedAxes(t.refined);
      const ov = t.override.sceneOverrides || {};
      const scenes = t.refined.scenes || [];
      const hiding = scenes.filter((s) => sceneEffect(s, { profile: t.profile, sceneOverride: ov[s.id] || {}, trusted }));
      out.push({
        ratingKey, title: t.refined.title, year: t.refined.year ?? null,
        certification: t.refined.certification?.level ?? 'none',
        scenes: scenes.length, hiding: hiding.length,
        cardsApproved: hiding.filter((s) => ov[s.id]?.card?.text).length,
      });
    }
    return out.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  }

  /** @returns {Promise<null|{ title, calibration, scenes: Array }>} */
  async list({ ratingKey, profileName = 'family' }) {
    const t = await this.#load(ratingKey, profileName);
    if (!t) return null;
    const trusted = trustedAxes(t.refined);
    const labels = new Map((t.refined.cues || []).map((c) => [c.id, c.label]));
    const ov = t.override.sceneOverrides || {};
    return {
      title: t.refined.title,
      calibration: t.refined.sceneCalibration || {},
      scenes: (t.refined.scenes || []).map((s) => ({
        ...s,
        tags: s.cues.map((id) => labels.get(id)).filter(Boolean),
        profileEffect: sceneEffect(s, { profile: t.profile, trusted }),
        effect: sceneEffect(s, { profile: t.profile, sceneOverride: ov[s.id] || {}, trusted }),
        ruling: ov[s.id] || null,
        localIn: t.override.sync ? mapTime(s.in, t.override.sync) : null,
      })),
    };
  }

  /**
   * Draft card text for every scene that hides something (or all with `all`),
   * keeping drafts that exist unless `force`. Writes the refined EDL.
   */
  async draftCards(args) {
    if (!this.#ai) throw new Error('No AI gateway configured for title cards');
    return this.#serial(args.ratingKey, () => this.#draftCards(args));
  }

  async #draftCards({ ratingKey, profileName = 'family', all = false, force = false }) {
    const t = await this.#load(ratingKey, profileName);
    if (!t) return null;
    const trusted = trustedAxes(t.refined);
    const ov = t.override.sceneOverrides || {};
    const prompter = await this.#prompter(ratingKey, t);
    const at = this.#clock().toISOString().slice(0, 10);
    let drafted = 0;
    const scenes = [];
    for (const s of t.refined.scenes || []) {
      const wanted = all || sceneEffect(s, { profile: t.profile, sceneOverride: ov[s.id] || {}, trusted });
      if (!wanted || (s.card?.text && !force)) { scenes.push(s); continue; }
      let text;
      try {
        text = await this.#ask(prompter(s));
      } catch (error) {
        this.#logger.warn?.('content-filter.card.failed', { ratingKey, scene: s.id, error: error.message });
        scenes.push(s);
        continue;
      }
      const clean = cleanCard(text);
      if (!clean) { this.#logger.warn?.('content-filter.card.rejected', { ratingKey, scene: s.id, text }); scenes.push(s); continue; }
      scenes.push({ ...s, card: { text: clean, at } });
      drafted++;
    }
    await this.#repo.saveRefinedEdl(t.ref, { ...t.refined, scenes });
    this.#logger.info?.('content-filter.card.drafted', { ratingKey, drafted, scenes: scenes.length });
    return { drafted, scenes: scenes.length };
  }

  /** Dialogue between two reference-clock times, via this copy's sync ('' when there is none). */
  async #lineReader(ratingKey, t) {
    const transcript = t.override.sync ? await this.#repo.getTranscript(ratingKey, t.override.sync.part) : null;
    return (a, b) => {
      if (!transcript || !t.override.sync) return '';
      const fa = mapTime(a, t.override.sync); const fb = mapTime(b, t.override.sync);
      return transcript.segments.filter((s) => s.e >= fa && s.s <= fb).map((s) => String(s.text).trim()).join(' ');
    };
  }

  /** Card prompt for a span: what the tags say it holds plus the dialogue around it. */
  static #prompt(t, lines, tags, from, to) {
    return [
      `Movie: ${t.refined.title}${t.refined.year ? ` (${t.refined.year})` : ''}`,
      `What the hidden scene contains (from content tags; do not repeat): ${tags.filter(Boolean).join('; ')}`,
      `Said in the two minutes before: ${lines(from - 120, from) || '(nothing)'}`,
      `Said during: ${lines(from, to) || '(nothing)'}`,
      `Said in the minute after: ${lines(to, to + 60) || '(nothing)'}`,
    ].join('\n');
  }

  /** Builds the card prompt for a scene. */
  async #prompter(ratingKey, t) {
    const labels = new Map((t.refined.cues || []).map((c) => [c.id, c.label]));
    const lines = await this.#lineReader(ratingKey, t);
    return (s) => ContentFilterScenes.#prompt(t, lines, s.cues.map((id) => labels.get(id)), s.in, s.out);
  }

  #ask(prompt) {
    return this.#ai.chat([{ role: 'system', content: CARD_SYSTEM }, { role: 'user', content: prompt }], {
      maxTokens: 120, temperature: 0.3, usageTags: { app: 'media', feature: 'content-filter-cards' },
    });
  }

  /** Redraft the card for one scene (always). @returns {Promise<null|{ card: { text, at } }>} */
  async draftCard(args) {
    if (!this.#ai) throw new Error('No AI gateway configured for title cards');
    return this.#serial(args.ratingKey, async () => {
      const { ratingKey, sceneId, profileName = 'family' } = args;
      const t = await this.#load(ratingKey, profileName);
      const scene = t?.refined.scenes?.find((s) => s.id === sceneId);
      if (!scene) return null;
      const text = await this.#ask((await this.#prompter(ratingKey, t))(scene));
      const clean = cleanCard(text);
      if (!clean) throw new Error('the model returned an unusable card');
      const card = { text: clean, at: this.#clock().toISOString().slice(0, 10) };
      await this.#repo.saveRefinedEdl(t.ref, { ...t.refined, scenes: t.refined.scenes.map((x) => (x === scene ? { ...x, card } : x)) });
      this.#logger.info?.('content-filter.card.drafted', { ratingKey, scene: sceneId, drafted: 1 });
      return { card };
    });
  }

  /**
   * Draft card text for one cue (R5). The draft lives at `cueOverrides.<id>.cardDraft` in the
   * household override (a cue has no refined-EDL home) and never plays; approving it via
   * `ruleCue({ card: { approve: true } })` copies it to `card`.
   * @returns {Promise<null|{ cardDraft: { text, at } }>} null if the cue is unknown
   */
  async draftCueCard(args) {
    if (!this.#ai) throw new Error('No AI gateway configured for title cards');
    return this.#serial(args.ratingKey, async () => {
      const { ratingKey, cueId, profileName = 'family' } = args;
      const t = await this.#load(ratingKey, profileName);
      const cue = t?.refined.cues?.find((c) => c.id === cueId);
      if (!cue) return null;
      this.#logger.info?.('content-filter.cue-card.requested', { ratingKey, cue: cueId });
      try {
        const lines = await this.#lineReader(ratingKey, t);
        const from = cue.tagIn ?? cue.in; const to = cue.tagOut ?? cue.out ?? from;
        const clean = cleanCard(await this.#ask(ContentFilterScenes.#prompt(t, lines, [cue.label], from, to)));
        if (!clean) throw new Error('the model returned an unusable card');
        const cardDraft = { text: clean, at: this.#clock().toISOString().slice(0, 10) };
        const override = (await this.#repo.getOverride(ratingKey)) || { contentId: `plex:${ratingKey}` };
        const all = { ...(override.cueOverrides || {}) };
        all[cueId] = { ...(all[cueId] || {}), cardDraft };
        await this.#repo.saveOverride(ratingKey, { ...override, cueOverrides: all });
        this.#logger.info?.('content-filter.cue-card.drafted', { ratingKey, cue: cueId });
        return { cardDraft };
      } catch (error) {
        this.#logger.warn?.('content-filter.cue-card.failed', { ratingKey, cue: cueId, error: error.message });
        throw error;
      }
    });
  }

  /**
   * Rule one cue: effect off|mute|bleep|blur|full-blur|skip, 'profile' clears.
   * `card`: { approve: true, text? } approves (the cardDraft unless text is given); null withdraws
   * the card and keeps every other ruling.
   */
  async ruleCue(args) {
    return this.#serial(args.ratingKey, async () => {
      const { ratingKey, cueId, effect, disabled, card, by = 'admin' } = args;
      const raw = await this.#repo.getEdl(ratingKey);
      const ref = raw?.sourceRef;
      const refined = ref ? await this.#repo.getRefinedEdl({ workId: ref.workId, tagSetId: ref.tagSetId }) : null;
      if (!refined?.cues?.some((c) => c.id === cueId)) return null;
      const override = (await this.#repo.getOverride(ratingKey)) || { contentId: `plex:${ratingKey}` };
      const all = { ...(override.cueOverrides || {}) };
      const next = { ...(all[cueId] || {}) };
      if (effect !== undefined) {
        if (effect === 'profile' || effect === null) { delete next.effect; delete next.disabled; }
        else if (effect === 'off') { delete next.effect; next.disabled = true; }
        else if (CUE_EFFECTS.has(effect)) { next.effect = effect; delete next.disabled; }
        else throw new Error(`unknown cue effect: ${effect}`);
      }
      if (disabled !== undefined) { if (disabled) next.disabled = true; else delete next.disabled; }
      if (card !== undefined) {
        if (card === null) { delete next.card; this.#logger.info?.('content-filter.cue-card.withdrawn', { ratingKey, cue: cueId }); }
        else {
          const text = cleanCard(card.text ?? next.cardDraft?.text);
          if (!text) throw new Error('no card text to approve');
          next.card = { text, approvedBy: String(by), at: this.#clock().toISOString().slice(0, 10) };
          this.#logger.info?.('content-filter.cue-card.approved', { ratingKey, cue: cueId });
        }
      }
      if (Object.keys(next).length) all[cueId] = next; else delete all[cueId];
      await this.#repo.saveOverride(ratingKey, { ...override, cueOverrides: all });
      this.#logger.info?.('content-filter.cue.override', { ratingKey, cue: cueId, ruling: next });
      return next;
    });
  }

  /**
   * Record a grown-up's ruling. `effect`: 'profile' clears it, else off|blackout|skip.
   * `card`: { approve: true, text? } approves (the draft unless text is given); null clears.
   */
  async rule(args) {
    return this.#serial(args.ratingKey, () => this.#rule(args));
  }

  async #rule({ ratingKey, sceneId, effect, disabled, card, by = 'admin' }) {
    const raw = await this.#repo.getEdl(ratingKey);
    const ref = raw?.sourceRef;
    const refined = ref ? await this.#repo.getRefinedEdl({ workId: ref.workId, tagSetId: ref.tagSetId }) : null;
    const scene = refined?.scenes?.find((s) => s.id === sceneId);
    if (!scene) return null;
    const override = (await this.#repo.getOverride(ratingKey)) || { contentId: `plex:${ratingKey}` };
    const all = { ...(override.sceneOverrides || {}) };
    const next = { ...(all[sceneId] || {}) };
    if (effect !== undefined) {
      if (effect === 'profile' || effect === null) delete next.effect;
      else if (EFFECTS.has(effect)) next.effect = effect;
      else throw new Error(`unknown scene effect: ${effect}`);
    }
    if (disabled !== undefined) { if (disabled) next.disabled = true; else delete next.disabled; }
    if (card !== undefined) {
      if (card === null) delete next.card;
      else {
        const text = cleanCard(card.text ?? scene.card?.text);
        if (!text) throw new Error('no card text to approve');
        next.card = { text, approvedBy: String(by), at: this.#clock().toISOString().slice(0, 10) };
      }
    }
    if (Object.keys(next).length) all[sceneId] = next; else delete all[sceneId];
    await this.#repo.saveOverride(ratingKey, { ...override, sceneOverrides: all });
    this.#logger.info?.('content-filter.scene.override', { ratingKey, scene: sceneId, ruling: next });
    return next;
  }
}

/** One line, no quotes, within the length limit; null if unusable. */
export function cleanCard(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (!t || t.length > CARD_MAX_CHARS) return null;
  return t;
}

export default ContentFilterScenes;
