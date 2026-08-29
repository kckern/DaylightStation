import { assertStreamChannelRuntime } from '#apps/livestream/ports/IStreamChannelRuntime.mjs';

/**
 * Owns encoder/decoder plumbing and listener stream lifecycle for one channel.
 * The application sees asset references and a semantic listener subscription;
 * encoder stdin and Node stream events stay inside this adapter.
 */
export class StreamChannelRuntimeAdapter {
  constructor({ format, bitrate, createEncoder, createFeeder, onTrackEnd, onNeedTrack, logger = console }) {
    if (typeof createEncoder !== 'function' || typeof createFeeder !== 'function') {
      throw new Error('StreamChannelRuntimeAdapter requires encoder and feeder factories');
    }
    this.encoder = createEncoder({ format, bitrate, logger });
    const encoderInput = this.encoder.start();
    this.feeder = createFeeder({ encoderStdin: encoderInput, onTrackEnd, onNeedTrack, logger });
    assertStreamChannelRuntime(this);
  }

  dispose() {
    this.feeder.stop();
    this.encoder.stop();
  }

  play(assetRef) { return this.feeder.playFile(assetRef); }
  stopSource() { return this.feeder.stop(); }
  playSilence() { return this.feeder.playSilence(); }
  playAmbientLoop(assetRef) { return this.feeder.playAmbientLoop(assetRef); }

  openListener(onClose) {
    const { stream, clientId } = this.encoder.openClient();
    if (onClose) stream.on('close', onClose);
    return {
      clientId,
      pipeTo: (destination) => stream.pipe(destination),
      close: () => stream.destroy(),
    };
  }
}

export default StreamChannelRuntimeAdapter;
