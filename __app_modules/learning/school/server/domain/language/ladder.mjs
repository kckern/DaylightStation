/**
 * The sentence ladder (design §1, §3). Pure: no I/O, no Date, no language codes.
 *
 * A sentence is seen four times, in four cognitive modes, on four different
 * days. This is the recovered 2016 design and is deliberately NOT SM-2 — there
 * are no ease factors and no intervals, because nothing here grades. A rung is
 * cleared by *doing* it, not by doing it well.
 *
 * Vendor-free and language-free by construction. The original app already
 * drove sentences from two unrelated suppliers up this same ladder, which is
 * why the supplier is an adapter concern. Likewise no rung names a language:
 * rungs are defined over ROLES — `source` is the language the learner already
 * has, `target` is the one being acquired — and the corpus binds those roles
 * to actual codes (`source: EN, target: KR`).
 *
 * The payoff is that a Spanish course, or a course running the other direction
 * (a Korean speaker acquiring English), is a corpus file plus an adapter. Not
 * one line of this file changes.
 */

export const ROLES = Object.freeze({ SOURCE: 'source', TARGET: 'target' });

/**
 * Rung order is the ladder.
 *
 * `prompt`   — roles played as audio, in order, before the learner responds.
 * `response` — what the learner produces: a role plus a modality, or null for
 *              a rung that only has to be sat through.
 *
 * `repetition` plays target twice because hearing it once is recognition and
 * hearing it again after attempting it is correction — that second play is the
 * shadowing mechanic itself, not a stutter.
 */
export const RUNGS = Object.freeze([
  {
    id: 'repetition',
    prompt: [ROLES.SOURCE, ROLES.TARGET, ROLES.TARGET],
    response: null,
  },
  {
    id: 'dictation',
    prompt: [ROLES.TARGET],
    response: { role: ROLES.TARGET, modality: 'text' },
  },
  {
    id: 'recording',
    prompt: [ROLES.TARGET],
    response: { role: ROLES.TARGET, modality: 'audio' },
  },
  {
    id: 'interpretation',
    prompt: [ROLES.TARGET],
    response: { role: ROLES.SOURCE, modality: 'text' },
  },
]);

export const RUNG_IDS = RUNGS.map((r) => r.id);

export function rungById(id) {
  return RUNGS.find((r) => r.id === id) ?? null;
}

/**
 * Resolve a role to the concrete language code this corpus binds it to.
 *
 * @param {string} role - ROLES.SOURCE | ROLES.TARGET
 * @param {{source: string, target: string}} languages - from the corpus
 * @returns {string|null} e.g. 'EN' / 'KR'
 */
export function resolveRole(role, languages) {
  if (!languages) return null;
  return languages[role] ?? null;
}

/**
 * Rungs whose TEXT answer may also be spoken and transcribed.
 *
 * Interpretation only, and deliberately not "every text rung". Dictation is
 * typing the target script from audio; a spoken target answer there is the
 * learner repeating what was just played — which is the repetition rung, one
 * they have already done. Accepting it as dictation would credit listening as
 * writing and remove the only rung that practises the script.
 */
const SPOKEN_ANSWER_RUNGS = Object.freeze(new Set(['interpretation']));

/**
 * What a rung needs from the device, expressed concretely for THIS corpus and
 * THIS deployment. `null` means it runs anywhere.
 *
 * A requirement is a set of ALTERNATIVES, met by any one of them. Most rungs
 * have exactly one, and the shape is uniform anyway so that no caller has to
 * ask which sort of requirement it is holding — `{ anyOf: [...] }` always.
 *
 * Text input is reported per language rather than as one boolean, because the
 * two typing rungs are not interchangeable: `dictation` needs an IME for the
 * target script while `interpretation` needs only the source script. A plain
 * US keyboard satisfies interpretation and not dictation, and collapsing both
 * to `keyboard` would offer the learner a rung they physically cannot enter.
 *
 * `voiceAnswer` says whether this DEPLOYMENT can turn speech into text. It is
 * a second argument rather than a capability because it is not a property of
 * the panel: capabilities are declared by the client (down to a query string),
 * and a client that could assert the server's transcriber into existence would
 * be handed a rung with no way in and no way past — the exact dead end
 * `chainFor` exists to prevent. Server facts travel server-side.
 *
 * @param {object} rung - a RUNGS entry
 * @param {{source: string, target: string}} languages
 * @param {{voiceAnswer?: boolean}} [options]
 * @returns {{anyOf: Array<{kind: 'microphone'} | {kind: 'textInput', language: string|null}>} | null}
 */
