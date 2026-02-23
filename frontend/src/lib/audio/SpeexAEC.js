/**
 * JS wrapper around the Speex AEC WASM module.
 * Designed to run inside an AudioWorklet.
 *
 * Usage:
 *   const aec = await SpeexAEC.create({ sampleRate: 48000, frameSize: 480, filterLength: 4800 });
 *   const cleanFrame = aec.cancel(micFrame, refFrame); // Float32Array → Float32Array
 *   aec.destroy();
 */
export class SpeexAEC {
  #module;
  #state;
  #frameSize;
  #micPtr;
  #refPtr;
  #outPtr;

  /**
   * Create and initialize a Speex AEC instance.
   * @param {Function} SpeexModuleFactory - The Emscripten module factory (from speex_aec.js)
   * @param {Object} opts
   * @param {number} [opts.sampleRate=48000]
   * @param {number} [opts.frameSize=480] - Samples per frame (10ms at 48kHz)
   * @param {number} [opts.filterLength=4800] - Adaptive filter length in samples (100ms at 48kHz)
   */
  static async create(SpeexModuleFactory, { sampleRate = 48000, frameSize = 480, filterLength = 4800 } = {}) {
    const mod = await SpeexModuleFactory();

    const aec = new SpeexAEC();
    aec.#module = mod;
    aec.#frameSize = frameSize;

    // Initialize echo canceller state
    aec.#state = mod._speex_echo_state_init(frameSize, filterLength);

    // Set sample rate (SPEEX_ECHO_SET_SAMPLING_RATE = 24)
    const srPtr = mod._malloc(4);
    mod.setValue(srPtr, sampleRate, 'i32');
    mod._speex_echo_ctl(aec.#state, 24, srPtr);
    mod._free(srPtr);

    // Pre-allocate WASM heap buffers (int16: 2 bytes per sample)
    aec.#micPtr = mod._malloc(frameSize * 2);
    aec.#refPtr = mod._malloc(frameSize * 2);
    aec.#outPtr = mod._malloc(frameSize * 2);

    return aec;
  }

  /**
   * Cancel echo from one frame.
   * @param {Float32Array} micFrame - Microphone input (-1 to 1), length must equal frameSize
   * @param {Float32Array} refFrame - Far-end reference (-1 to 1), length must equal frameSize
   * @returns {Float32Array} Clean output (-1 to 1)
   */
  cancel(micFrame, refFrame) {
    const mod = this.#module;
    const fs = this.#frameSize;

    // Float32 → Int16 into WASM heap
    for (let i = 0; i < fs; i++) {
      mod.HEAP16[(this.#micPtr >> 1) + i] = Math.max(-32768, Math.min(32767, micFrame[i] * 32768));
      mod.HEAP16[(this.#refPtr >> 1) + i] = Math.max(-32768, Math.min(32767, refFrame[i] * 32768));
    }

    mod._speex_echo_cancellation(this.#state, this.#micPtr, this.#refPtr, this.#outPtr);

    // Int16 → Float32
    const out = new Float32Array(fs);
    for (let i = 0; i < fs; i++) {
      out[i] = mod.HEAP16[(this.#outPtr >> 1) + i] / 32768;
    }
    return out;
  }

  destroy() {
    if (this.#state) {
      this.#module._speex_echo_state_destroy(this.#state);
      this.#module._free(this.#micPtr);
      this.#module._free(this.#refPtr);
      this.#module._free(this.#outPtr);
      this.#state = null;
    }
  }
}
