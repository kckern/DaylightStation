import { useState, useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { STRATEGIES, RMS_THRESHOLD } from './audioProbeStrategies.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useAudioProbe' });
  return _logger;
}

/**
 * Probes audio devices to find a working mic + capture method.
 * Provides continuous volume metering from the winning strategy.
 *
 * @param {MediaDeviceInfo[]} audioDevices - List from useMediaDevices
 * @param {Object} [options]
 * @param {string} [options.preferredDeviceId] - Try this device first
 * @returns {{ workingDeviceId, volume, method, status, probingDeviceLabel, diagnostics }}
 */
export const useAudioProbe = (audioDevices, options = {}) => {
  const { preferredDeviceId } = options;

  const [workingDeviceId, setWorkingDeviceId] = useState(null);
  const [volume, setVolume] = useState(0);
  const [method, setMethod] = useState(null);
  const [status, setStatus] = useState('probing');
  const [probingDeviceLabel, setProbingDeviceLabel] = useState('');
  const [diagnostics, setDiagnostics] = useState([]);

  // Refs for cleanup and ongoing metering
  const meterCleanupRef = useRef(null);
  const cancelledRef = useRef(false);

  // Stable reference to the probe runner
  const runProbe = useCallback(async (devices, preferred) => {
    cancelledRef.current = false;
    setStatus('probing');
    setWorkingDeviceId(null);
    setVolume(0);
    setMethod(null);
    setDiagnostics([]);

    if (devices.length === 0) {
      setStatus('no-mic');
      logger().warn('audio-probe-failed', { reason: 'no-devices' });
      return;
    }

    // Order devices: preferred first, then the rest
    const ordered = [...devices];
    if (preferred) {
      const prefIdx = ordered.findIndex(d => d.deviceId === preferred);
      if (prefIdx > 0) {
        const [pref] = ordered.splice(prefIdx, 1);
        ordered.unshift(pref);
      }
    }

    logger().info('audio-probe-start', {
      deviceCount: ordered.length,
      preferredDeviceId: preferred?.slice(0, 8),
      devices: ordered.map(d => ({ id: d.deviceId.slice(0, 8), label: d.label })),
    });

    const allDiagnostics = [];

    for (const device of ordered) {
      if (cancelledRef.current) return;

      setProbingDeviceLabel(device.label || device.deviceId.slice(0, 8));
      const deviceDiag = { deviceId: device.deviceId, label: device.label, methods: {} };

      // Acquire audio stream for this device
      let testStream;
      try {
        testStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: device.deviceId } },
        });
      } catch (err) {
        logger().info('audio-probe-result', {
          deviceId: device.deviceId.slice(0, 8),
          label: device.label,
          method: 'getUserMedia',
          rms: 0,
          verdict: 'error',
          error: err.message,
        });
        deviceDiag.methods.getUserMedia = 'error';
        allDiagnostics.push(deviceDiag);
        continue;
      }

      // Try each strategy
      for (const strategy of STRATEGIES) {
        if (cancelledRef.current) {
          testStream.getTracks().forEach(t => t.stop());
          return;
        }

        logger().info('audio-probe-testing', {
          deviceId: device.deviceId.slice(0, 8),
          label: device.label,
          method: strategy.name,
        });

        try {
          const result = await strategy.fn(testStream);
          const verdict = result.rms >= RMS_THRESHOLD ? 'active' : 'silent';

          logger().info('audio-probe-result', {
            deviceId: device.deviceId.slice(0, 8),
            label: device.label,
            method: strategy.name,
            rms: Math.round(result.rms * 10000) / 10000,
            verdict,
          });

          deviceDiag.methods[strategy.name] = verdict;

          if (verdict === 'active') {
            // Clean up the probe strategy's AudioContext (ongoing meter creates its own)
            result.cleanup();

            // Check cancellation after async strategy resolved
            if (cancelledRef.current) {
              testStream.getTracks().forEach(t => t.stop());
              return;
            }

            // Winner found!
            logger().info('audio-probe-winner', {
              deviceId: device.deviceId.slice(0, 8),
              label: device.label,
              method: strategy.name,
              rms: Math.round(result.rms * 10000) / 10000,
            });

            setWorkingDeviceId(device.deviceId);
            setMethod(strategy.name);
            setStatus('ready');
            setProbingDeviceLabel('');

            // Start ongoing metering with the winning strategy
            startOngoingMeter(strategy, testStream, device);

            allDiagnostics.push(deviceDiag);
            setDiagnostics(allDiagnostics);
            return; // Done!
          }

          // Strategy didn't work, clean up its resources
          result.cleanup();
        } catch (err) {
          logger().info('audio-probe-result', {
            deviceId: device.deviceId.slice(0, 8),
            label: device.label,
            method: strategy.name,
            rms: 0,
            verdict: 'error',
            error: err.message,
          });
          deviceDiag.methods[strategy.name] = 'error';
        }
      }

      // No strategy worked for this device — stop stream and move on
      testStream.getTracks().forEach(t => t.stop());
      allDiagnostics.push(deviceDiag);
    }

    // All devices exhausted
    setStatus('no-mic');
    setProbingDeviceLabel('');
    setDiagnostics(allDiagnostics);
    logger().warn('audio-probe-failed', { diagnostics: allDiagnostics });
  }, []);

  /**
   * Start ongoing volume metering using the winning strategy.
   * For AudioWorklet, create a new worklet. For ScriptProcessor or MediaRecorder
   * winner, use ScriptProcessor for ongoing metering (MediaRecorder is too
   * expensive for continuous use).
   */
  const startOngoingMeter = useCallback((strategy, stream, device) => {
    // Clean up any previous meter
    if (meterCleanupRef.current) meterCleanupRef.current();

    if (strategy.name === 'audioWorklet') {
      // Re-run AudioWorklet for ongoing metering
      const ctx = new AudioContext();
      let setupDone = false;

      const setup = async () => {
        try {
          const processorSource = `
class VolumeMeterProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const samples = input[0];
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      this.port.postMessage({ rms: Math.sqrt(sum / samples.length) });
    }
    return true;
  }
}
registerProcessor('volume-meter-ongoing', VolumeMeterProcessor);`;
          const blob = new Blob([processorSource], { type: 'application/javascript' });
          const url = URL.createObjectURL(blob);
          await ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);

          const source = ctx.createMediaStreamSource(stream);
          const node = new AudioWorkletNode(ctx, 'volume-meter-ongoing');
          source.connect(node);
          node.connect(ctx.destination);
          setupDone = true;

          let sampleCount = 0;
          let maxLevel = 0;

          node.port.onmessage = (e) => {
            if (cancelledRef.current) return;
            const { rms } = e.data;
            setVolume(rms);
            sampleCount++;
            if (rms > maxLevel) maxLevel = rms;
            if (sampleCount % 250 === 0) {
              logger().info('audio-probe-volume', {
                method: 'audioWorklet',
                maxLevel: Math.round(maxLevel * 1000) / 1000,
                samples: sampleCount,
                device: device.label,
              });
              maxLevel = 0;
            }
          };

          meterCleanupRef.current = () => {
            node.disconnect();
            source.disconnect();
            ctx.close();
            stream.getTracks().forEach(t => t.stop());
          };
        } catch (err) {
          logger().warn('ongoing-meter-setup-failed', { method: 'audioWorklet', error: err.message });
          if (!setupDone) ctx.close();
        }
      };
      setup();

    } else {
      // ScriptProcessor for ongoing metering (also used as fallback for MediaRecorder winner)
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      source.connect(processor);
      processor.connect(ctx.destination);

      let sampleCount = 0;
      let maxLevel = 0;

      processor.onaudioprocess = (event) => {
        if (cancelledRef.current) return;
        const samples = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        setVolume(rms);
        sampleCount++;
        if (rms > maxLevel) maxLevel = rms;
        if (sampleCount % 250 === 0) {
          logger().info('audio-probe-volume', {
            method: 'scriptProcessor',
            maxLevel: Math.round(maxLevel * 1000) / 1000,
            samples: sampleCount,
            device: device.label,
          });
          maxLevel = 0;
        }
      };

      meterCleanupRef.current = () => {
        processor.disconnect();
        source.disconnect();
        ctx.close();
        stream.getTracks().forEach(t => t.stop());
      };
    }
  }, []);

  // Run probe when audioDevices change
  useEffect(() => {
    if (audioDevices.length === 0) return;

    runProbe(audioDevices, preferredDeviceId);

    return () => {
      cancelledRef.current = true;
      if (meterCleanupRef.current) meterCleanupRef.current();
    };
  }, [audioDevices, preferredDeviceId, runProbe]);

  return { workingDeviceId, volume, method, status, probingDeviceLabel, diagnostics };
};
