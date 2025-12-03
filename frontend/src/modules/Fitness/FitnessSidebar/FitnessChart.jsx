import React, { useEffect, useMemo } from 'react';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import './FitnessChart.scss';

const DEFAULT_WINDOW = 24;
const DEFAULT_ROWS = 4;
const isProductionBuild = (() => {
	if (typeof import.meta !== 'undefined' && import.meta?.env) {
		return Boolean(import.meta.env.PROD);
	}
	if (typeof process !== 'undefined' && process.env) {
		return process.env.NODE_ENV === 'production';
	}
	return false;
})();

const formatBpm = (value) => (Number.isFinite(value) ? Math.round(value) : '—');

const Sparkline = ({ data, width = 140, height = 36 }) => {
	const { path } = useMemo(() => {
		if (!Array.isArray(data) || data.length < 2) {
			return { path: null };
		}
		const numeric = data.filter((value) => Number.isFinite(value));
		if (numeric.length === 0) {
			return { path: null };
		}
		const min = Math.min(...numeric);
		const max = Math.max(...numeric);
		const range = Math.max(1, max - min);
		const points = data.map((value, index) => {
			if (!Number.isFinite(value)) return null;
			const x = data.length === 1 ? width : (index / (data.length - 1)) * width;
			const normalized = (value - min) / range;
			const y = height - normalized * height;
			return [x, y];
		});
		let path = '';
		let needsMove = true;
		points.forEach((point) => {
			if (!point) {
				needsMove = true;
				return;
			}
			const [x, y] = point;
			path += `${needsMove ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
			needsMove = false;
		});
		return { path: path.trim() || null };
	}, [data, width, height]);

	if (!path) {
		return <div className="fitness-chart__sparkline fitness-chart__sparkline--empty" />;
	}

	return (
		<svg
			className="fitness-chart__sparkline"
			viewBox={`0 0 ${width} ${height}`}
			role="presentation"
			aria-hidden="true"
		>
			<path d={path} />
		</svg>
	);
};

const FitnessChart = ({ windowSize = DEFAULT_WINDOW, maxRows = DEFAULT_ROWS }) => {
	const {
		participantRoster = [],
		getUserTimelineSeries,
		timelineTimebase
	} = useFitnessContext();

	const entries = useMemo(() => {
		if (typeof getUserTimelineSeries !== 'function') return [];
		const roster = Array.isArray(participantRoster) ? participantRoster : [];
		const seen = new Set();
		const result = [];
		for (const participant of roster) {
			if (!participant || result.length >= maxRows) break;
			const key = participant.name || participant.profileId || participant.hrDeviceId;
			if (!key || seen.has(key)) continue;
			seen.add(key);
			const series = getUserTimelineSeries(key, 'heart_rate', { windowSize, clone: true });
			const numeric = Array.isArray(series) ? series.filter((value) => Number.isFinite(value)) : [];
			if (numeric.length === 0) continue;
			const latest = numeric[numeric.length - 1] ?? null;
			const min = Math.min(...numeric);
			const max = Math.max(...numeric);
			result.push({
				id: key,
				name: participant.displayLabel || participant.name || key,
				color: participant.zoneColor || '#9ca3af',
				series,
				latest,
				min,
				max
			});
		}
		return result;
	}, [participantRoster, getUserTimelineSeries, windowSize, maxRows]);

	useEffect(() => {
		if (isProductionBuild) return;
		if (entries.length === 0) return;
		const label = `[FitnessChart] window=${windowSize} samples`;
		console.debug(label, {
			intervalMs: timelineTimebase?.intervalMs ?? null,
			participants: entries.map((entry) => ({ id: entry.id, latest: entry.latest, min: entry.min, max: entry.max })),
			seriesLength: entries[0]?.series?.length ?? 0
		});
	}, [entries, timelineTimebase, windowSize]);

	if (typeof getUserTimelineSeries !== 'function') {
		return null;
	}

	const intervalSeconds = Number.isFinite(timelineTimebase?.intervalMs)
		? Math.max(1, Math.round(timelineTimebase.intervalMs / 1000))
		: null;
	const windowLabel = intervalSeconds
		? `${Math.round(windowSize * intervalSeconds)}s window`
		: `${windowSize} samples`;

	return (
		<div className="fitness-chart-panel">
			<div className="fitness-chart-panel__header">
				<div>
					<h3>Heart Rate Trends</h3>
					<p>{windowLabel}</p>
				</div>
			</div>
			{entries.length === 0 && (
				<div className="fitness-chart-panel__empty">Timeline warming up…</div>
			)}
			{entries.length > 0 && (
				<div className="fitness-chart-panel__body">
					{entries.map((entry) => (
						<div key={entry.id} className="fitness-chart-row">
							<div className="fitness-chart-row__meta">
								<span className="fitness-chart-row__name" style={{ color: entry.color }}>
									{entry.name}
								</span>
								<span className="fitness-chart-row__value">
									{formatBpm(entry.latest)}
									<span className="suffix"> bpm</span>
								</span>
							</div>
							<Sparkline data={entry.series} />
							<div className="fitness-chart-row__range">
								<span>min {formatBpm(entry.min)}</span>
								<span>max {formatBpm(entry.max)}</span>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
};

export default FitnessChart;
