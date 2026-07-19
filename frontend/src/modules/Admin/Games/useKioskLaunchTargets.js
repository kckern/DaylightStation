import { useState, useEffect } from 'react';

const LAUNCH_TARGETS_URL = '/api/v1/content/launch-targets/retroarch';
const DEVICE_CONFIG_URL = '/api/v1/device/config';

/**
 * Which devices a parent may launch a game on, and which titles on each.
 *
 * Reads the same endpoint the kiosk re-checks against, so admin and device can
 * never disagree about what is permitted. Source of truth is
 * `launch.device_targets` in games.yml:
 *
 *   launch:
 *     device_targets:
 *       yellow-room-tablet:
 *         allow:
 *           - retroarch:gb/super-mario-land-world-rev-1
 *
 * The allowlist is deliberate curation, not a reflection of what happens to be
 * on the device's disk: a title with a live save elsewhere must not boot on a
 * second device, because there is no save-sync and two divergent .srm files
 * cannot be reconciled afterwards. Absent config yields no targets, so the UI
 * offers nothing rather than guessing.
 *
 * Device labels come from the device registry so the picker reads "Piano Tablet"
 * rather than "yellow-room-tablet".
 *
 * @returns {{targets: Array<{deviceId: string, label: string, allow: string[]}>,
 *            loading: boolean, error: string|null}}
 */
export function useKioskLaunchTargets() {
  const [state, setState] = useState({ targets: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    const json = (url) => fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });

    Promise.all([
      json(LAUNCH_TARGETS_URL),
      // Labels are cosmetic — a failure here must not cost us the targets.
      json(DEVICE_CONFIG_URL).catch(() => null)
    ])
      .then(([launchTargets, deviceConfig]) => {
        if (cancelled) return;
        const devices = deviceConfig?.devices || deviceConfig || {};

        const targets = (launchTargets?.targets || []).map((t) => ({
          deviceId: t.deviceId,
          label: devices?.[t.deviceId]?.name || t.deviceId,
          allow: Array.isArray(t.allow) ? t.allow.filter(Boolean) : []
        }));

        setState({ targets, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ targets: [], loading: false, error: err.message });
      });

    return () => { cancelled = true; };
  }, []);

  return state;
}

export default useKioskLaunchTargets;
