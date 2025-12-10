import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
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

const DEFAULT_CHART_WIDTH = 420;
const DEFAULT_CHART_HEIGHT = 390;
const CHART_MARGIN = { top: 10, right: 64, bottom: 38, left: 4 };
const AVATAR_RADIUS = 30;
const AVATAR_OVERLAP_THRESHOLD = AVATAR_RADIUS * 2; // approximate diameter for collision
const ABSENT_BADGE_RADIUS = 10;
const COIN_LABEL_GAP = 8;
const Y_SCALE_BASE = 20; // >1 compresses lower values and expands higher values (top-heavy)
const PATH_STROKE_WIDTH = 5;
const TICK_FONT_SIZE = 20;
const COIN_FONT_SIZE = 20;

const slugifyId = (value, fallback = 'user') => {
	if (!value) return fallback;
	const slug = String(value)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return slug || fallback;
};

const formatCompactNumber = (value) => {
	if (!Number.isFinite(value)) return '';
	const abs = Math.abs(value);
	if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
	if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
	return value.toLocaleString();
};

const useRaceChartData = (roster, getSeries, timebase) => {
	return useMemo(() => {
		if (!Array.isArray(roster) || roster.length === 0 || typeof getSeries !== 'function') {
			return { entries: [], maxValue: 0, maxIndex: 0 };
		}

		const shaped = roster
			.map((entry, idx) => {
				const { beats, zones } = buildBeatsSeries(entry, getSeries, timebase);
				const maxVal = Math.max(0, ...beats.filter((v) => Number.isFinite(v)));
				const segments = buildSegments(beats, zones);
				const profileId = entry.profileId || entry.hrDeviceId || slugifyId(entry.name || entry.displayLabel || entry.id || idx);
				const entryId = entry.id || profileId || entry.hrDeviceId || slugifyId(entry.name || entry.displayLabel || idx, `anon-${idx}`);
				let lastIndex = -1;
				for (let i = beats.length - 1; i >= 0; i -= 1) {
					if (Number.isFinite(beats[i])) {
						lastIndex = i;
						break;
					}
				}
				const resolvedAvatar = entry.avatarUrl || DaylightMediaPath(`/media/img/users/${profileId || 'user'}`);
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
			})
			.filter((item) => item.segments.length > 0);

		const maxValue = Math.max(0, ...shaped.map((e) => e.maxVal));
		const maxIndex = Math.max(0, ...shaped.map((e) => e.lastIndex));
		return { entries: shaped, maxValue, maxIndex };
	}, [roster, getSeries, timebase]);
};

const getLastFiniteValue = (arr = []) => {
	for (let i = arr.length - 1; i >= 0; i -= 1) {
		const v = arr[i];
		if (Number.isFinite(v)) return v;
	}
	return null;
};

const findFirstFiniteAfter = (arr = [], index) => {
	for (let i = index + 1; i < arr.length; i += 1) {
		if (Number.isFinite(arr[i])) return i;
	}
	return null;
};

