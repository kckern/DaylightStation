import { StreamChannel } from '../../2_domains/livestream/StreamChannel.mjs';

export function toChannelStatus(channel) {
  return {
    name: channel.name, status: channel.status, format: channel.format,
    bitrate: channel.bitrate, ambient: channel.ambient, currentTrack: channel.currentTrack,
    queue: channel.queue, queueLength: channel.queueLength, activeProgram: channel.activeProgram,
    waitingForInput: channel.waitingForInput, listenerCount: channel.listenerCount,
    soundboard: channel.soundboard,
  };
}
import { ProgramRunner } from '../../2_domains/livestream/ProgramRunner.mjs';
import { assertStreamChannelRuntime, assertStreamChannelRuntimeFactory } from './ports/IStreamChannelRuntime.mjs';

/**
 * ChannelManager — application service for livestream channels.
 *
 * Orchestrates channel lifecycle: create/destroy, wire up
 * a semantic stream runtime ↔ StreamChannel and routes commands. Encoder,
 * decoder, file resolution, and listener streams are runtime concerns.
 */
export class ChannelManager {
  #channels = new Map();    // name → { channel, runtime, runner }
  #broadcastEvent;
  #createChannelRuntime;
  #loadProgram;
  #logger;
  #clock;
  #random;
  #scheduler;

  /**
   * @param {Object} config
   * @param {Function} config.broadcastEvent
   * @param {Function} config.createChannelRuntime - creates an infrastructure-owned channel runtime
   * @param {Function} config.loadProgram - (programPath) => parsed program definition
   * @param {Object} [config.logger]
   */
  constructor({ broadcastEvent, createChannelRuntime, loadProgram, clock, random, scheduler, logger = console }) {
    assertStreamChannelRuntimeFactory(createChannelRuntime);
    if (typeof loadProgram !== 'function') throw new Error('ChannelManager requires loadProgram');
    if (typeof clock !== 'function') throw new Error('ChannelManager requires clock');
    if (typeof random !== 'function') throw new Error('ChannelManager requires random');
    if (!scheduler?.after) throw new Error('ChannelManager requires scheduler');
    this.#broadcastEvent = broadcastEvent;
    this.#createChannelRuntime = createChannelRuntime;
    this.#loadProgram = loadProgram;
    this.#clock = clock;
    this.#random = random;
    this.#scheduler = scheduler;
    this.#logger = logger;
  }

  create(name, config = {}) {
    if (this.#channels.has(name)) throw new Error(`Channel "${name}" already exists`);

    const channel = new StreamChannel({ name, ...config });
    const runtime = assertStreamChannelRuntime(this.#createChannelRuntime({
      format: channel.format,
      bitrate: channel.bitrate,
      onTrackEnd: () => { channel.setCurrentTrack(null); this.#broadcast(name); },
      onNeedTrack: () => this.#feedNext(name),
      logger: this.#logger,
    }));

    this.#channels.set(name, { channel, runtime, runner: null });
    this.#startAmbient(name);
    this.#logger.info?.('livestream.channel.created', { name, format: channel.format, bitrate: channel.bitrate });
    this.#broadcast(name);
  }

  destroy(name) {
    const entry = this.#getEntry(name);
    entry.runtime.dispose();
    this.#channels.delete(name);
    this.#logger.info?.('livestream.channel.destroyed', { name });
  }