export function requirementFor(rung, languages, { voiceAnswer = false } = {}) {
  if (!rung?.response) return null;
  if (rung.response.modality === 'audio') return { anyOf: [{ kind: 'microphone' }] };
  if (rung.response.modality === 'text') {
    const typed = { kind: 'textInput', language: resolveRole(rung.response.role, languages) };
    return voiceAnswer && SPOKEN_ANSWER_RUNGS.has(rung.id)
      ? { anyOf: [typed, { kind: 'microphone' }] }
      : { anyOf: [typed] };
  }
  return null;
}

/** One alternative against what the device has. */
function satisfiesAlternative(capabilities, alternative) {
  if (alternative?.kind === 'microphone') return capabilities.microphone === true;
  if (alternative?.kind === 'textInput') {
    if (!alternative.language) return false;
    return Array.isArray(capabilities.textInput)
      && capabilities.textInput.includes(alternative.language);
  }
  return false;
}

/**
 * Whether a device can meet a requirement — ANY one alternative is enough.
 *
 * EXPORTED because the access gate asks the same question of the same
 * requirement and used to answer it with its own copy of this branching. The
 * two drifted, the queue offered a rung the gate then refused, and a child was
 * told to connect a keyboard for a rung that needs none. One predicate, one
 * answer; see `accessGate.allowsRung`.
 *
 * @param {{microphone?: boolean, textInput?: string[]}} capabilities
 * @param {{anyOf: object[]}|null} requirement
 */
export function satisfiesRequirement(capabilities = {}, requirement) {
  if (requirement === null || requirement === undefined) return true;
  if (!Array.isArray(requirement.anyOf)) return false;
  return requirement.anyOf.some((alt) => satisfiesAlternative(capabilities, alt));
}

/**
 * The ladder as it exists on THIS device, for THIS corpus. A rung whose input
 * capability is absent is removed from the chain rather than left in it to
 * stall — sentences graduate across the gap (design §1 "Graceful degradation").
 *
 * This is what keeps an unattended kiosk from dead-ending. A blocked rung must
 * never reach the UI as a dead input; it simply never enters the queue, so
 * there is nothing to render and nothing to fail on submit.
 *
 * The first rung has no response and therefore no requirement, so the chain is
 * never empty and the program always has something to do.
 *
 * @param {{microphone?: boolean, textInput?: string[]}} [capabilities]
 * @param {{source: string, target: string}} languages
 * @param {{voiceAnswer?: boolean}} [options] whether this deployment can
 *        transcribe speech. Defaults to NO: a caller that forgets it offers a
 *        rung too few, which degrades; the other way round dead-ends a child.
 * @returns {string[]} rung ids, in ladder order
 */
export function chainFor(capabilities = {}, languages, options = {}) {
  return RUNGS
    .filter((rung) => satisfiesRequirement(capabilities, requirementFor(rung, languages, options)))
    .map((rung) => rung.id);
}

/**
 * The rung a sentence graduates to after clearing `rung`, on this device.
 * `null` means retired — it has climbed the whole (filtered) ladder.
 *
 * An unknown rung id, or one filtered out by capabilities, also returns null:
 * a sentence whose last cleared rung no longer exists here is retired rather
 * than resurrected at a guessed position. Evidence recorded on a
 * better-equipped device must not create phantom work on a lesser one.
 */
export function nextRung(rung, capabilities = {}, languages, options = {}) {
  const chain = chainFor(capabilities, languages, options);
  const at = chain.indexOf(rung);
  if (at === -1) return null;
  return chain[at + 1] ?? null;
}

/**
 * Adjacent (from → to) pairs of the active chain — the graduation edges the
 * day-queue walks. Derived here so the queue builder never re-derives the
 * chain and the two can never disagree about what "next" means.
 *
 * @returns {Array<{from: string, to: string}>}
 */
export function graduationEdges(capabilities = {}, languages, options = {}) {
  const chain = chainFor(capabilities, languages, options);
  return chain.slice(0, -1).map((from, i) => ({ from, to: chain[i + 1] }));
}

/**
 * The enrollment-defined chain that decides whether a study day is complete.
 *
 * Device capabilities answer what this panel can serve; they must never lower
 * the bar for credit. Invalid or empty configuration falls back to the full
 * ladder so a malformed plan cannot award credit for an empty day.
 *
 * @param {string[]|null} rungs
 * @param {{source: string, target: string}} languages Reserved for parity with
 *   the other chain helpers and future corpus-specific ladders.
 * @returns {string[]} rung ids in ladder order; always a fresh, non-empty array
 */
// eslint-disable-next-line no-unused-vars
export function creditChain(rungs, languages) {
  if (!Array.isArray(rungs) || rungs.length === 0) return [...RUNG_IDS];
  const wanted = new Set(rungs);
  const chain = RUNG_IDS.filter((id) => wanted.has(id));
  return chain.length ? chain : [...RUNG_IDS];
}
