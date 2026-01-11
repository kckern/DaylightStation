/**
 * Session normalization helpers for fitness data persistence.
 * Extracted for testability without express dependencies.
 */

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const trimTrailingNulls = (series = []) => {
    if (!Array.isArray(series)) return [];
    const copy = series.map((value) => (value === undefined ? null : value));
    let end = copy.length;
    while (end > 0 && copy[end - 1] == null) {
        end -= 1;
    }
    return copy.slice(0, end);
};

const normalizeNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

/**
 * Normalize a timestamp field for persistence.
 * Accepts either unix-ms numbers or human-readable strings.
 *
 * @param {unknown} value
 * @returns {number|string|null}
 */
const normalizeTimestamp = (value) => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    return normalizeNumber(value);
};

/**
 * Summarize series keys and value types for logging during serialization.
 * @param {object} series
 * @returns {{ keyCount: number, arrayCount: number, stringCount: number, otherCount: number, sampleKeys: string[] }}
 */
const summarizeSeriesKeys = (series = {}) => {
    if (!isPlainObject(series)) {
        return { keyCount: 0, arrayCount: 0, stringCount: 0, otherCount: 0, sampleKeys: [] };
    }
    const keys = Object.keys(series);
    let arrayCount = 0;
    let stringCount = 0;
    let otherCount = 0;
    keys.forEach((key) => {
        const value = series[key];
        if (Array.isArray(value)) arrayCount += 1;
        else if (typeof value === 'string') stringCount += 1;
        else otherCount += 1;
    });
    return {
        keyCount: keys.length,
        arrayCount,
        stringCount,
        otherCount,
        sampleKeys: keys.slice(0, 5)
    };
};

/**
 * Detect if session data is v3 format.
 * V3 format has a `version: 3` field and nested session/timeline structure.
 * @param {object} sessionData
 * @returns {boolean}
 */
export const isV3Format = (sessionData) => {
    if (!isPlainObject(sessionData)) return false;
    return (
        sessionData.version === 3 &&
        isPlainObject(sessionData.session) &&
        typeof sessionData.session.id === 'string'
    );
};

/**
 * Normalize v2 timeline for persistence.
 * @param {object} timeline
 * @returns {object|null}
 */
const normalizeV2TimelineForPersistence = (timeline = {}) => {
    if (!isPlainObject(timeline)) return null;
    const normalizedSeries = {};
    const sourceSeries = timeline.series && isPlainObject(timeline.series) ? timeline.series : {};
    Object.entries(sourceSeries).forEach(([key, values]) => {
        // Accept both arrays (raw data) and strings (encoded RLE from frontend)
        if (!Array.isArray(values) && typeof values !== 'string') return;
        // If it's an array, trim trailing nulls; if string, pass through (already encoded)
        normalizedSeries[key] = Array.isArray(values) ? trimTrailingNulls(values) : values;
    });

    const normalizedEvents = Array.isArray(timeline.events)
        ? timeline.events
            .map((event) => {
                if (!isPlainObject(event)) return null;
                const type = typeof event.type === 'string' ? event.type.trim() : null;
                if (!type) return null;
                return {
                    timestamp: normalizeTimestamp(event.timestamp),
                    offsetMs: normalizeNumber(event.offsetMs),
                    tickIndex: Number.isFinite(event.tickIndex) ? event.tickIndex : null,
                    type,
                    source: typeof event.source === 'string' ? event.source : null,
                    data: isPlainObject(event.data) ? { ...event.data } : (event.data ?? null)
                };
            })
            .filter(Boolean)
        : [];

    const timebase = isPlainObject(timeline.timebase) ? { ...timeline.timebase } : {};
    if (!Number.isFinite(timebase.startTime)) {
        timebase.startTime = Date.now();
    }
    if (!(Number.isFinite(timebase.intervalMs) && timebase.intervalMs > 0)) {
        timebase.intervalMs = 5000;
    }
    if (!Number.isFinite(timebase.tickCount)) {
        const fallback = Object.values(normalizedSeries)[0]?.length ?? 0;
        timebase.tickCount = fallback;
    }

    const normalizedTimeline = {
        ...timeline,
        timebase,
        series: normalizedSeries,
        events: normalizedEvents
    };

    // Legacy noise fields should not be persisted.
    delete normalizedTimeline.seriesMeta;

    return normalizedTimeline;
};

