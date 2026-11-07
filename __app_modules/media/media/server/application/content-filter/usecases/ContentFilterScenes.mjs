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
import { mergeProfilePatch, applySettingsToProfile, profilePatchFromSettings, LEVELS, LANGUAGE_VALUES } from '../../../../../../../shared/contracts/content-filter/filterSettings.mjs';
import { mapTime } from '../../../../../../../shared/contracts/content-filter/syncMap.mjs';

export const CARD_MAX_CHARS = 90;
const EFFECTS = new Set(['off', 'blackout', 'skip']);
const CUE_EFFECTS = new Set(['mute', 'bleep', 'blur', 'full-blur', 'skip']);

export const CARD_SYSTEM = `You write the one-line title card a family movie filter shows a child in place of a scene it hid or skipped.
Rules: one sentence, at most ${CARD_MAX_CHARS} characters, plain words a 7-year-old can read.
Never describe what was hidden (no violence, injuries, nudity, or sexual detail).
Say what happened in the story only when the child needs it to follow along ("The Terminator escapes from the police station.").
If nothing story-relevant happened, write a neutral line ("The fight is over."). Reply with the sentence only.`;

export class ContentFilterScenes {
  #repo; #ai; #logger; #clock;
  #queues = new Map(); // ratingKey -> tail promise: one read-modify-write at a time per title

  /** Run fn after any earlier write for the same title (two Admin tabs must not clobber each other). */
  #serial(ratingKey, fn) {
    const prev = this.#queues.get(ratingKey) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.#queues.set(ratingKey, next);
    next.finally(() => { if (this.#queues.get(ratingKey) === next) this.#queues.delete(ratingKey); }).catch(() => {});
    return next;
  }

  constructor({ contentFilterRepository, aiGateway = null, logger = console, clock = () => new Date() } = {}) {
    if (!contentFilterRepository) throw new Error('ContentFilterScenes requires contentFilterRepository');
    this.#repo = contentFilterRepository;
    this.#ai = aiGateway;
    this.#logger = logger;
    this.#clock = clock;
  }

  async #load(ratingKey, profileName) {
    const raw = await this.#repo.getEdl(ratingKey);
    const ref = raw?.sourceRef;
    const refined = ref ? await this.#repo.getRefinedEdl({ workId: ref.workId, tagSetId: ref.tagSetId }) : null;
    if (!refined) return null;
    const [profile, override] = await Promise.all([this.#repo.getProfile(profileName), this.#repo.getOverride(ratingKey)]);
    return { ref, refined, profile: mergeProfilePatch(profile, override?.profilePatch), override: override || {} };
  }

  /** Validate the four plain settings; throws on anything outside the vocabulary. */
  static #checkSettings(settings) {
    if (!settings || typeof settings !== 'object') throw new Error('settings required');
    if (!LANGUAGE_VALUES.includes(settings.language)) throw new Error(`unknown language setting: ${settings.language}`);
    for (const k of ['violence', 'nudity', 'sexual']) if (!LEVELS.includes(settings[k])) throw new Error(`unknown ${k} setting: ${settings[k]}`);
  }

  /** This film only: store the settings as `override.profilePatch`. */
  async setTitleSettings({ ratingKey, settings }) {
    ContentFilterScenes.#checkSettings(settings);
    return this.#serial(ratingKey, async () => {
      const override = (await this.#repo.getOverride(ratingKey)) || { contentId: `plex:${ratingKey}` };
      const profilePatch = profilePatchFromSettings(settings);
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
    ContentFilterScenes.#checkSettings(settings);
    return this.#serial(`profile:${profileName}`, async () => {
      const profile = await this.#repo.getProfile(profileName);
      if (!profile) return null;
      const next = applySettingsToProfile(profile, settings);
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

  /** Builds the card prompt for a scene: tag labels plus the dialogue around it. */
  async #prompter(ratingKey, t) {
    const transcript = t.override.sync ? await this.#repo.getTranscript(ratingKey, t.override.sync.part) : null;
    const lines = (a, b) => {
      if (!transcript || !t.override.sync) return '';
      const fa = mapTime(a, t.override.sync); const fb = mapTime(b, t.override.sync);
      return transcript.segments.filter((s) => s.e >= fa && s.s <= fb).map((s) => String(s.text).trim()).join(' ');
    };
    const labels = new Map((t.refined.cues || []).map((c) => [c.id, c.label]));
    return (s) => [
      `Movie: ${t.refined.title}${t.refined.year ? ` (${t.refined.year})` : ''}`,
      `What the hidden scene contains (from content tags; do not repeat): ${s.cues.map((id) => labels.get(id)).filter(Boolean).join('; ')}`,
      `Said just before: ${lines(s.in - 30, s.in) || '(nothing)'}`,
      `Said during: ${lines(s.in, s.out) || '(nothing)'}`,
      `Said just after: ${lines(s.out, s.out + 30) || '(nothing)'}`,
    ].join('\n');
  }

  #ask(prompt) {
    return this.#ai.chat([{ role: 'system', content: CARD_SYSTEM }, { role: 'user', content: prompt }], {
      maxTokens: 80, temperature: 0.3, usageTags: { app: 'media', feature: 'content-filter-cards' },
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

  /** Rule one cue: effect off|mute|bleep|blur|full-blur|skip, 'profile' clears. */
  async ruleCue(args) {
    return this.#serial(args.ratingKey, async () => {
      const { ratingKey, cueId, effect, disabled } = args;
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
