/**
 * ProgramRunner — executes YAML state machine programs.
 *
 * A program is a set of named states. Each state has an action (play, queue)
 * and a transition rule (next, wait_for_input, condition, random_pick, stop).
 *
 * The runner is driven externally: start() begins, advance() is called when
 * a track finishes, receiveInput() provides button choices.
 */
export class ProgramRunner {
  #states;
  #currentState = null;
  #waitingForInput = false;
  #inputConfig = null;
  #finished = false;
  #pendingThen = null;

  constructor(program) {
    this.#states = program.states;
    if (!this.#states[program.start]) {
      throw new Error(`Start state "${program.start}" not found in program`);
    }
    this.#currentState = program.start;
  }

  get currentState() { return this.#currentState; }
  get isWaitingForInput() { return this.#waitingForInput; }
  get isFinished() { return this.#finished; }

  start() {
    return this.#enterState(this.#currentState);
  }

  advance() {
    if (this.#finished) return { type: 'stop' };
    if (this.#pendingThen) {
      const then = this.#pendingThen;
      this.#pendingThen = null;
      return this.#evaluateThen(then);
    }
    return { type: 'stop' };
  }

  receiveInput(choice) {
    if (!this.#waitingForInput) throw new Error('Program is not waiting for input');
    const resolvedChoice = choice || this.#inputConfig.default;
    const nextState = this.#inputConfig.transitions[resolvedChoice];
    this.#waitingForInput = false;
    this.#inputConfig = null;
    if (!nextState || !this.#states[nextState]) return { type: 'stop' };
    return this.#enterState(nextState);
  }

  #enterState(stateName) {
    this.#currentState = stateName;
    const state = this.#states[stateName];
    if (!state) { this.#finished = true; return { type: 'stop' }; }

    if (state.condition) return this.#evaluateCondition(state.condition);
    if (state.random_pick) return this.#evaluateRandomPick(state.random_pick);

    if (state.then) this.#pendingThen = state.then;

    if (state.play) return { type: 'play', file: state.play };
    if (state.queue) return { type: 'queue', files: Array.isArray(state.queue) ? state.queue : [state.queue] };

    if (state.then) {
      this.#pendingThen = null;
      return this.#evaluateThen(state.then);
    }

    this.#finished = true;
    return { type: 'stop' };
  }

  #evaluateThen(then) {
    if (then === 'stop') { this.#finished = true; return { type: 'stop' }; }
    if (typeof then === 'string') return this.#enterState(then);
    if (then.next) return this.#enterState(then.next);

    if (then.wait_for_input) {
      this.#waitingForInput = true;
      this.#inputConfig = {
        timeout: then.wait_for_input.timeout || 30,
        default: then.wait_for_input.default || 'a',
        transitions: then.transitions || {},
      };
      return {
        type: 'wait_for_input',
        ...(then.prompt ? { prompt: then.prompt } : {}),
        timeout: this.#inputConfig.timeout,
        default: this.#inputConfig.default,
        transitions: this.#inputConfig.transitions,
      };
    }

    this.#finished = true;
    return { type: 'stop' };
  }

  #evaluateCondition(condition) {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (condition.time_before && timeStr < condition.time_before) return this.#enterState(condition.then);
    if (condition.time_after && timeStr >= condition.time_after) return this.#enterState(condition.then);
    return this.#enterState(condition.default);
  }

  #evaluateRandomPick(picks) {
    const totalWeight = picks.reduce((sum, p) => sum + (p.weight || 1), 0);
    let random = Math.random() * totalWeight;
    for (const pick of picks) {
      random -= (pick.weight || 1);
      if (random <= 0) return this.#enterState(pick.next);
    }
    return this.#enterState(picks[picks.length - 1].next);
  }
}

export default ProgramRunner;
