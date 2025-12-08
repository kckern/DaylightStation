import React, { useMemo, useState, useEffect } from 'react';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import './FitnessChart.scss';
import {
	MIN_VISIBLE_TICKS,
	ZONE_COLOR_MAP,
	buildBeatsSeries,
	buildSegments,
	createPaths
} from './FitnessChart.helpers.js';

const CHART_WIDTH = 380;
const CHART_HEIGHT = 240;
const CHART_MARGIN = { top: 8, right: 8, bottom: 32, left: 0 };
const AVATAR_RADIUS = 12;
const AVATAR_OVERLAP_THRESHOLD = AVATAR_RADIUS * 2; // approximate diameter for collision

const initials = (name) => {
	if (!name) return '?';
	const parts = String(name).trim().split(/\s+/);
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] || '').toUpperCase() + (parts[1][0] || '').toUpperCase();
};

const slugifyId = (value, fallback = 'user') => {
	if (!value) return fallback;
	const slug = String(value)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return slug || fallback;
};

const useRaceChartData = (roster, getSeries, timebase) => {
	return useMemo(() => {
		if (!Array.isArray(roster) || roster.length === 0 || typeof getSeries !== 'function') {
			return { entries: [], maxValue: 0, maxIndex: 0 };
		}

		const shaped = roster.map((entry, idx) => {
			const { beats, zones } = buildBeatsSeries(entry, getSeries, timebase);
			const maxVal = Math.max(0, ...beats.filter((v) => Number.isFinite(v)));
			const segments = buildSegments(beats, zones);
			const profileId = entry.profileId || entry.hrDeviceId || slugifyId(entry.name || entry.displayLabel || entry.id || entry.profileId || idx);
			const entryId = entry.name || profileId || entry.hrDeviceId || `anon-${idx}`;
			let lastIndex = -1;
			for (let i = beats.length - 1; i >= 0; i -= 1) {
				if (Number.isFinite(beats[i])) {
					lastIndex = i;
					break;
				}
			}
			const resolvedAvatar = entry.avatarUrl
				|| DaylightMediaPath(`/media/img/users/${profileId || 'user'}`);
			return {
				id: entryId,
				name: entry.displayLabel || entry.name || 'Unknown',
				profileId,
				avatarUrl: resolvedAvatar,
				color: entry.zoneColor || ZONE_COLOR_MAP.default,
				beats,
				segments,
				maxVal,
				lastIndex
			};
		}).filter((item) => item.segments.length > 0 && item.maxVal > 0);

		const maxValue = Math.max(0, ...shaped.map((e) => e.maxVal));
		const maxIndex = Math.max(0, ...shaped.map((e) => e.lastIndex));
		return { entries: shaped, maxValue, maxIndex };
	}, [roster, getSeries, timebase]);
};

const computeAvatarPositions = (entries, maxValue, width, height, minVisibleTicks, margin, effectiveTicks) => {
	const innerWidth = Math.max(1, width - (margin.left || 0) - (margin.right || 0));
	const innerHeight = Math.max(1, height - (margin.top || 0) - (margin.bottom || 0));
	const ticks = Math.max(minVisibleTicks, effectiveTicks || 1, 1);
	return entries.map((entry) => {
		const beats = entry.beats;
		let lastIndex = -1;
		let lastValue = null;
		for (let i = beats.length - 1; i >= 0; i -= 1) {
			const v = beats[i];
			if (Number.isFinite(v)) {
				lastIndex = i;
				lastValue = v;
				break;
			}
		}
		if (lastIndex < 0 || !Number.isFinite(lastValue)) {
			return null;
		}
		const x = ticks <= 1 ? (margin.left || 0) : (margin.left || 0) + (lastIndex / (ticks - 1)) * innerWidth;
		const y = maxValue > 0 ? (margin.top || 0) + innerHeight - (lastValue / maxValue) * innerHeight : (margin.top || 0) + innerHeight;
		return { id: entry.id, x, y, name: entry.name, color: entry.color, avatarUrl: entry.avatarUrl, value: lastValue };
	}).filter(Boolean);
};

