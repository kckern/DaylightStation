/**
 * SchoolGradingHookAdapter — fires one configured Home Assistant script when a
 * paper scan reaches a terminal outcome, passing the outcome as script
 * variables.
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
      const script = this.#loadSchoolConfig(outcome?.householdId)?.grading_hook?.script;
      if (!script) {
        this.metrics.skippedNotConfigured++;
        this.#logger.debug?.('school.grading_hook.skipped', { reason: 'not_configured' });
        return { ok: true, skipped: true, reason: 'not_configured' };
      }

      if (this.backoffUntil > now) {
        this.metrics.skippedBackoff++;
        this.#logger.warn?.('school.grading_hook.skipped', {
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
        this.#logger.info?.('school.grading_hook.fired', {
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
          this.#logger.error?.('school.grading_hook.circuit_open', {
            failureCount: this.failureCount, backoffMs, error: error.message,
          });
        } else {
          this.#logger.error?.('school.grading_hook.failed', {
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
      this.#logger.error?.('school.grading_hook.error', { error: error.message });
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
