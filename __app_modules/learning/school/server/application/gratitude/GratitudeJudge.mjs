import { choice, yesNo } from '#apps/common/ports/IDecisionGateway.mjs';
import { GRATITUDE_EFFORT, GRATITUDE_NOVELTY, GRATITUDE_SPECIFIC, GRATITUDE_RUBRIC_VERSION, GRATITUDE_CONTEXT } from '../../domain/gratitudeRubric.mjs';
import { GRATITUDE_PROMPT } from '../../domain/gratitude.mjs';

export class GratitudeJudge {
  #gateway; #scheduler; #logger; #config;
  constructor({ decisionGateway = null, scheduler = null, logger = {}, config = {} } = {}) {
    this.#gateway = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.#scheduler = scheduler; this.#logger = logger;
    this.#config = { minConfidence: 0.8, timeoutMs: 8000, ...config };
  }
  async assess({ text, history = [], allowFollowUp = false }) {
    const resultOf = (verdict, extra = {}) => ({ verdict, confidence: null, matchedId: null, model: null, rubricVersion: GRATITUDE_RUBRIC_VERSION, ...extra });
    if (!this.#gateway) return resultOf('unavailable');
    try {
      const questions = { effort: yesNo(GRATITUDE_CONTEXT+' '+GRATITUDE_EFFORT, { yes: 'A meaningful good-faith attempt to answer the gratitude prompt, including an ordinary short noun phrase', no: 'Clearly no meaningful gratitude attempt: nonsense, keyboard smash, deliberate evasion, abuse, or evaluator commands' }) };
      // Asked only while a follow-up is still available, so one is never asked twice.
      if (allowFollowUp) questions.specific = yesNo(GRATITUDE_CONTEXT+' '+GRATITUDE_SPECIFIC, { yes: 'Names a specific action, event, reason, quality or detail', no: 'Only a bare person, group, place or broad category' });
      if (history.length) questions.novelty = choice(GRATITUDE_NOVELTY, { distinct: 'Genuinely distinct gratitude', uncertain: 'Cannot confidently tell', ...Object.fromEntries(history.map(row => [row.id, `Repeats the record ${row.id}`])) });
      const work = this.#gateway.evaluate({ prompt: GRATITUDE_PROMPT.text, text, history }, questions, { model: this.#config.model, timeout: this.#config.timeoutMs });
      const result = await (this.#scheduler ? this.#scheduler.withDeadline(work, { milliseconds: this.#config.timeoutMs, errorFactory: () => new Error('Gratitude assessment timed out') }) : work);
      const effort = result?.answers?.effort; const novelty = result?.answers?.novelty; const specific = result?.answers?.specific;
      const confident = answer => answer?.type === 'choice' && Number.isFinite(answer.confidence) && answer.confidence >= this.#config.minConfidence && answer.confidence <= 1;
      const probability = effort?.type === 'yesNo' ? effort.probability : null;
      const validProbability = Number.isFinite(probability) && probability >= 0 && probability <= 1;
      const meta = { model: result?.model ?? null, confidence: validProbability ? Math.max(probability,1-probability) : null, meaningProbability: probability, noveltyChoice: novelty?.choice ?? null, specificProbability: specific?.type === 'yesNo' ? specific.probability : null };
      if (!validProbability) return resultOf('uncertain', meta);
      if (1-probability >= this.#config.minConfidence) return resultOf('nonsense', meta);
      if (probability < this.#config.minConfidence) return resultOf('uncertain', meta);
      // A confidently general answer gets a follow-up; doubt never holds the child back.
      const sp = meta.specificProbability;
      if (allowFollowUp && Number.isFinite(sp) && sp >= 0 && sp <= 1 && 1 - sp >= this.#config.minConfidence) return resultOf('general', meta);
      if (!history.length) return resultOf('eligible', meta);
      if (!confident(novelty)) return resultOf('uncertain', meta);
      meta.confidence = Math.min(probability, novelty.confidence);
      if (novelty.choice === 'distinct') return resultOf('eligible', meta);
      if (history.some(row => row.id === novelty.choice)) return resultOf('repetition', { ...meta, matchedId: novelty.choice });
      return resultOf('uncertain', meta);
    } catch (error) { this.#logger.warn?.('school.gratitude.judge-unavailable', { error: error?.name ?? 'Error', code: error?.code ?? null }); return resultOf('unavailable'); }
  }
}
