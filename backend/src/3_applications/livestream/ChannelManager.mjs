import { PassThrough } from 'stream';
import { StreamChannel } from '../../2_domains/livestream/StreamChannel.mjs';
import { SourceFeeder } from '../../2_domains/livestream/SourceFeeder.mjs';
import { FFmpegStreamAdapter } from '../../1_adapters/livestream/FFmpegStreamAdapter.mjs';

/**
 * ChannelManager — application service for livestream channels.
 *
 * Orchestrates channel lifecycle: create/destroy, wire up
 * FFmpegStreamAdapter ↔ SourceFeeder ↔ StreamChannel, route commands.
 */
export class ChannelManager {
  #channels = new Map();    // name → { channel, adapter, feeder, runner }
  #mediaBasePath;
  #broadcastEvent;
  #logger;

  constructor({ mediaBasePath, broadcastEvent, logger = console }) {
    this.#mediaBasePath = mediaBasePath;
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
    channel.setCurrentTrack(file);
    feeder.playFile(file);
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
    const { channel } = this.#getEntry(name);
    // ProgramRunner integration wired in Task 9
    this.#logger.info?.('livestream.input', { channel: name, choice });
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

  #feedNext(name) {
    if (!this.#channels.has(name)) return;
    const { channel, feeder } = this.#channels.get(name);
    const next = channel.dequeue();
    if (next) {
      channel.setCurrentTrack(next);
      feeder.playFile(next);
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
      feeder.playAmbientLoop(ambient.slice(5));
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
}

export default ChannelManager;