/**
 * Prepare session data for persistence.
 * Handles both v2 (legacy) and v3 (new) formats.
 * V3 format passes through with minimal validation.
 * V2 format is normalized as before.
 *
 * @param {object} sessionData
 * @returns {object}
 */
export const prepareSessionForPersistence = (sessionData = {}) => {
    if (!isPlainObject(sessionData)) return sessionData;

    // V3 format: pass through with minimal cleanup
    if (isV3Format(sessionData)) {
        const prepared = { ...sessionData };
        // Only remove truly transient fields that should never persist
        delete prepared._persistWarnings;
        return prepared;
    }

    // V2 format: legacy normalization
    const prepared = { ...sessionData };

    // Legacy fields that should never be persisted.
    delete prepared._persistWarnings;
    delete prepared.seriesMeta;
    delete prepared.voiceMemos;
    delete prepared.deviceAssignments;

    const hasTopLevelEvents = Array.isArray(prepared.events) && prepared.events.length > 0;
    if (prepared.timeline) {
        const normalizedTimeline = normalizeV2TimelineForPersistence(prepared.timeline);
        if (normalizedTimeline) {
            prepared.timeline = normalizedTimeline;
            prepared.timebase = normalizedTimeline.timebase;
            if (!hasTopLevelEvents) {
                prepared.events = normalizedTimeline.events;
            }
        }
    }

    return prepared;
};

/**
 * Stringify v2 timeline series for file persistence.
 * @param {object} sessionData
 * @param {object} logger - Optional logger for diagnostics
 * @returns {object}
 */
export const stringifyTimelineSeriesForFile = (sessionData = {}, logger = null) => {
    if (!isPlainObject(sessionData)) return sessionData;

    // V3 format: timeline.participants/equipment/global are already RLE-encoded strings
    if (isV3Format(sessionData)) {
        return sessionData;
    }

    // V2 format: stringify timeline.series
    if (!sessionData.timeline || !isPlainObject(sessionData.timeline)) return sessionData;
    const clone = { ...sessionData, timeline: { ...sessionData.timeline } };
    const sourceSeries = sessionData.timeline.series;
    if (!isPlainObject(sourceSeries)) return clone;

    const preStats = summarizeSeriesKeys(sourceSeries);
    const serializedSeries = {};
    const droppedKeys = [];

    Object.entries(sourceSeries).forEach(([key, values]) => {
        if (!Array.isArray(values) && typeof values !== 'string') {
            droppedKeys.push(key);
            return;
        }
        if (typeof values === 'string') {
            // Empty-series filtering: if the encoded string represents an all-null series, drop it.
            try {
                const parsed = JSON.parse(values);
                if (!Array.isArray(parsed) || parsed.length === 0) {
                    droppedKeys.push(key);
                    return;
                }
                const hasAnyNonNull = parsed.some((entry) => {
                    if (Array.isArray(entry) && entry.length >= 2) {
                        const [val, count] = entry;
                        const reps = Number.isFinite(count) && count > 0 ? count : 0;
                        return reps > 0 && val != null;
                    }
                    return entry != null;
                });
                if (!hasAnyNonNull) {
                    droppedKeys.push(key);
                    return;
                }
            } catch (_) {
                // Not JSON; keep as-is.
            }
            serializedSeries[key] = values;
            return;
        }

        // Empty-series filtering: drop empty/all-null series.
        if (!values.length || values.every((v) => v == null)) {
            droppedKeys.push(key);
            return;
        }
        try {
            serializedSeries[key] = JSON.stringify(values);
        } catch (_) {
            serializedSeries[key] = '[]';
        }
    });
    clone.timeline.series = serializedSeries;

    if (logger) {
        const postStats = summarizeSeriesKeys(serializedSeries);
        if (preStats.keyCount && postStats.keyCount === 0) {
            logger.error('fitness.series.serialize.empty', {
                sessionId: sessionData.sessionId,
                preStats,
                postStats,
                droppedKeys: droppedKeys.slice(0, 10)
            });
        } else if (droppedKeys.length) {
            logger.warn('fitness.series.serialize.dropped', {
                sessionId: sessionData.sessionId,
                droppedKeys: droppedKeys.slice(0, 10),
                droppedCount: droppedKeys.length,
                preStats,
                postStats
            });
        } else {
            logger.debug('fitness.series.serialize.stats', {
                sessionId: sessionData.sessionId,
                preStats,
                postStats
            });
        }
    }

    return clone;
};

export { isPlainObject, summarizeSeriesKeys };
