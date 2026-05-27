/**
 * FakeHubGateway - In-memory IPlaybackHubGateway double for use-case tests.
 *
 * NOT a production adapter. Lives under `test/` (not `usecases/`) to make its
 * non-production status obvious. The Phase 3 HttpPlaybackHubAdapter is the
 * production implementation.
 *
 * Features:
 *   - setStatusFixture(slots)        — seed getStatus() return value
 *   - setError(err)                  — make getStatus() reject
 *   - setNextCommandResult(result)   — seed sendCommand() return value
 *   - setCommandError(err)           — make sendCommand() reject
 *   - lastCall                       — { playCommand, targets } recorded on send
 *   - calls                          — full history for assertions
 *   - concurrentCalls / maxConcurrentCalls — for serial-loop assertions
 */

import { IPlaybackHubGateway } from '../ports/IPlaybackHubGateway.mjs';
import { CommandResult } from '../../../2_domains/playback-hub/value-objects/CommandResult.mjs';

export class FakeHubGateway extends IPlaybackHubGateway {
  #statusFixture = [];
  #statusError = null;
  #commandResult = null;
  #commandError = null;

  /** @type {{ playCommand: object, targets: object[] }|null} */
  lastCall = null;
  /** @type {Array<{ playCommand: object, targets: object[] }>} */
  calls = [];
  /** Per-call queue: if non-empty, drains in FIFO order. */
  #commandResultQueue = [];

  // Concurrency-tracking for HubStatusBroadcaster's serial-loop test.
  concurrentCalls = 0;
  maxConcurrentCalls = 0;
  /** Optional async hook fired during getStatus() — used to introduce delays. */
  statusHook = null;

  /**
   * Seed the result of the next getStatus() call.
   * @param {import('../../../2_domains/playback-hub/value-objects/SlotStatus.mjs').SlotStatus[]} slots
   */
  setStatusFixture(slots) {
    if (!Array.isArray(slots)) {
      throw new Error('FakeHubGateway.setStatusFixture requires an array');
    }
    this.#statusFixture = slots;
    this.#statusError = null;
  }

  /**
   * Make the next getStatus() call reject.
   * @param {Error} err
   */
  setError(err) {
    this.#statusError = err;
  }

  /**
   * Seed the result of the next sendCommand() call. If called multiple times
   * without a sendCommand() in between, the most recent overrides — but if you
   * want to queue per-call results in FIFO order use enqueueCommandResult().
   * @param {CommandResult} result
   */
  setNextCommandResult(result) {
    if (!(result instanceof CommandResult)) {
      throw new Error('FakeHubGateway.setNextCommandResult requires a CommandResult instance');
    }
    this.#commandResult = result;
    this.#commandError = null;
  }

  /**
   * Queue a CommandResult to be returned by the next sendCommand() call.
   * Subsequent calls drain the queue in FIFO order. Once empty, falls back to
   * setNextCommandResult / default.
   * @param {CommandResult} result
   */
  enqueueCommandResult(result) {
    if (!(result instanceof CommandResult)) {
      throw new Error('FakeHubGateway.enqueueCommandResult requires a CommandResult instance');
    }
    this.#commandResultQueue.push(result);
  }

  /**
   * Make the next sendCommand() call reject.
   * @param {Error} err
   */
  setCommandError(err) {
    this.#commandError = err;
  }

  /**
   * @override
   * @returns {Promise<object[]>}
   */
  async getStatus() {
    this.concurrentCalls += 1;
    if (this.concurrentCalls > this.maxConcurrentCalls) {
      this.maxConcurrentCalls = this.concurrentCalls;
    }
    try {
      if (typeof this.statusHook === 'function') {
        await this.statusHook();
      }
      if (this.#statusError) {
        throw this.#statusError;
      }
      return this.#statusFixture;
    } finally {
      this.concurrentCalls -= 1;
    }
  }

  /**
   * @override
   * @param {object} playCommand
   * @param {object[]} targets
   * @returns {Promise<CommandResult>}
   */
  async sendCommand(playCommand, targets) {
    const call = { playCommand, targets };
    this.lastCall = call;
    this.calls.push(call);
    if (this.#commandError) {
      const err = this.#commandError;
      this.#commandError = null; // single-shot
      throw err;
    }
    if (this.#commandResultQueue.length > 0) {
      return this.#commandResultQueue.shift();
    }
    if (this.#commandResult) {
      return this.#commandResult;
    }
    return new CommandResult({ applied: [], skipped: [] });
  }
}

export default FakeHubGateway;