const useRaceChartWithHistory = (roster, getSeries, timebase) => {
	const { entries: presentEntries } = useRaceChartData(roster, getSeries, timebase);
	const [participantCache, setParticipantCache] = useState({});

	useEffect(() => {
		setParticipantCache((prev) => {
			const next = { ...prev };
			const presentIds = new Set();
			presentEntries.forEach((entry) => {
				const id = entry.id;
				presentIds.add(id);
				const lastValue = getLastFiniteValue(entry.beats || []);
				const lastSeenTick = entry.lastIndex;
				const prevEntry = prev[id];
				let segments = entry.segments;
				if (prevEntry && !prevEntry.isPresent && prevEntry.lastValue != null && (prevEntry.lastSeenTick ?? -1) > 0) {
					const firstNewIdx = findFirstFiniteAfter(entry.beats || [], prevEntry.lastSeenTick ?? -1);
					if (firstNewIdx != null) {
						const gapSegment = {
							zone: null,
							color: ZONE_COLOR_MAP.default,
							points: [
								{ i: prevEntry.lastSeenTick, v: prevEntry.lastValue },
								{ i: firstNewIdx, v: entry.beats[firstNewIdx] }
							]
						};
						segments = [gapSegment, ...segments];
					}
				}
				next[id] = {
					...prevEntry,
					...entry,
					segments,
					beats: entry.beats,
					zones: entry.zones,
					lastSeenTick,
					lastValue,
					isPresent: true,
					absentSinceTick: null
				};
			});
			Object.keys(next).forEach((id) => {
				if (!presentIds.has(id)) {
					const ent = next[id];
					if (ent) {
						next[id] = {
							...ent,
							isPresent: false,
							absentSinceTick: ent.absentSinceTick ?? ent.lastSeenTick ?? 0
						};
					}
				}
			});
			return next;
		});
	}, [presentEntries]);

	const allEntries = useMemo(() => Object.values(participantCache).filter((e) => e && (e.segments?.length || 0) > 0), [participantCache]);
	const present = useMemo(() => allEntries.filter((e) => e.isPresent), [allEntries]);
	const absent = useMemo(() => allEntries.filter((e) => !e.isPresent), [allEntries]);
	const maxValue = useMemo(() => {
		const vals = allEntries.flatMap((e) => (e.beats || []).filter((v) => Number.isFinite(v)));
		return vals.length ? Math.max(...vals, 0) : 0;
	}, [allEntries]);
	const maxIndex = useMemo(() => {
		const idxs = allEntries.map((e) => e.lastSeenTick ?? -1);
		return idxs.length ? Math.max(...idxs, 0) : 0;
	}, [allEntries]);

	return { allEntries, presentEntries: present, absentEntries: absent, maxValue, maxIndex };
};

