import { PassThrough } from 'stream';
import path from 'path';
import { StreamChannel } from '../../2_domains/livestream/StreamChannel.mjs';
import { SourceFeeder } from '../../2_domains/livestream/SourceFeeder.mjs';
import { FFmpegStreamAdapter } from '../../1_adapters/livestream/FFmpegStreamAdapter.mjs';
import { ProgramRunner } from '../../2_domains/livestream/ProgramRunner.mjs';

/**
 * ChannelManager — application service for livestream channels.
 *
 * Orchestrates channel lifecycle: create/destroy, wire up
 * FFmpegStreamAdapter ↔ SourceFeeder ↔ StreamChannel, route commands.
 */
export class ChannelManager {
  #channels = new Map();    // name → { channel, adapter, feeder, runner }
  #mediaBasePath;
  #programsBasePath;
  #broadcastEvent;
  #logger;

  constructor({ mediaBasePath, programsBasePath, broadcastEvent, logger = console }) {
    this.#mediaBasePath = mediaBasePath;
    this.#programsBasePath = programsBasePath;
    this.#broadcastEvent = broadcastEvent;
    this.#logger = logger;
  }

  create(name, config = {}) {
    if (this.#channels.has(name)) throw new Error(`Channel "${name}" already exists`);

    const channel = new StreamChannel({ name, ...config });
    const adapter = new FFmpegStreamAdapter({
      format: channel.format, bitrate: channel.bitrate, logger: this.#logger,
    });
    const encoderStdin = adapter.start();

    const feeder = new SourceFeeder({
      encoderStdin,
      onTrackEnd: () => { channel.setCurrentTrack(null); this.#broadcast(name); },
      onNeedTrack: () => this.#feedNext(name),
      logger: this.#logger,
    });

    this.#channels.set(name, { channel, adapter, feeder, runner: null });
    this.#startAmbient(name);
    this.#logger.info?.('livestream.channel.created', { name, format: channel.format, bitrate: channel.bitrate });
    this.#broadcast(name);
  }

  destroy(name) {
    const entry = this.#getEntry(name);
    entry.feeder.stop();
    entry.adapter.stop();
    this.#channels.delete(name);
    this.#logger.info?.('livestream.channel.destroyed', { name });
  }

  destroyAll() {
    for (const name of [...this.#channels.keys()]) {
      const entry = this.#channels.get(name);
      entry.feeder.stop();
      entry.adapter.stop();
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
    const { channel, feeder } = this.#getEntry(name);
    const resolved = this.#resolvePath(file);
    channel.setCurrentTrack(file);
    feeder.playFile(resolved);
    this.#logger.info?.('livestream.force', { channel: name, file });
    this.#broadcast(name);
  }

  skip(name) {
    const { channel, feeder } = this.#getEntry(name);
    channel.setCurrentTrack(null);
    feeder.stop();
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

  getClientStream(name) {
    const { channel, adapter } = this.#getEntry(name);
    const stream = new PassThrough();
    const clientId = adapter.addClient(stream);
    channel.addListener();
    stream.on('close', () => {
      adapter.removeClient(clientId);
      channel.removeListener();
      this.#broadcast(name);
    });
    return { stream, clientId };
  }

  getStatus(name) {
    const { channel } = this.#getEntry(name);
    return channel.toJSON();
  }

  listChannels() {
    return [...this.#channels.values()].map(({ channel }) => channel.toJSON());
  }

  async startProgram(name, programName, programDef) {
    const entry = this.#getEntry(name);
    if (programDef.type === 'yaml') {
      const fs = await import('fs');
      const yaml = await import('js-yaml');
      const path = await import('path');
      const fullPath = path.default.join(this.#programsBasePath, programDef.path);
      const content = fs.default.readFileSync(fullPath, 'utf8');
      const program = yaml.default.load(content);
      const runner = new ProgramRunner(program);
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
        entry.feeder.playFile(this.#resolvePath(action.file));
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
        if (action.prompt) entry.feeder.playFile(this.#resolvePath(action.prompt));
        if (action.timeout) {
          setTimeout(() => {
            if (entry.runner?.isWaitingForInput) this.sendInput(name, null);
          }, action.timeout * 1000);
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
    const { channel, feeder, runner } = this.#channels.get(name);
    if (runner && !runner.isFinished && !runner.isWaitingForInput) {
      const action = runner.advance();
      this.#executeAction(name, action);
      return;
    }
    const next = channel.dequeue();
    if (next) {
      channel.setCurrentTrack(next);
      feeder.playFile(this.#resolvePath(next));
      this.#broadcast(name);
    } else {
      this.#startAmbient(name);
    }
  }

  #startAmbient(name) {
    const { channel, feeder } = this.#channels.get(name);
    const ambient = channel.ambient;
    if (ambient === 'silence' || !ambient) {
      feeder.playSilence();
    } else if (ambient.startsWith('file:')) {
      feeder.playAmbientLoop(this.#resolvePath(ambient.slice(5)));
    } else {
      feeder.playSilence();
    }
  }

  #broadcast(name) {
    if (!this.#channels.has(name)) return;
    const { channel } = this.#channels.get(name);
    this.#broadcastEvent(`livestream:${name}`, channel.toJSON());
  }

  #getEntry(name) {
    const entry = this.#channels.get(name);
    if (!entry) throw new Error(`Channel "${name}" not found`);
    return entry;
  }

  /**
   * Resolve a file path — if relative, prepend mediaBasePath.
   * @private
   */
  #resolvePath(filePath) {
    if (!filePath) return filePath;
    if (path.isAbsolute(filePath)) return filePath;
    // Resolve relative to app root (one level above backend/)
    return path.resolve('..', filePath);
  }
}

export default ChannelManager;
