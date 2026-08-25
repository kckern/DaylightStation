/**
 * SchoolGradingHookAdapter — fires one configured Home Assistant script when a
 * school event reaches a terminal outcome, passing the outcome as script
 * variables.
 *
 * TWO INSTANCES, ONE PIPE. `configKey` selects which `school.yml` block names
 * this instance's script: `grading_hook` (a paper scan's four terminal
 * outcomes) or `piano_lesson_hook` (a daily piano lesson crossing
 * completion). They are separate hooks because they are separate events a
 * household will want to sound differently — but the pipe itself (circuit
 * breaker, never-throw contract, variable shaping) is identical, and a
 * forked copy of it would drift.
 *
 * Deliberately a dumb pipe: it does not decide what a score MEANS. `school.yml`
 * names one script; Home Assistant branches on the `result` variable. Retuning
 * a light must never require a redeploy of this repo.
 *
 * Modelled on `1_adapters/fitness/AmbientLedAdapter.mjs`, with two deliberate
 * departures:
 *   - NO deduplication. A scene is a state; a grade is an EVENT. Two learners
 *     both scoring 83% each deserve their own light.
 *   - NO throttle. Three children scanning in succession must all fire; a
 *     2s window would silently swallow the second and third.
 *
 * Home automation must never affect grading, so this never throws.
 */
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const MAX_FAILURES = 5;
const MAX_BACKOFF_MS = 60000;

/**
 * Every call carries this key set; inapplicable values are null / [].
 * A null/undefined outcome is treated as an empty grade — the same uniform
 * 11-key shape still comes out, just all-null (plus [] for the array keys).
 */
function toVariables(outcome) {
  const o = outcome ?? {};
  return {
    result: o.result ?? null,
    learner_id: o.learnerId ?? null,
    student: o.student ?? o.learnerId ?? null,
    test_id: o.testId ?? null,
    session_id: o.sessionId ?? null,
    percent: o.percent ?? null,
    earned: o.earned ?? null,
    total: o.total ?? null,
    pending_review: o.pendingReview ?? null,
    reasons: o.reasons ?? [],
    items: o.items ?? [],
    code: o.code ?? null,
    subject: o.subject ?? null,
    course: o.course ?? null,
    unit: o.unit ?? null,
    lesson: o.lesson ?? null,
  };
}

export class SchoolGradingHookAdapter {
  #gateway;
  #loadSchoolConfig;
  #resolveStudent;
  #configKey;
  #eventPrefix;
  #logger;

  constructor(config) {
    if (!config?.gateway) {
      throw new InfrastructureError('SchoolGradingHookAdapter requires gateway', {
        code: 'MISSING_DEPENDENCY', dependency: 'gateway',
      });
    }
    if (!config?.loadSchoolConfig) {
      throw new InfrastructureError('SchoolGradingHookAdapter requires loadSchoolConfig', {
        code: 'MISSING_DEPENDENCY', dependency: 'loadSchoolConfig',
      });
    }
    this.#gateway = config.gateway;
    this.#loadSchoolConfig = config.loadSchoolConfig;
    this.#resolveStudent = config.resolveStudent || null;
    // Which `school.yml` block names this instance's script. Defaults to
    // `grading_hook` so every existing caller is untouched; a second instance
    // (the piano-lesson ceremony) passes its own key rather than forking this
    // class, because the pipe — circuit breaker, never-throw contract,
    // variable shaping — is identical and must not drift into two copies.
    this.#configKey = config.configKey || 'grading_hook';
    // Log events are NAMED for the instance, so the log store can tell the two
    // hooks apart. The default key reproduces `school.grading_hook.*` byte for
    // byte — every existing query and every existing test keeps working.
    this.#eventPrefix = `school.${this.#configKey}`;
    this.#logger = config.logger || console;

    this.failureCount = 0;
    this.backoffUntil = 0;
    this.metrics = {
      totalRequests: 0, firedCount: 0, failureCount: 0,
      skippedNotConfigured: 0, skippedBackoff: 0,
      resultHistogram: {}, lastFiredAt: null,
    };
  }

