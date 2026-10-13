/**
 * FitnessSimulationService — process supervision adapter for the fitness simulation.
 *
 * Owns the lifecycle of the detached `simulation.mjs` child process: CLI-arg
 * construction, `spawn`, `process.kill`, and the live child-process handle
 * (`simulationState`). This is legitimately an application-service concern
 * (process supervision), extracted out of the API router so the router carries
 * no module-scope shared state and no direct child_process usage.
 *
 * Behavior is preserved verbatim from the former fitness.mjs handlers:
 * same spawn command, same argument construction, same response shapes.
 */
export class FitnessSimulationService {
  #logger;
  #runDetached;
  #terminateProcess;
  #scriptPath;

  // Live child-process handle + metadata. Instance-scoped (one per composition
  // root) rather than module-scoped, so it is not shared across router modules.
  #state = {
    process: null,
    pid: null,
    startedAt: null,
    config: null
  };

  constructor({
    runDetached = (command, args) => spawn(command, args, { detached: true, stdio: 'ignore' }),
    terminateProcess = (pid, signal) => process.kill(pid, signal),
    scriptPath = path.join(process.cwd(), '_extensions/fitness/simulation.mjs'),
    logger = console,
  } = {}) {
    if (typeof runDetached !== 'function' || typeof terminateProcess !== 'function' || !scriptPath) {
      throw new Error('FitnessSimulationService requires runDetached, terminateProcess, and scriptPath');
    }
    this.#logger = logger;
    this.#runDetached = runDetached;
    this.#terminateProcess = terminateProcess;
    this.#scriptPath = scriptPath;
  }

  #clearState() {
    this.#state.process = null;
    this.#state.pid = null;
    this.#state.startedAt = null;
    this.#state.config = null;
  }

  /**
   * Start a simulation. If one is already running, returns an
   * { started: false, alreadyRunning: true, ... } shape without spawning.
   *
   * @param {Object} [opts]
   * @param {number} [opts.duration=120]
   * @param {number} [opts.users=0]
   * @param {number} [opts.rpm=0]
   * @returns {Object} response payload (same shape the router used to return)
   */
  start(opts = {}) {
    // Already running: report without spawning.
    if (this.#state.process && !this.#state.process.killed) {
      return {
        started: false,
        alreadyRunning: true,
        pid: this.#state.pid,
        startedAt: this.#state.startedAt,
        config: this.#state.config
      };
    }

    const { duration = 120, users = 0, rpm = 0 } = opts || {};

    const args = [`--duration=${duration}`];
    if (users > 0) args.push(String(users));
    if (rpm > 0) args.push(String(users > 0 ? users : 0), String(rpm));

    this.#logger.info?.('fitness.simulate.start', { duration, users, rpm, scriptPath: this.#scriptPath });

    const proc = this.#runDetached('node', [this.#scriptPath, ...args]);
    proc.unref();

    this.#state.process = proc;
    this.#state.pid = proc.pid;
    this.#state.startedAt = Date.now();
    this.#state.config = { duration, users, rpm };

    // Auto-clear state when process exits.
    proc.on('exit', () => {
      this.#clearState();
      this.#logger.info?.('fitness.simulate.exited');
    });

    return {
      started: true,
      pid: proc.pid,
      config: { duration, users, rpm }
    };
  }

  /**
   * Stop the running simulation (SIGTERM). No-op-shaped response if none running.
   * @returns {Object} response payload (same shape the router used to return)
   */
  stop() {
    if (!this.#state.pid) {
      return { stopped: false, error: 'no simulation running' };
    }

    this.#terminateProcess(this.#state.pid, 'SIGTERM');

    const stoppedPid = this.#state.pid;
    this.#clearState();

    this.#logger.info?.('fitness.simulate.stopped', { pid: stoppedPid });

    return { stopped: true, pid: stoppedPid };
  }

  /**
   * Current simulation status.
   * @returns {Object} response payload (same shape the router used to return)
   */
  status() {
    const running = !!(this.#state.process && !this.#state.process.killed);

    return {
      running,
      pid: running ? this.#state.pid : null,
      startedAt: running ? this.#state.startedAt : null,
      config: running ? this.#state.config : null,
      runningSince: running ? Date.now() - this.#state.startedAt : null
    };
  }
}

export default FitnessSimulationService;
import { spawn } from 'node:child_process';
import path from 'node:path';
