/**
 * StreamChannel — domain entity for a named audio stream channel.
 *
 * Owns queue state, current track, force-play flag, and program metadata.
 * Pure domain logic — no I/O or process management.
 */
export class StreamChannel {
  #name;
  #format;
  #bitrate;
  #ambient;
  #queue = [];
  #currentTrack = null;
  #forceTrack = null;
  #activeProgram = null;
  #waitingForInput = false;
  #inputConfig = null;
  #listenerCount = 0;
  #soundboard;

  constructor({ name, format = 'aac', bitrate = 96, ambient = 'silence', soundboard = [] }) {
    this.#name = name;
    this.#format = format;
    this.#bitrate = bitrate;
    this.#ambient = ambient;
    this.#soundboard = soundboard;
  }

  get name() { return this.#name; }
  get format() { return this.#format; }
  get bitrate() { return this.#bitrate; }
  get ambient() { return this.#ambient; }
  get soundboard() { return this.#soundboard; }
  get currentTrack() { return this.#currentTrack; }
  get forceTrack() { return this.#forceTrack; }
  get activeProgram() { return this.#activeProgram; }
  get waitingForInput() { return this.#waitingForInput; }
  get inputConfig() { return this.#inputConfig; }
  get listenerCount() { return this.#listenerCount; }
  get queue() { return [...this.#queue]; }
  get queueLength() { return this.#queue.length; }

  get status() {
    if (this.#currentTrack) return 'playing';
    return 'idle';
  }

  enqueue(filePath) { this.#queue.push(filePath); }
  enqueueAll(filePaths) { this.#queue.push(...filePaths); }
  dequeue() { return this.#queue.shift() ?? null; }
  removeAt(index) {
    if (index >= 0 && index < this.#queue.length) this.#queue.splice(index, 1);
  }
  clearQueue() { this.#queue = []; }

  setCurrentTrack(filePath) { this.#currentTrack = filePath; }
  forcePlay(filePath) { this.#forceTrack = filePath; }
  consumeForce() {
    const track = this.#forceTrack;
    this.#forceTrack = null;
    return track;
  }

  setProgram(programName) { this.#activeProgram = programName; }
  setWaitingForInput(waiting, config = null) {
    this.#waitingForInput = waiting;
    this.#inputConfig = waiting ? config : null;
  }

  addListener() { this.#listenerCount++; }
  removeListener() { this.#listenerCount = Math.max(0, this.#listenerCount - 1); }

  toJSON() {
    return {
      name: this.#name,
      status: this.status,
      format: this.#format,
      bitrate: this.#bitrate,
      ambient: this.#ambient,
      currentTrack: this.#currentTrack,
      queue: this.queue,
      queueLength: this.queueLength,
      activeProgram: this.#activeProgram,
      waitingForInput: this.#waitingForInput,
      listenerCount: this.#listenerCount,
    };
  }
}

export default StreamChannel;