  async fire(outcome) {
    this.metrics.totalRequests++;
    const now = Date.now();

    // Outer guard: config loading and outcome shaping are NOT gateway calls,
    // so their failures must never reach or arm the circuit breaker below.
    // The inner try/catch (around the actual gateway call) keeps sole
    // ownership of failureCount/backoffUntil.
    try {
      const script = this.#loadSchoolConfig(outcome?.householdId)?.[this.#configKey]?.script;
      if (!script) {
        this.metrics.skippedNotConfigured++;
        this.#logger.debug?.(`${this.#eventPrefix}.skipped`, { reason: 'not_configured' });
        return { ok: true, skipped: true, reason: 'not_configured' };
      }

      if (this.backoffUntil > now) {
        this.metrics.skippedBackoff++;
        this.#logger.warn?.(`${this.#eventPrefix}.skipped`, {
          reason: 'backoff', remainingMs: this.backoffUntil - now, failureCount: this.failureCount,
        });
        return { ok: true, skipped: true, reason: 'backoff' };
      }

      // `script.school_graded` -> domain script, service school_graded.
      // A bare `school_graded` is used as the service name as-is.
      const service = script.startsWith('script.') ? script.slice('script.'.length) : script;
      const variables = toVariables(outcome);
      if (this.#resolveStudent && variables.learner_id && !outcome?.student) {
        try { variables.student = (await this.#resolveStudent(variables.learner_id)) ?? variables.learner_id; } catch { /* identifier remains useful */ }
      }

      try {
        const result = await this.#gateway.callService('script', service, variables);
        // The real gateway (`HomeAssistantAdapter#callService`) never throws
        // — a downed HA, a bad token, or a typo'd script name all resolve to
        // `{ok:false, error}` with no network call in some cases at all. "No
        // throw" is therefore NOT "succeeded": without this check every one
        // of those failures fell through to the success branch below and
        // reported `firedCount++`/INFO, leaving `.failed`/`.circuit_open`
        // permanently unreachable — a broken Home Assistant looked healthy.
        // Thrown here (not just checked) so it lands in the SAME inner catch
        // that owns the circuit breaker, matching the shape
        // `AmbientLedAdapter#activateForZones` already uses for this exact
        // gateway contract.
        if (!result?.ok) {
          throw new InfrastructureError(result?.error || 'HA service call failed', {
            code: 'EXTERNAL_SERVICE_ERROR', service: 'HomeAssistant',
          });
        }
        this.failureCount = 0;
        this.metrics.firedCount++;
        this.metrics.lastFiredAt = new Date(now).toISOString();
        this.metrics.resultHistogram[variables.result] =
          (this.metrics.resultHistogram[variables.result] || 0) + 1;
        this.#logger.info?.(`${this.#eventPrefix}.fired`, {
          script, result: variables.result, learnerId: variables.learner_id,
        });
        return { ok: true };
      } catch (error) {
        this.failureCount++;
        this.metrics.failureCount++;
        if (this.failureCount >= MAX_FAILURES) {
          const backoffMs = Math.min(
            MAX_BACKOFF_MS, 1000 * (2 ** (this.failureCount - MAX_FAILURES)),
          );
          this.backoffUntil = Date.now() + backoffMs;
          this.#logger.error?.(`${this.#eventPrefix}.circuit_open`, {
            failureCount: this.failureCount, backoffMs, error: error.message,
          });
        } else {
          this.#logger.error?.(`${this.#eventPrefix}.failed`, {
            script, result: variables.result, error: error.message,
            failureCount: this.failureCount,
          });
        }
        return { ok: false, error: error.message };
      }
    } catch (error) {
      // Config load / outcome-shaping errors — never the gateway's fault, so
      // the breaker stays untouched. Distinct event name from `.failed`
      // (which means "the gateway rejected the call").
      this.#logger.error?.(`${this.#eventPrefix}.error`, { error: error.message });
      return { ok: false, error: error.message };
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      circuitBreaker: {
        failureCount: this.failureCount,
        maxFailures: MAX_FAILURES,
        isOpen: this.backoffUntil > Date.now(),
      },
    };
  }

  reset() {
    const previous = { failureCount: this.failureCount, backoffUntil: this.backoffUntil };
    this.failureCount = 0;
    this.backoffUntil = 0;
    this.#logger.info?.('school.grading_hook.reset', { previous });
    return { ok: true, previous };
  }
}

export default SchoolGradingHookAdapter;
