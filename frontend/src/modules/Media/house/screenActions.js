// frontend/src/modules/Media/house/screenActions.js
// One-screen actions the house view (and a screen's controls) offer beyond
// transport: Put it back (RQ-STEER-21), switching Add only off from the row
// (RQ-PLAY-10), and Stop "and turn the screen off" (RQ-STEER-11). Each
// reports through the one outcome system, naming the screen.
import { useCallback, useContext } from 'react';
import { PeekContext } from '../peek/PeekContext.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { deviceKind } from '../cast/castCopy.js';
import { houseApi as defaultApi } from './houseApi.js';
import houseLog from './houseLog.js';

/**
 * Whether Stop may offer "and turn the screen off" (RQ-STEER-11, O4): only a
 * configured screen with device control (devices.yml `device_control`, the
 * one `/device/:id/off` acts on), never a speaker or a browser.
 */
export function supportsScreenOff(device) {
  if (!device || typeof device.id !== 'string' || device.id.startsWith('browser:')) return false;
  if (deviceKind(device) === 'speaker') return false;
  return !!(device.device_control || device.capabilities?.deviceControl);
}

const PUT_BACK_REASONS = {
  PUT_BACK_UNAVAILABLE: 'Something newer is playing there, or it was too long ago',
};

function reasonOf(error) {
  const code = error?.code ?? error?.http?.code ?? null;
  if (code && PUT_BACK_REASONS[code]) return PUT_BACK_REASONS[code];
  const message = error?.message ?? '';
  if (/PUT_BACK_UNAVAILABLE/.test(message)) return PUT_BACK_REASONS.PUT_BACK_UNAVAILABLE;
  return "The screen didn't answer";
}

export function useScreenActions({ api = defaultApi } = {}) {
  const peek = useContext(PeekContext);
  const outcomes = useContext(DispatchContext);

  const report = useCallback((deviceId, kind, ok, copy) => {
    outcomes?.recordLocal?.({
      kind, phase: ok ? 'confirmed' : 'failed', targetId: deviceId,
      item: { contentId: null, title: null }, command: { copy },
    });
  }, [outcomes]);

  const putBack = useCallback(async ({ deviceId, name, noteId }) => {
    try {
      const result = await peek?.getController?.(deviceId)?.sessionControls?.putBack?.(noteId);
      if (!result || result.ok === false) throw Object.assign(new Error(result?.error ?? 'refused'), { code: result?.code });
      houseLog.putBack({ deviceId, noteId });
      report(deviceId, 'putBack', true, { primary: `Put back on ${name}`, secondary: null });
      return true;
    } catch (error) {
      houseLog.putBackFailed({ deviceId, noteId, error: error?.message, code: error?.code ?? null });
      report(deviceId, 'putBack', false, { primary: `Couldn't put it back on ${name}`, secondary: reasonOf(error) });
      return false;
    }
  }, [peek, report]);

  const addOnlyOff = useCallback(async ({ deviceId, name }) => {
    try {
      const result = await peek?.getController?.(deviceId)?.sessionControls?.setAddOnly?.(false);
      if (!result || result.ok === false) throw new Error(result?.error ?? 'refused');
      houseLog.addOnlyOff({ deviceId });
      report(deviceId, 'addOnly', true, { primary: `Add only is off on ${name}`, secondary: 'Play from any device replaces what plays there again' });
      return true;
    } catch (error) {
      houseLog.addOnlyOffFailed({ deviceId, error: error?.message });
      report(deviceId, 'addOnly', false, { primary: `Couldn't turn Add only off on ${name}`, secondary: reasonOf(error) });
      return false;
    }
  }, [peek, report]);

  const stopAndTurnOff = useCallback(async ({ deviceId, name }) => {
    let stopped = false;
    try {
      const result = await peek?.getController?.(deviceId)?.transport?.stop?.({ keepMusic: false });
      stopped = !!result && result.ok !== false;
    } catch { stopped = false; }
    try {
      await api.screenOff(deviceId);
      houseLog.screenOff({ deviceId, stopped });
      report(deviceId, 'screenOff', true, {
        primary: stopped ? `Stopped ${name} and turned the screen off` : `Turned ${name} off`,
        secondary: stopped ? 'Queue kept' : null,
      });
      return true;
    } catch (error) {
      houseLog.screenOffFailed({ deviceId, stopped, status: error?.status ?? null, error: error?.message });
      report(deviceId, 'screenOff', false, {
        primary: `Couldn't turn ${name} off`,
        secondary: error?.code === 'DEVICE_BUSY' ? 'A video call is in progress there' : (stopped ? 'Playback stopped; the screen is still on' : "The screen didn't answer"),
      });
      return false;
    }
  }, [peek, api, report]);

  return { putBack, addOnlyOff, stopAndTurnOff };
}

export default useScreenActions;
