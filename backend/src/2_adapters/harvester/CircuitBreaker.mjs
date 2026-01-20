/**
 * CircuitBreaker
 *
 * Resilience pattern for external API calls.
 * Opens after consecutive failures, closes after cooldown period.
 * Uses exponential backoff for cooldown duration.
 *
 * @module harvester/CircuitBreaker
 */

/**
 * Circuit breaker states
 * @readonly
 * @enum {string}
 */
export const CircuitState = {
  CLOSED: 'closed',     // Normal operation
  OPEN: 'open',         // Blocking calls (in cooldown)
  HALF_OPEN: 'half-open', // Testing if service recovered
};

/**
 * Circuit breaker for resilient external API calls
 */
export class CircuitBreaker {
  #maxFailures;
  #baseCooldownMs;
  #maxCooldownMs;
  #failures = 0;
  #lastFailure = null;
  #cooldownUntil = null;
  #state = CircuitState.CLOSED;
  #logger;

  /**
   * @param {Object} config
   * @param {number} [config.maxFailures=3] - Failures before opening circuit
   * @param {number} [config.baseCooldownMs=300000] - Base cooldown (5 minutes)
   * @param {number} [config.maxCooldownMs=7200000] - Max cooldown (2 hours)
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    maxFailures = 3,
    baseCooldownMs = 5 * 60 * 1000,
    maxCooldownMs = 2 * 60 * 60 * 1000,
    logger = console,
  } = {}) {
    this.#maxFailures = maxFailures;
    this.#baseCooldownMs = baseCooldownMs;
    this.#maxCooldownMs = maxCooldownMs;
    this.#logger = logger;
  }

  /**
   * Check if circuit is open (blocking calls)
   * @returns {boolean}
   */
  isOpen() {
    if (this.#state === CircuitState.CLOSED) {
      return false;
    }

    // Check if cooldown has expired
    if (this.#cooldownUntil && Date.now() >= this.#cooldownUntil) {
      this.#state = CircuitState.HALF_OPEN;
      this.#logger.info?.('circuit.halfOpen', {
        message: 'Cooldown expired, entering half-open state',
      });
      return false;
    }

    return true;
  }

  /**
   * Get cooldown status if circuit is open
   * @returns {{ inCooldown: boolean, remainingMs: number, remainingMins: number } | null}
   */
  getCooldownStatus() {
    if (!this.isOpen() || !this.#cooldownUntil) {
      return null;
    }

    const remainingMs = this.#cooldownUntil - Date.now();
    return {
      inCooldown: true,
      remainingMs,
      remainingMins: Math.ceil(remainingMs / 60000),
    };
  }

  /**
   * Record a successful call - resets the circuit
   */
  recordSuccess() {
    if (this.#failures > 0 || this.#state !== CircuitState.CLOSED) {
      this.#logger.info?.('circuit.success', {
        previousFailures: this.#failures,
        previousState: this.#state,
      });
    }

    this.#failures = 0;
    this.#cooldownUntil = null;
    this.#state = CircuitState.CLOSED;
  }

  /**
   * Record a failed call - may open the circuit
   * @param {Error} [error] - The error that occurred
   */
  recordFailure(error = null) {
    this.#failures++;
    this.#lastFailure = Date.now();

    // Check if we should open the circuit
    if (this.#failures >= this.#maxFailures) {
      this.#openCircuit(error);
    } else {
      this.#logger.warn?.('circuit.failure', {
        failures: this.#failures,
        maxFailures: this.#maxFailures,
        error: error?.message,
      });
    }
  }

  /**
   * Open the circuit and enter cooldown
   * @private
   */
  #openCircuit(error) {
    // Exponential backoff: 5min, 10min, 20min, 40min... up to max
    const backoffMultiplier = Math.min(
      Math.pow(2, this.#failures - this.#maxFailures),
      Math.ceil(this.#maxCooldownMs / this.#baseCooldownMs)
    );
    const cooldownMs = Math.min(
      this.#baseCooldownMs * backoffMultiplier,
      this.#maxCooldownMs
    );

    this.#cooldownUntil = Date.now() + cooldownMs;
    this.#state = CircuitState.OPEN;

    this.#logger.warn?.('circuit.open', {
      failures: this.#failures,
      cooldownMins: Math.ceil(cooldownMs / 60000),
      resumeAt: new Date(this.#cooldownUntil).toISOString(),
      error: error?.message,
    });
  }

  /**
   * Get current circuit breaker status
   * @returns {Object}
   */
  getStatus() {
    return {
      state: this.#state,
      failures: this.#failures,
      lastFailure: this.#lastFailure,
      cooldownUntil: this.#cooldownUntil,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset() {
    this.#failures = 0;
    this.#lastFailure = null;
    this.#cooldownUntil = null;
    this.#state = CircuitState.CLOSED;
    this.#logger.info?.('circuit.reset', { message: 'Circuit manually reset' });
  }
}

export default CircuitBreaker;
