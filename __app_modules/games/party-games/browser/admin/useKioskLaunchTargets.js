import { useMemo } from 'react';
import { useApiResource } from '../../../../../frontend/src/lib/hooks/useApiResource.js';

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
 *            loading: boolean, error: Error|null, reload: () => void}}
 */
export function useKioskLaunchTargets() {
  const roster = useApiResource(LAUNCH_TARGETS_URL);
  const labels = useApiResource(DEVICE_CONFIG_URL);
  const targets = useMemo(() => {
    const devices = labels.data?.devices || labels.data || {};
    return (roster.data?.targets || []).map(target => ({
      deviceId: target.deviceId,
      label: devices[target.deviceId]?.name || target.deviceId,
      allow: Array.isArray(target.allow) ? target.allow.filter(Boolean) : [],
    }));
  }, [roster.data, labels.data]);

  return { targets, loading: roster.loading, error: roster.error, reload: roster.reload };
}

export default useKioskLaunchTargets;
