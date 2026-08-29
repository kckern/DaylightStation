/** Retains the first and final startup metric while suppressing intermediate samples. */
export class StartupMetricSamplingPolicy {
  #startupState = new Map();

  accept(event) {
    if (event?.event !== 'playback.media-metric' || event?.data?.metric !== 'startup_duration_ms') {
      return true;
    }
    const key = event?.data?.waitKey || event?.context?.sessionId || 'global-startup-metric';
    const state = this.#startupState.get(key) || { firstSent: false, finalSent: false };
    const isFinal = event?.data?.final === true || event?.data?.isFinal === true;
    if (!state.firstSent) {
      this.#startupState.set(key, { firstSent: true, finalSent: state.finalSent });
    } else if (isFinal && !state.finalSent) {
      this.#startupState.set(key, { ...state, finalSent: true });
    } else {
      return false;
    }
    if (this.#startupState.size > 2000) this.#startupState.clear();
    return true;
  }
}

export default StartupMetricSamplingPolicy;
