/**
 * Live-input stabilisers for the race chart.
 *
 * The fitness context re-renders on every heart-rate sample. Its roster array,
 * `getUserTimelineSeries` and `participantDisplayMap` all get a new identity on
 * each of those renders (the roster's signature includes the rounded HR), so
 * the chart rebuilt every series and re-rendered 15–17 times a second with
 * five straps live (audit 2026-10-29, `fitness.render_thrashing` FitnessChart).
 *
 * The chart draws per timeline TICK (5s). Nothing it draws depends on the
 * per-sample heart rate except the focus legend's HR/progress readout, which
 * is throttled. These hooks hand the chart new references only when something
 * it draws changed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

/** Fields of a roster entry the chart actually draws (no heart rate). */
export function chartRosterKey(roster) {
	if (!Array.isArray(roster)) return String(roster);
	return roster.map((e) => [
		e?.id, e?.profileId, e?.hrDeviceId, e?.name, e?.displayLabel,
		e?.avatarUrl, e?.zoneColor, e?.isActive !== false,
	].map((v) => (v == null ? '' : String(v))).join('\u0001')).join('\u0002');
}

/** Same array reference until a chart-relevant roster field changes. */
export function useStableChartRoster(roster) {
	const ref = useRef({ key: undefined, value: roster });
	const key = chartRosterKey(roster);
	if (ref.current.key !== key) ref.current = { key, value: roster };
	return ref.current.value;
}

/**
 * A series getter whose identity changes only when the timeline can hold new
 * data for the chart: a new tick, a session change, or `versionKey` (roster /
 * stint transfers). It always reads through to the latest getter.
 */
export function useStableSeriesGetter(getSeries, { tickCount = 0, sessionId = null, versionKey = '' } = {}) {
	const latest = useRef(getSeries);
	latest.current = getSeries;
	const available = typeof getSeries === 'function';
	return useMemo(
		() => (available ? (...args) => latest.current?.(...args) : getSeries),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[available, tickCount, sessionId, versionKey]
	);
}

/** A stable callback that always calls the latest `fn` (or undefined when there is none). */
export function useLatestCallback(fn) {
	const latest = useRef(fn);
	latest.current = fn;
	const present = typeof fn === 'function';
	return useMemo(() => (present ? (...args) => latest.current?.(...args) : undefined), [present]);
}

/** Trailing throttle: at most one new value per `ms`, never drops the last one. */
export function useThrottledValue(value, ms) {
	const [current, setCurrent] = useState(value);
	const lastEmitRef = useRef(0);
	const timerRef = useRef(null);
	const latestRef = useRef(value);
	latestRef.current = value;

	useEffect(() => {
		if (value === current) return undefined;
		const now = Date.now();
		const wait = ms - (now - lastEmitRef.current);
		if (wait <= 0) {
			lastEmitRef.current = now;
			setCurrent(value);
			return undefined;
		}
		if (!timerRef.current) {
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				lastEmitRef.current = Date.now();
				setCurrent(latestRef.current);
			}, wait);
		}
		return undefined;
	}, [value, current, ms]);

	useEffect(() => () => {
		if (timerRef.current) clearTimeout(timerRef.current);
	}, []);

	return current;
}