const resolveAvatarOffsets = (avatars) => {
	// Sort by y (leader on top) so offsets push lower ranks downward.
	const sorted = [...avatars].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
	const placed = [];
	const step = AVATAR_RADIUS * 2 + 6; // height to move per overlap

	const collides = (candidate, offset) => {
		const cy = candidate.y + offset;
		return placed.some((p) => {
			const dy = cy - (p.y + p.offsetY);
			const dx = candidate.x - p.x;
			const distance = Math.hypot(dx, dy);
			return distance < AVATAR_OVERLAP_THRESHOLD;
		});
	};

	sorted.forEach((item) => {
		let offset = 0;
		let iterations = 0;
		while (collides(item, offset) && iterations < 10) {
			offset += step;
			iterations += 1;
		}
		placed.push({ ...item, offsetY: offset });
	});

	return placed;
};

const formatDuration = (ms) => {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const RaceChartSvg = ({ paths, avatars, xTicks, yTicks }) => {
	return (
		<svg className="race-chart__svg" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="presentation" aria-hidden="true">
			<g className="race-chart__grid">
				{yTicks.map((tick) => (
					<line key={tick.value} x1={0} x2={CHART_WIDTH} y1={tick.y} y2={tick.y} />
				))}
				<line x1={0} x2={CHART_WIDTH} y1={CHART_HEIGHT - CHART_MARGIN.bottom} y2={CHART_HEIGHT - CHART_MARGIN.bottom} />
			</g>
			<g className="race-chart__axes">
				<line x1={0} x2={0} y1={CHART_MARGIN.top} y2={CHART_HEIGHT - CHART_MARGIN.bottom} />
				{xTicks.map((tick) => (
					<g key={tick.label} transform={`translate(${tick.x}, ${CHART_HEIGHT - CHART_MARGIN.bottom})`}>
						<line x1="0" x2="0" y1="0" y2="6" />
						<text y="16" textAnchor="middle">{tick.label}</text>
					</g>
				))}
				{yTicks.map((tick) => (
					<g key={tick.value} transform={`translate(0, ${tick.y})`}>
						<line x1="0" x2="8" y1="0" y2="0" />
						<text x="12" dy="4" textAnchor="start">{tick.label}</text>
					</g>
				))}
			</g>
			<g className="race-chart__paths">
				{paths.map((path) => (
					<path key={path.key} d={path.d} stroke={path.color} />
				))}
			</g>
			<g className="race-chart__avatars">
				{avatars.map((avatar, idx) => {
					const clipId = `avatar-clip-${slugifyId(avatar.id || avatar.name || 'user')}-${idx}`;
					return (
					<g
						key={avatar.id}
						style={{
							transform: `translate(${avatar.x}px, ${avatar.y + avatar.offsetY}px)`,
							transition: 'transform 0.35s ease'
						}}
					>
						{avatar.avatarUrl ? (
							<>
								<defs>
									<clipPath id={clipId}>
										<circle r={AVATAR_RADIUS} />
									</clipPath>
								</defs>
								<circle r={AVATAR_RADIUS} fill={avatar.color} className="race-chart__avatar-circle" />
								<image
									href={avatar.avatarUrl}
									x={-AVATAR_RADIUS}
									y={-AVATAR_RADIUS}
									width={AVATAR_RADIUS * 2}
									height={AVATAR_RADIUS * 2}
									clipPath={`url(#${clipId})`}
									preserveAspectRatio="xMidYMid slice"
									style={{ borderRadius: '50%' }}
								/>
								<circle r={AVATAR_RADIUS} fill="none" stroke={avatar.color} strokeWidth={3} className="race-chart__avatar-border" />
							</>
						) : (
							<>
								<circle r={AVATAR_RADIUS} fill={avatar.color} stroke={avatar.color} strokeWidth={2.5} className="race-chart__avatar-circle" />
								<text className="race-chart__avatar-text" dy="4" textAnchor="middle">
									{initials(avatar.name)}
								</text>
							</>
						)}
					</g>
				);
				})}
			</g>
		</svg>
	);
};

const FitnessChart = () => {
	const { participantRoster = [], getUserTimelineSeries, timelineTimebase } = useFitnessContext();

	const { entries, maxValue, maxIndex } = useRaceChartData(participantRoster, getUserTimelineSeries, timelineTimebase);
	const intervalMs = Number(timelineTimebase?.intervalMs) > 0 ? Number(timelineTimebase.intervalMs) : 5000;
	const effectiveTicks = Math.max(MIN_VISIBLE_TICKS, maxIndex + 1, 1);
	const paddedMaxValue = maxValue > 0 ? maxValue * 1.15 : 0;
	const [persisted, setPersisted] = useState(null);

	const paths = useMemo(() => {
		if (!entries.length || !(paddedMaxValue > 0)) return [];
		let globalIdx = 0;
		const allSegments = entries.flatMap((entry) => {
			const created = createPaths(entry.segments, {
				width: CHART_WIDTH,
				height: CHART_HEIGHT,
				margin: CHART_MARGIN,
				minVisibleTicks: MIN_VISIBLE_TICKS,
				maxValue: paddedMaxValue,
				effectiveTicks
			});
			return created.map((p, idx) => ({ ...p, id: entry.id, key: `${entry.id}-${globalIdx++}-${idx}` }));
		});
		return allSegments;
	}, [entries, paddedMaxValue, effectiveTicks]);

	const avatars = useMemo(() => {
		if (!entries.length || !(paddedMaxValue > 0)) return [];
		const base = computeAvatarPositions(entries, paddedMaxValue, CHART_WIDTH, CHART_HEIGHT, MIN_VISIBLE_TICKS, CHART_MARGIN, effectiveTicks);
		return resolveAvatarOffsets(base);
	}, [entries, paddedMaxValue, effectiveTicks]);

	const yTicks = useMemo(() => {
		if (!(paddedMaxValue > 0)) return [];
		const positions = [1, 0.75, 0.5, 0.25, 0].map((p) => ({ frac: p, value: paddedMaxValue * p }));
		const innerHeight = Math.max(1, CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom);
		return positions.map((p) => {
			const y = CHART_MARGIN.top + innerHeight - (p.frac * innerHeight);
			return {
				value: p.value,
				label: p.value.toFixed(0),
				y,
				x1: 0,
				x2: CHART_WIDTH
			};
		});
	}, [paddedMaxValue]);

	const xTicks = useMemo(() => {
		const totalMs = effectiveTicks * intervalMs;
		const positions = [0, 0.25, 0.5, 0.75, 1];
		const innerWidth = Math.max(1, CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right);
		return positions.map((p) => {
			const x = CHART_MARGIN.left + p * innerWidth;
			const label = formatDuration(totalMs * p);
			return { x, label };
		});
	}, [effectiveTicks, intervalMs]);

	const leaderValue = useMemo(() => {
		const vals = avatars.map((a) => a.value).filter((v) => Number.isFinite(v));
		return vals.length ? Math.max(...vals) : null;
	}, [avatars]);

	const hasData = entries.length > 0 && paths.length > 0;

	useEffect(() => {
		if (hasData) {
			setPersisted({ paths, avatars, xTicks, yTicks, leaderValue });
		}
	}, [hasData, paths, avatars, xTicks, yTicks, leaderValue]);

	const displayPaths = hasData ? paths : persisted?.paths || [];
	const displayAvatars = hasData ? avatars : persisted?.avatars || [];
	const displayXTicks = (hasData ? xTicks : persisted?.xTicks || xTicks) || [];
	const displayYTicks = (hasData ? yTicks : persisted?.yTicks || yTicks) || [];
	const displayLeader = hasData ? leaderValue : persisted?.leaderValue;

	return (
		<div className="race-chart-panel">
			{!hasData && !persisted && <div className="race-chart-panel__empty">Timeline warming up…</div>}
			{(hasData || persisted) && (
				<div className="race-chart-panel__body">
					<RaceChartSvg paths={displayPaths} avatars={displayAvatars} xTicks={displayXTicks} yTicks={displayYTicks} />
				</div>
			)}
		</div>
	);
};

export {
	MIN_VISIBLE_TICKS,
	ZONE_COLOR_MAP,
	buildBeatsSeries,
	buildSegments,
	createPaths
};

export default FitnessChart;