const computeAvatarPositions = (entries, scaleY, width, height, minVisibleTicks, margin, effectiveTicks) => {
	const innerWidth = Math.max(1, width - (margin.left || 0) - (margin.right || 0));
	const ticks = Math.max(minVisibleTicks, effectiveTicks || 1, 1);
	return entries
		.map((entry) => {
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
			const x = ticks <= 1 ? margin.left || 0 : (margin.left || 0) + (lastIndex / (ticks - 1)) * innerWidth;
			const y = scaleY(lastValue);
			return { id: entry.id, x, y, name: entry.name, color: entry.color, avatarUrl: entry.avatarUrl, value: lastValue };
		})
		.filter(Boolean);
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

const computeBadgePositions = (entries, scaleY, width, height, minVisibleTicks, margin, effectiveTicks) => {
	const innerWidth = Math.max(1, width - (margin.left || 0) - (margin.right || 0));
	const ticks = Math.max(minVisibleTicks, effectiveTicks || 1, 1);
	return entries
		.map((entry) => {
			const lastIndex = Number.isFinite(entry.lastSeenTick) ? entry.lastSeenTick : -1;
			const lastValue = Number.isFinite(entry.lastValue) ? entry.lastValue : null;
			if (lastIndex < 0 || lastValue == null) return null;
			const x = ticks <= 1 ? margin.left || 0 : (margin.left || 0) + (lastIndex / (ticks - 1)) * innerWidth;
			const y = scaleY(lastValue);
			const label = (entry.name || '?').trim();
			const initial = label ? label[0].toUpperCase() : '?';
			return { id: entry.id, x, y, initial };
		})
		.filter(Boolean);
};

const formatDuration = (ms) => {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const RaceChartSvg = ({ paths, avatars, badges, xTicks, yTicks, width, height }) => (
	<svg
		className="race-chart__svg"
		viewBox={`0 0 ${width} ${height}`}
		preserveAspectRatio="xMidYMid meet"
		role="presentation"
		aria-hidden="true"
	>
		<g className="race-chart__grid">
			{yTicks.map((tick) => (
				<line key={tick.value} x1={0} x2={width} y1={tick.y} y2={tick.y} />
			))}
			<line x1={0} x2={width} y1={height - CHART_MARGIN.bottom} y2={height - CHART_MARGIN.bottom} />
		</g>
		<g className="race-chart__axes">
			<line x1={0} x2={0} y1={CHART_MARGIN.top} y2={height - CHART_MARGIN.bottom} />
			{xTicks.map((tick) => (
				<g key={tick.label} transform={`translate(${tick.x}, ${height - CHART_MARGIN.bottom})`}>
					<line x1="0" x2="0" y1="0" y2="6" />
					<text y="16" textAnchor="middle" fontSize={TICK_FONT_SIZE}>{tick.label}</text>
				</g>
			))}
			{yTicks.map((tick) => (
				<g key={tick.value} transform={`translate(0, ${tick.y})`}>
					<line x1="0" x2="8" y1="0" y2="0" />
					<text x="12" dy="4" textAnchor="start" fontSize={TICK_FONT_SIZE}>{tick.label}</text>
				</g>
			))}
		</g>
		<g className="race-chart__paths">
			{paths.map((path, idx) => (
				<path
					key={`${path.zone || 'seg'}-${idx}`}
					d={path.d}
					stroke={path.color}
					fill="none"
					strokeWidth={PATH_STROKE_WIDTH}
					opacity={path.opacity ?? 1}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			))}
		</g>
		<g className="race-chart__absent-badges">
			{badges.map((badge) => (
				<g key={`absent-${badge.id}`} transform={`translate(${badge.x}, ${badge.y})`}>
					<circle r={ABSENT_BADGE_RADIUS} fill="#f3f4f6" stroke="#9ca3af" strokeWidth="1.5" />
					<text
						x="0"
						y="4"
						textAnchor="middle"
						fontSize={12}
						fill="#4b5563"
						fontWeight="600"
					>
						{badge.initial}
					</text>
				</g>
			))}
		</g>
		<g className="race-chart__avatars">
			{avatars.map((avatar, idx) => {
				const size = AVATAR_RADIUS * 2;
				const labelX = AVATAR_RADIUS + COIN_LABEL_GAP;
				const labelY = 0;
				const clipSafeId = slugifyId(avatar.id, 'user');
				const clipId = `race-clip-${clipSafeId}-${idx}`;
				return (
					<g
						key={clipId}
						className="race-chart__avatar-group"
						transform={`translate(${avatar.x}, ${avatar.y + avatar.offsetY})`}
					>
						<defs>
							<clipPath id={clipId}>
								<circle r={AVATAR_RADIUS} cx={0} cy={0} />
							</clipPath>
						</defs>
						<text
							x={labelX}
							y={labelY}
							className="race-chart__coin-label"
							textAnchor="start"
							dominantBaseline="middle"
							fontSize={COIN_FONT_SIZE}
							aria-hidden="true"
						>
							{formatCompactNumber(avatar.value)}
						</text>
						<circle className="race-chart__avatar-backdrop" r={AVATAR_RADIUS + 6} />
						<circle
							className="race-chart__avatar-zone"
							r={AVATAR_RADIUS + 1.5}
							stroke={avatar.color}
						/>
						<image
							href={avatar.avatarUrl}
							x={-AVATAR_RADIUS}
							y={-AVATAR_RADIUS}
							width={size}
							height={size}
							clipPath={`url(#${clipId})`}
							preserveAspectRatio="xMidYMid slice"
							className="race-chart__avatar-img"
						/>
					</g>
				);
			})}
		</g>
	</svg>
);

const FitnessChart = () => {
	const { participantRoster = [], getUserTimelineSeries, timelineTimebase } = useFitnessContext();
	const containerRef = useRef(null);
	const [chartSize, setChartSize] = useState({ width: DEFAULT_CHART_WIDTH, height: DEFAULT_CHART_HEIGHT });

	useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el) return;

		const updateSize = () => {
			const rect = el.getBoundingClientRect();
			const width = Math.max(240, rect.width || DEFAULT_CHART_WIDTH);
			const height = Math.max(200, rect.height || DEFAULT_CHART_HEIGHT);
			setChartSize({ width, height });
		};

		updateSize();
		const resizeObserver = new ResizeObserver(() => updateSize());
		resizeObserver.observe(el);
		return () => resizeObserver.disconnect();
	}, []);

	const { allEntries, presentEntries, absentEntries, maxValue, maxIndex } = useRaceChartWithHistory(participantRoster, getUserTimelineSeries, timelineTimebase);
	const { width: chartWidth, height: chartHeight } = chartSize;
	const intervalMs = Number(timelineTimebase?.intervalMs) > 0 ? Number(timelineTimebase.intervalMs) : 5000;
	const effectiveTicks = Math.max(MIN_VISIBLE_TICKS, maxIndex + 1, 1);
	const paddedMaxValue = maxValue > 0 ? maxValue + 2 : 2; // keep drawable even before first coin
	const yScaleBase = allEntries.length <= 1 ? 1 : Y_SCALE_BASE; // single user: linear scale
	const [persisted, setPersisted] = useState(null);

	const minDataValue = useMemo(() => {
		const vals = allEntries.flatMap((e) => e.beats || []).filter((v) => Number.isFinite(v));
		return vals.length ? Math.min(...vals) : 0;
	}, [allEntries]);

	const minAxisValue = useMemo(() => {
		// Clamp the vertical domain to never dip below zero so the x-axis sits on 0.
		return Math.min(0, minDataValue);
	}, [minDataValue]);

	const lowestAvatarValue = useMemo(() => {
		let min = Number.POSITIVE_INFINITY;
		presentEntries.forEach((entry) => {
			const beats = entry.beats || [];
			for (let i = beats.length - 1; i >= 0; i -= 1) {
				const v = beats[i];
				if (Number.isFinite(v)) {
					if (v < min) min = v;
					break;
				}
			}
		});
		if (min === Number.POSITIVE_INFINITY) return Math.max(0, minDataValue);
		return Math.max(0, min);
	}, [presentEntries, minDataValue]);

	const scaleY = useMemo(() => {
		const domainMin = Math.min(minAxisValue, paddedMaxValue);
		const domainSpan = Math.max(1, paddedMaxValue - domainMin);
		const topFrac = 0.06;
		const bottomFrac = 1; // anchor zero directly on the x-axis
		const innerHeight = Math.max(1, chartHeight - CHART_MARGIN.top - CHART_MARGIN.bottom);
		const logBase = yScaleBase;
		return (value) => {
			const clamped = Math.max(domainMin, Math.min(paddedMaxValue, value));
			const norm = (clamped - domainMin) / domainSpan;
			let mapped = norm;
			if (logBase > 1) {
				mapped = 1 - Math.log(1 + (1 - norm) * (logBase - 1)) / Math.log(logBase);
			}
			const frac = bottomFrac + (topFrac - bottomFrac) * mapped;
			return CHART_MARGIN.top + frac * innerHeight;
		};
	}, [minDataValue, paddedMaxValue, chartHeight, yScaleBase]);

	const paths = useMemo(() => {
		if (!allEntries.length || !(paddedMaxValue > 0)) return [];
		let globalIdx = 0;
		const allSegments = allEntries.flatMap((entry) => {
			const created = createPaths(entry.segments, {
				width: chartWidth,
				height: chartHeight,
				margin: CHART_MARGIN,
				minVisibleTicks: MIN_VISIBLE_TICKS,
				maxValue: paddedMaxValue,
				minValue: minAxisValue,
				bottomFraction: 1,
				topFraction: 0.06,
				effectiveTicks,
				yScaleBase
			});
			return created.map((p, idx) => ({ ...p, id: entry.id, key: `${entry.id}-${globalIdx++}-${idx}` }));
		});
		return allSegments;
	}, [allEntries, paddedMaxValue, effectiveTicks, chartWidth, chartHeight, minAxisValue, yScaleBase]);

	const avatars = useMemo(() => {
		if (!presentEntries.length || !(paddedMaxValue > 0)) return [];
		const base = computeAvatarPositions(presentEntries, scaleY, chartWidth, chartHeight, MIN_VISIBLE_TICKS, CHART_MARGIN, effectiveTicks);
		return resolveAvatarOffsets(base);
	}, [presentEntries, paddedMaxValue, effectiveTicks, chartWidth, chartHeight, scaleY]);

	const badges = useMemo(() => {
		if (!absentEntries.length || !(paddedMaxValue > 0)) return [];
		return computeBadgePositions(absentEntries, scaleY, chartWidth, chartHeight, MIN_VISIBLE_TICKS, CHART_MARGIN, effectiveTicks);
	}, [absentEntries, paddedMaxValue, effectiveTicks, chartWidth, chartHeight, scaleY]);

	const yTicks = useMemo(() => {
		if (!(paddedMaxValue > 0)) return [];
		const start = Math.max(0, Math.min(paddedMaxValue, lowestAvatarValue));
		const tickCount = 4;
		const span = Math.max(1, paddedMaxValue - start);
		const values = Array.from({ length: tickCount }, (_, idx) => {
			const t = idx / Math.max(1, tickCount - 1);
			return start + span * t;
		});
		return values.map((value) => ({
			value,
			label: value.toFixed(0),
			y: scaleY(value),
			x1: 0,
			x2: chartWidth
		}));
	}, [paddedMaxValue, lowestAvatarValue, chartWidth, scaleY]);

	const xTicks = useMemo(() => {
		const totalMs = effectiveTicks * intervalMs;
		const positions = [0, 0.25, 0.5, 0.75, 1];
		const innerWidth = Math.max(1, chartWidth - CHART_MARGIN.left - CHART_MARGIN.right);
		return positions.map((p) => {
			const x = CHART_MARGIN.left + p * innerWidth;
			const label = formatDuration(totalMs * p);
			return { x, label };
		});
	}, [effectiveTicks, intervalMs, chartWidth]);

	const leaderValue = useMemo(() => {
		const vals = avatars.map((a) => a.value).filter((v) => Number.isFinite(v));
		return vals.length ? Math.max(...vals) : null;
	}, [avatars]);

	const hasData = allEntries.length > 0 && paths.length > 0;

	useEffect(() => {
		if (hasData) {
			setPersisted({ paths, avatars, badges, xTicks, yTicks, leaderValue });
		}
		}, [hasData, paths, avatars, badges, xTicks, yTicks, leaderValue]);

		const displayPaths = hasData ? paths : persisted?.paths || [];
		const displayAvatars = hasData ? avatars : persisted?.avatars || [];
		const displayBadges = hasData ? badges : persisted?.badges || [];
		const displayXTicks = (hasData ? xTicks : persisted?.xTicks || xTicks) || [];
		const displayYTicks = (hasData ? yTicks : persisted?.yTicks || yTicks) || [];
	// leaderValue currently unused in render, but persisted for potential highlights.

	return (
		<div className="race-chart-panel" ref={containerRef}>
			{!hasData && !persisted && <div className="race-chart-panel__empty">Timeline warming up…</div>}
			{(hasData || persisted) && (
				<div className="race-chart-panel__body">
					<RaceChartSvg
						paths={displayPaths}
						avatars={displayAvatars}
						badges={displayBadges}
						xTicks={displayXTicks}
						yTicks={displayYTicks}
						width={chartWidth}
						height={chartHeight}
					/>
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
