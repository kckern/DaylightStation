/**
 * Home Assistant detection source — the PRIMARY classifier for the camera
 * ledger.
 *
 * HA exposes per-camera AI detections as binary sensors
 * (`binary_sensor.driveway_camera_person`, `binary_sensor.front_door_person`,
 * …). This turns their state history into labelled time intervals the ledger
 * can join against clips.
 *
 * Why this matters more than the filename-bit fallback:
 *
 *  - It is a documented, vendor-maintained interface. The filename trigger bits
 *    are reverse-engineered, model-specific, and could change silently on a
 *    firmware update.
 *  - It is the ONLY label source for the doorbell, whose filename encoding does
 *    not discriminate at all.
 *
 * Its hard limit is retention: HA's recorder keeps detailed `states` for
 * ~10 days by default, and long-term statistics exclude binary sensors
 * entirely (only numeric, state_class entities are kept). So there is no deeper
 * archive to mine — detections older than the recorder window are gone for
 * good, which is exactly why the ledger must run daily.
 *
 * @module 1_adapters/camera/HaDetectionSource
 */

/**
 * @param {Object} deps
 * @param {Object} deps.haGateway - HomeAssistantAdapter (needs getHistory)
 * @param {Object} deps.sensorsByCamera - { cameraId: { label: entityId } }
 * @param {Object} [deps.logger]
 */
export function createHaDetectionSource({ haGateway, sensorsByCamera = {}, logger = console }) {
  return {
    /**
     * Labelled detection intervals for one camera-day.
     * @returns {Promise<Array<{start:string,end:string,label:string}>>}
     */
    async fetchDay(cameraId, day) {
      const sensors = sensorsByCamera[cameraId] ?? {};
      const entityIds = Object.values(sensors).filter(Boolean);
      if (!entityIds.length) {
        logger.debug?.('camera.ha.no_sensors', { camera: cameraId });
        return [];
      }

      const start = new Date(`${day}T00:00:00`);
      const end = new Date(`${day}T23:59:59.999`);

      let history;
      try {
        history = await haGateway.getHistory(entityIds, {
          sinceIso: start.toISOString(),
          endIso: end.toISOString(),
        });
      } catch (err) {
        // Never fail the ledger over HA: the filename-bit fallback and the
        // density timeline still produce a usable record.
        logger.warn?.('camera.ha.history_failed', { camera: cameraId, day, error: err.message });
        return [];
      }

      const labelOf = Object.fromEntries(Object.entries(sensors).map(([label, id]) => [id, label]));
      const intervals = [];

      for (const [entityId, points] of history) {
        const label = labelOf[entityId];
        if (!label) continue;
        intervals.push(...toOnIntervals(points, label, end));
      }

      intervals.sort((a, b) => new Date(a.start) - new Date(b.start));
      logger.debug?.('camera.ha.intervals', { camera: cameraId, day, count: intervals.length });
      return intervals;
    },
  };
}

/**
 * Collapse a state series into the spans where the sensor read "on".
 *
 * HA reports state CHANGES, not samples, so an interval runs from an `on`
 * point to the next non-`on` point. A trailing `on` with no closing point means
 * the sensor was still triggered at the window edge — clamp it to the end of
 * the day rather than dropping it, which would silently lose the detection.
 */
function toOnIntervals(points, label, windowEnd) {
  const out = [];
  let openedAt = null;

  for (const p of points) {
    const isOn = String(p.v).toLowerCase() === 'on';
    if (isOn && !openedAt) {
      openedAt = p.t;
    } else if (!isOn && openedAt) {
      out.push({ start: openedAt, end: p.t, label });
      openedAt = null;
    }
  }
  if (openedAt) out.push({ start: openedAt, end: windowEnd.toISOString(), label });
  return out;
}

export default createHaDetectionSource;