  destroyAll() {
    for (const name of [...this.#channels.keys()]) {
      const entry = this.#channels.get(name);
      entry.runtime.dispose();
      this.#channels.delete(name);
    }
  }

  queueFiles(name, files) {
    const { channel } = this.#getEntry(name);
    channel.enqueueAll(files);
    this.#logger.info?.('livestream.queue.add', { channel: name, count: files.length });
    this.#broadcast(name);
  }

  removeFromQueue(name, index) {
    const { channel } = this.#getEntry(name);
    channel.removeAt(index);
    this.#broadcast(name);
  }

  forcePlay(name, file) {
    const { channel, runtime } = this.#getEntry(name);
    channel.setCurrentTrack(file);
    runtime.play(file);
    this.#logger.info?.('livestream.force', { channel: name, file });
    this.#broadcast(name);
  }

  skip(name) {
    const { channel, runtime } = this.#getEntry(name);
    channel.setCurrentTrack(null);
    runtime.stopSource();
    this.#feedNext(name);
    this.#logger.info?.('livestream.skip', { channel: name });
    this.#broadcast(name);
  }

  stopPlayback(name) {
    const { channel } = this.#getEntry(name);
    channel.setCurrentTrack(null);
    channel.clearQueue();
    this.#startAmbient(name);
    this.#logger.info?.('livestream.stop', { channel: name });
    this.#broadcast(name);
  }

  sendInput(name, choice) {
    const entry = this.#getEntry(name);
    if (!entry.runner || !entry.runner.isWaitingForInput) {
      this.#logger.warn?.('livestream.input.no_program', { channel: name, choice });
      return;
    }
    entry.channel.setWaitingForInput(false);
    const action = entry.runner.receiveInput(choice);
    this.#executeAction(name, action);
    this.#broadcast(name);
  }

  openListener(name) {
    const { channel, runtime } = this.#getEntry(name);
    channel.addListener();
    const listener = runtime.openListener(() => {
      channel.removeListener();
      this.#broadcast(name);
    });
    return listener;
  }

  getStatus(name) {
    const { channel } = this.#getEntry(name);
    return toChannelStatus(channel);
  }

  listChannels() {
    return [...this.#channels.values()].map(({ channel }) => toChannelStatus(channel));
  }

  async startProgram(name, programName, programDef) {
    const entry = this.#getEntry(name);
    if (programDef.type === 'yaml') {
      const program = await this.#loadProgram(programDef.path);
      const runner = new ProgramRunner(program, { now: this.#clock, random: this.#random });
      entry.runner = runner;
      entry.channel.setProgram(programName);
      const action = runner.start();
      this.#executeAction(name, action);
    }
    this.#broadcast(name);
  }

  stopProgram(name) {
    const entry = this.#getEntry(name);
    entry.runner = null;
    entry.channel.setProgram(null);
    entry.channel.setWaitingForInput(false);
    this.stopPlayback(name);
  }

  #executeAction(name, action) {
    const entry = this.#channels.get(name);
    if (!entry) return;
    switch (action.type) {
      case 'play':
        entry.channel.setCurrentTrack(action.file);
        entry.runtime.play(action.file);
        break;
      case 'queue':
        entry.channel.enqueueAll(action.files);
        if (entry.channel.status === 'idle') this.#feedNext(name);
        break;
      case 'wait_for_input':
        entry.channel.setWaitingForInput(true, {
          timeout: action.timeout,
          default: action.default,
        });
        if (action.prompt) entry.runtime.play(action.prompt);
        if (action.timeout) {
          this.#scheduler.after(action.timeout * 1000, () => {
            if (entry.runner?.isWaitingForInput) this.sendInput(name, null);
          });
        }
        break;
      case 'stop':
        entry.runner = null;
        entry.channel.setProgram(null);
        this.#startAmbient(name);
        break;
    }
    this.#broadcast(name);
  }

  #feedNext(name) {
    if (!this.#channels.has(name)) return;
    const { channel, runtime, runner } = this.#channels.get(name);
    if (runner && !runner.isFinished && !runner.isWaitingForInput) {
      const action = runner.advance();
      this.#executeAction(name, action);
      return;
    }
    const next = channel.dequeue();
    if (next) {
      channel.setCurrentTrack(next);
      runtime.play(next);
      this.#broadcast(name);
    } else {
      this.#startAmbient(name);
    }
  }

  #startAmbient(name) {
    const { channel, runtime } = this.#channels.get(name);
    const ambient = channel.ambient;
    if (ambient === 'silence' || !ambient) {
      runtime.playSilence();
    } else if (ambient.startsWith('file:')) {
      runtime.playAmbientLoop(ambient.slice(5));
    } else {
      runtime.playSilence();
    }
  }

  #broadcast(name) {
    if (!this.#channels.has(name)) return;
    const { channel } = this.#channels.get(name);
    this.#broadcastEvent(`livestream:${name}`, toChannelStatus(channel));
  }

  #getEntry(name) {
    const entry = this.#channels.get(name);
    if (!entry) throw new Error(`Channel "${name}" not found`);
    return entry;
  }

}

export default ChannelManager;
