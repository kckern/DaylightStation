import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
import useFitnessPlugin from '../../useFitnessPlugin';
import { DaylightMediaPath } from '../../../../../lib/api.mjs';
import './FitnessChartApp.scss';
import {
	MIN_VISIBLE_TICKS,
	ZONE_COLOR_MAP,
	buildBeatsSeries,
	buildSegments,
	createPaths
} from '../../../FitnessSidebar/FitnessChart.helpers.js';
import { ParticipantStatus, getZoneColor, isBroadcasting } from '../../../domain';
import { LayoutManager } from './layout';

const DEFAULT_CHART_WIDTH = 420;
const DEFAULT_CHART_HEIGHT = 390;
// Right margin: avatar radius (30) + label width (~50) + gap (8) = 88, rounded to 90
const CHART_MARGIN = { top: 10, right: 90, bottom: 38, left: 4 };
const AVATAR_RADIUS = 30;
const ABSENT_BADGE_RADIUS = 10;
const COIN_LABEL_GAP = 8;
const Y_SCALE_BASE = 20;
const MIN_GRID_LINES = 4;
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

const formatDuration = (ms) => {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Hook to build race chart data from roster and timeline series.
 * @param {Array} roster - Current participant roster
 * @param {Function} getSeries - Timeline series getter
 * @param {Object} timebase - Timeline timebase config
 * @param {Object} [options] - Additional options
 * @param {import('../../../domain').ActivityMonitor} [options.activityMonitor] - Optional ActivityMonitor for centralized activity tracking
 */
const useRaceChartData = (roster, getSeries, timebase, options = {}) => {
	const { activityMonitor } = options;
	
	return useMemo(() => {
		if (!Array.isArray(roster) || roster.length === 0 || typeof getSeries !== 'function') {
			return { entries: [], maxValue: 0, maxIndex: 0 };
		}

		// Build chart entries from roster
		const debugItems = roster.map((entry, idx) => {
			const { beats, zones, active } = buildBeatsSeries(entry, getSeries, timebase, { activityMonitor });
			const maxVal = Math.max(0, ...beats.filter((v) => Number.isFinite(v)));
			const segments = buildSegments(beats, zones, active);
			const profileId = entry.profileId || entry.hrDeviceId || slugifyId(entry.name || entry.displayLabel || entry.id || idx);
			const entryId = entry.id || profileId || entry.hrDeviceId || slugifyId(entry.name || entry.displayLabel || idx, `anon-${idx}`);
			
			// Find last ACTIVE tick (when user was actually broadcasting)
			// This is where the colored line ends and where dropout badge should appear
			// We use the `active` array, NOT beats (which has forward-filled values)
			let lastActiveIndex = -1;
			for (let i = active.length - 1; i >= 0; i -= 1) {
				if (active[i] === true) {
					lastActiveIndex = i;
					break;
				}
			}
			// Fall back to last finite beat if no active ticks (for edge cases)
			let lastIndex = lastActiveIndex;
			if (lastIndex < 0) {
				for (let i = beats.length - 1; i >= 0; i -= 1) {
					if (Number.isFinite(beats[i])) {
						lastIndex = i;
						break;
					}
				}
			}
			
			const resolvedAvatar = entry.avatarUrl || DaylightMediaPath(`/media/img/users/${profileId || 'user'}`);
			
			// SINGLE SOURCE OF TRUTH: Use roster's isActive field directly from DeviceManager
			// This is set in ParticipantRoster._buildRosterEntry() from device.inactiveSince
			// Segments are for RENDERING only - they determine line style, NOT avatar visibility
			const isActiveFromRoster = entry.isActive !== false; // Default to true if not set
			const status = isActiveFromRoster ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE;
			
			return {
				id: entryId,
				name: entry.displayLabel || entry.name || 'Unknown',
				profileId,
				avatarUrl: resolvedAvatar,
				color: entry.zoneColor || ZONE_COLOR_MAP.default,
				beats,
				zones,
				active,
				segments,
				maxVal,
				lastIndex, // Last ACTIVE tick (for dropout badge position)
				status, // From roster's isActive - SINGLE SOURCE OF TRUTH
				isActive: isActiveFromRoster, // Pass through for consumers
				filterReason: segments.length === 0 ? 'no_segments' : (maxVal <= 0 ? 'no_beats' : null)
			};
		});

		// Allow entries with zero beats to display - they'll accumulate over time
		// Only filter out entries with no segments (no HR data at all)
		const shaped = debugItems.filter((item) => item.segments.length > 0);

		// Debug guardrail: log when roster/active/chart counts diverge
		const rosterIds = roster.map((r, i) => slugifyId(r.profileId || r.hrDeviceId || r.name || r.displayLabel || i, `anon-${i}`));
		const chartIds = shaped.map((s) => s.id);
		let activeRosterCount = rosterIds.length;
		if (activityMonitor) {
			activeRosterCount = rosterIds.filter((id) => activityMonitor.isActive(id)).length;
		}
		const rosterCount = rosterIds.length;
		const chartCount = chartIds.length;
		if (rosterCount !== chartCount || activeRosterCount !== chartCount) {
			const missing = debugItems
				.filter((item) => !chartIds.includes(item.id))
				.map((item) => ({ id: item.id, reason: item.filterReason || 'unknown' }));
			const extra = chartIds.filter((id) => !rosterIds.includes(id));
			// Collect richer diagnostics
			const details = debugItems.map((item) => {
				const hrSeries = typeof getSeries === 'function' ? getSeries(item.id, 'heart_rate', { clone: true }) || [] : [];
				const coinsSeries = typeof getSeries === 'function' ? getSeries(item.id, 'coins_total', { clone: true }) || [] : [];
				const lastHr = hrSeries.length ? hrSeries[hrSeries.length - 1] : null;
				const lastCoins = coinsSeries.length ? coinsSeries[coinsSeries.length - 1] : null;
				const hrLen = hrSeries.length;
				const coinsLen = coinsSeries.length;
				const lastFiniteHr = (() => {
					for (let i = hrSeries.length - 1; i >= 0; i -= 1) {
						if (Number.isFinite(hrSeries[i])) return hrSeries[i];
					}
					return null;
				})();
				return {
					id: item.id,
					filterReason: item.filterReason,
					beatsLen: item.beats?.length ?? 0,
					segmentsLen: item.segments?.length ?? 0,
					maxVal: item.maxVal,
					lastIndex: item.lastIndex,
					hrLen,
					lastHr,
					lastFiniteHr,
					coinsLen,
					lastCoins,
					activityStatus: activityMonitor ? activityMonitor.getStatus?.(item.id) ?? null : null,
					isActiveFromMonitor: activityMonitor ? activityMonitor.isActive?.(item.id) ?? null : null,
				};
			});
			console.warn('[FitnessChart] Avatar mismatch', {
				rosterCount,
				activeRosterCount,
				chartCount,
				missingFromChart: missing,
				extraOnChart: extra,
				details
			});
		}

		// GUARDRAIL: Log when roster.isActive differs from segment state (for debugging)
		// We trust roster.isActive as source of truth, but want to see divergences
		shaped.forEach((item) => {
			const lastSeg = item.segments[item.segments.length - 1];
			const endsWithGap = lastSeg?.isGap === true;
			const isActiveFromRoster = item.isActive !== false;
			// Note: We expect endsWithGap when !isActive, but isActive is authoritative
			if (endsWithGap && isActiveFromRoster) {
				console.warn('[FitnessChart] Segment shows gap but roster says active', {
					id: item.id,
					endsWithGap,
					isActive: item.isActive,
					lastSegment: lastSeg ? { isGap: lastSeg.isGap, status: lastSeg.status } : null
				});
			}
		});

		const maxValue = Math.max(0, ...shaped.map((e) => e.maxVal));
		const maxIndex = Math.max(0, ...shaped.map((e) => e.lastIndex));
		return { entries: shaped, maxValue, maxIndex };
	}, [roster, getSeries, timebase, activityMonitor]);
};

// NOTE: Clean ChartDataBuilder interface is available via useFitnessApp().chartDataBuilder
// for future migration. Current implementation uses buildBeatsSeries/buildSegments helpers
// for backward compatibility during the Phase 3 transition.

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

/**
 * Hook to build race chart data with historical participant support.
 * @param {Array} roster - Current participant roster
 * @param {Function} getSeries - Timeline series getter
 * @param {Object} timebase - Timeline timebase config
 * @param {string[]} historicalParticipantIds - IDs of historical participants
 * @param {Object} [options] - Additional options
 * @param {import('../../../domain').ActivityMonitor} [options.activityMonitor] - Optional ActivityMonitor
 */
const useRaceChartWithHistory = (roster, getSeries, timebase, historicalParticipantIds = [], options = {}) => {
	const { activityMonitor } = options;
	const { entries: presentEntries } = useRaceChartData(roster, getSeries, timebase, { activityMonitor });
	const [participantCache, setParticipantCache] = useState({});
	// Track which historical IDs we've already processed to avoid re-processing on every render
	const processedHistoricalRef = useRef(new Set());

	// Initialize cache from historical participants (1B fix)
	// Uses processedHistoricalRef instead of boolean flag to allow late arrivals while avoiding duplicates
	useEffect(() => {
		if (!historicalParticipantIds.length || typeof getSeries !== 'function') {
			return;
		}
		
		setParticipantCache((prev) => {
			const next = { ...prev };
			historicalParticipantIds.forEach((slug) => {
				// Skip if already processed or already in cache (including from presentEntries)
				if (!slug || next[slug] || processedHistoricalRef.current.has(slug)) return;
				
				// Mark as processed to avoid re-processing on subsequent renders
				processedHistoricalRef.current.add(slug);
				
				// Build data for historical participant (pass activityMonitor for Phase 2)
				const { beats, zones, active } = buildBeatsSeries({ profileId: slug, name: slug }, getSeries, timebase, { activityMonitor });
				if (!beats.length) return;
				
				const segments = buildSegments(beats, zones, active);
				if (!segments.length) return;
				
				// Skip non-HR devices (no accumulated beats)
				const maxVal = Math.max(0, ...beats.filter((v) => Number.isFinite(v)));
				if (maxVal <= 0) return;
				
				let lastIndex = -1;
				let lastValue = null;
				for (let i = beats.length - 1; i >= 0; i -= 1) {
					if (Number.isFinite(beats[i])) {
						lastIndex = i;
						lastValue = beats[i];
						break;
					}
				}
				
				next[slug] = {
					id: slug,
					name: slug,
					profileId: slug,
					avatarUrl: null,
					color: getZoneColor(null),
					beats,
					segments,
					zones,
					active,
					maxVal,
					lastIndex,
					lastSeenTick: lastIndex,
					lastValue,
					status: ParticipantStatus.REMOVED,
					absentSinceTick: lastIndex
				};
			});
			return next;
		});
	// Note: timebase excluded from deps intentionally - historical entries only need to be added once
	// processedHistoricalRef prevents duplicate processing, and presentEntries will update live data
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [historicalParticipantIds, getSeries]);

	useEffect(() => {
		setParticipantCache((prev) => {
			const next = { ...prev };
			const presentIds = new Set();
			presentEntries.forEach((entry) => {
				// Use profileId for cache key to match historical entries (which use slug)
				const id = entry.profileId || entry.id;
				presentIds.add(id);
				const lastValue = getLastFiniteValue(entry.beats || []);
				const lastSeenTick = entry.lastIndex;
				const prevEntry = prev[id];
				
				// Preserve existing dropout markers (IMMUTABLE) for badge rendering
				// CRITICAL: Create a NEW array to avoid mutating previous state
				let dropoutMarkers = [...(prevEntry?.dropoutMarkers || [])];
				
				// Create dropout marker ONLY when returning from dropout (was inactive, now active again)
				// This is the REJOIN event - we mark where they LEFT
				const wasInactive = prevEntry && (prevEntry.isActive === false || !isBroadcasting(prevEntry.status));
				const nowActive = entry.isActive !== false;
				const isRejoining = wasInactive && nowActive;
				
				if (isRejoining && prevEntry.lastValue != null && (prevEntry.lastSeenTick ?? -1) >= 0) {
					const firstNewIdx = findFirstFiniteAfter(entry.beats || [], prevEntry.lastSeenTick ?? -1);
					if (firstNewIdx != null) {
						// Create IMMUTABLE dropout marker at the point where they left
						const newMarker = {
							tick: prevEntry.lastSeenTick,
							value: prevEntry.lastValue,
							timestamp: Date.now()
						};
						// Only add if not duplicate
						const isDuplicate = dropoutMarkers.some(m => m.tick === newMarker.tick);
						if (!isDuplicate) {
							dropoutMarkers = [...dropoutMarkers, newMarker];
						}
					}
				}
				next[id] = {
					...prevEntry,
					...entry,
					segments: entry.segments, // Use segments as-is from buildSegments (includes gaps)
					beats: entry.beats,
					zones: entry.zones,
					lastSeenTick,
					lastValue,
					status: entry.status, // SINGLE SOURCE OF TRUTH: From roster's isActive
					isActive: entry.isActive, // Pass through for avatar rendering
					dropoutMarkers, // Preserve immutable markers for badge rendering
					absentSinceTick: entry.status === ParticipantStatus.IDLE ? (prevEntry?.absentSinceTick ?? lastSeenTick) : null
				};
			});
			Object.keys(next).forEach((id) => {
				if (!presentIds.has(id)) {
					const ent = next[id];
					if (ent) {
						// User just dropped out - record this as a potential dropout marker
						// The marker becomes IMMUTABLE when they rejoin
						next[id] = {
							...ent,
							status: ParticipantStatus.REMOVED,
							isActive: false, // Explicitly false for removed users
							absentSinceTick: ent.absentSinceTick ?? ent.lastSeenTick ?? 0
						};
					}
				}
			});
			return next;
		});
	}, [presentEntries]);

	const allEntries = useMemo(() => Object.values(participantCache).filter((e) => e && (e.segments?.length || 0) > 0), [participantCache]);
	
	// SINGLE SOURCE OF TRUTH: Use isActive from roster (set by DeviceManager.inactiveSince)
	// Segments are for RENDERING only - they control line style (solid/dotted)
	// isActive controls avatar visibility (present vs absent)
	const validatedEntries = useMemo(() => {
		return allEntries.map((entry) => {
			// isActive comes directly from DeviceManager via roster
			// If isActive is false, user should be in absent (show badge, not avatar)
			const isActiveFromRoster = entry.isActive !== false;
			const correctStatus = isActiveFromRoster ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE;
			
			// Log if there's a mismatch (for debugging, but we trust isActive)
			if (entry.status !== correctStatus) {
				console.warn('[FitnessChart] Status corrected from roster.isActive', {
					id: entry.id,
					wasStatus: entry.status,
					nowStatus: correctStatus,
					isActive: entry.isActive
				});
			}
			
			return { ...entry, status: correctStatus };
		});
	}, [allEntries]);
	
	// Use isActive (from roster) for present/absent split - SINGLE SOURCE OF TRUTH
	const present = useMemo(() => validatedEntries.filter((e) => e.isActive !== false), [validatedEntries]);
	const absent = useMemo(() => validatedEntries.filter((e) => e.isActive === false), [validatedEntries]);
	
	// Collect ALL dropout markers from ALL entries (both present and absent)
	// These markers are IMMUTABLE - once created, they never move or disappear
	const dropoutMarkers = useMemo(() => {
		const markers = [];
		const seenParticipants = new Set(); // Track which participants we've already added a marker for
		
		validatedEntries.forEach((entry) => {
			const participantId = entry.profileId || entry.id;
			
			// Add markers from dropoutMarkers array (persisted from rejoins)
			if (entry.dropoutMarkers?.length) {
				entry.dropoutMarkers.forEach((marker) => {
					const markerId = `${participantId}-dropout-${marker.tick}`;
					// Avoid duplicates
					if (!markers.some(m => m.id === markerId)) {
						markers.push({
							id: markerId,
							participantId,
							name: entry.name,
							tick: marker.tick,
							value: marker.value
						});
					}
				});
			}
			
			// Add current dropout position for users who are currently absent (isActive === false)
			// Only ONE marker per participant - at their lastSeenTick
			if (entry.isActive === false && !seenParticipants.has(participantId)) {
				if (entry.lastSeenTick >= 0 && entry.lastValue != null) {
					const markerId = `${participantId}-dropout-current`;
					if (!markers.some(m => m.id === markerId)) {
						markers.push({
							id: markerId,
							participantId,
							name: entry.name,
							tick: entry.lastSeenTick,
							value: entry.lastValue
						});
						seenParticipants.add(participantId);
					}
				}
			}
		});
		return markers;
	}, [validatedEntries]);
	
	const maxValue = useMemo(() => {
		const vals = allEntries.flatMap((e) => (e.beats || []).filter((v) => Number.isFinite(v)));
		return vals.length ? Math.max(...vals, 0) : 0;
	}, [allEntries]);
	const maxIndex = useMemo(() => {
		const idxs = allEntries.map((e) => e.lastSeenTick ?? -1);
		return idxs.length ? Math.max(...idxs, 0) : 0;
	}, [allEntries]);

	return { allEntries, presentEntries: present, absentEntries: absent, dropoutMarkers, maxValue, maxIndex };
};

// NOTE: Avatar/badge positioning is now handled by LayoutManager
// See: layout/LayoutManager.js for collision resolution, clustering, and connector generation

const RaceChartSvg = ({ paths, avatars, badges, connectors = [], xTicks, yTicks, width, height }) => (
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
					stroke={path.isGap ? ZONE_COLOR_MAP.default : path.color}
					fill="none"
					strokeWidth={PATH_STROKE_WIDTH}
					opacity={path.opacity ?? 1}
					strokeLinecap={path.isGap ? 'butt' : 'round'}
					strokeLinejoin="round"
					strokeDasharray={path.isGap ? '4 4' : undefined}
				/>
			))}
		</g>
		{/* Connectors link displaced avatars back to their line endpoints */}
		<g className="race-chart__connectors">
			{connectors.map((conn) => (
				<line
					key={conn.id}
					x1={conn.x1}
					y1={conn.y1}
					x2={conn.x2}
					y2={conn.y2}
					stroke={conn.color || '#9ca3af'}
					strokeWidth={2}
					strokeDasharray="4 2"
					opacity={0.6}
				/>
			))}
		</g>
		<g className="race-chart__absent-badges">
			{badges.map((badge) => {
				const bx = badge.x + (badge.offsetX || 0);
				const by = badge.y + (badge.offsetY || 0);
				const opacity = badge.opacity ?? 1;
				return (
					<g key={`absent-${badge.id}`} transform={`translate(${bx}, ${by})`} opacity={opacity}>
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
				);
			})}
		</g>
		<g className="race-chart__avatars">
			{avatars.map((avatar, idx) => {
				const size = AVATAR_RADIUS * 2;
				// Support labelPosition from LayoutManager (left/right/top/bottom)
				const labelPos = avatar.labelPosition || 'right';
				let labelX = AVATAR_RADIUS + COIN_LABEL_GAP;
				let labelY = 0;
				let textAnchor = 'start';
				if (labelPos === 'left') {
					labelX = -(AVATAR_RADIUS + COIN_LABEL_GAP);
					textAnchor = 'end';
				} else if (labelPos === 'top') {
					labelX = 0;
					labelY = -(AVATAR_RADIUS + COIN_LABEL_GAP);
					textAnchor = 'middle';
				} else if (labelPos === 'bottom') {
					labelX = 0;
					labelY = AVATAR_RADIUS + COIN_LABEL_GAP + 12;
					textAnchor = 'middle';
				}
				const clipSafeId = slugifyId(avatar.id, 'user');
				const clipId = `race-clip-${clipSafeId}-${idx}`;
				const ax = avatar.x + (avatar.offsetX || 0);
				const ay = avatar.y + (avatar.offsetY || 0);
				return (
					<g
						key={clipId}
						className="race-chart__avatar-group"
						transform={`translate(${ax}, ${ay})`}
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
							textAnchor={textAnchor}
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

const FitnessChartApp = ({ mode, onClose, config, onMount }) => {
	const { 
		participants, 
		historicalParticipants, 
		getUserTimelineSeries, 
		timebase, 
		registerLifecycle,
		activityMonitor  // Phase 2 - centralized activity tracking
	} = useFitnessPlugin('fitness_chart');
	const containerRef = useRef(null);
	const [chartSize, setChartSize] = useState({ width: DEFAULT_CHART_WIDTH, height: DEFAULT_CHART_HEIGHT });
	const lastWarmupLogRef = useRef(null);

    useEffect(() => {
        onMount?.();
    }, [onMount]);

    useEffect(() => {
        registerLifecycle({
            onPause: () => {},
            onResume: () => {},
            onSessionEnd: () => {}
        });
    }, [registerLifecycle]);

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

	// Pass activityMonitor for centralized activity tracking (Phase 2)
	const { allEntries, presentEntries, absentEntries, dropoutMarkers, maxValue, maxIndex } = useRaceChartWithHistory(
		participants, 
		getUserTimelineSeries, 
		timebase, 
		historicalParticipants,
		{ activityMonitor }
	);

	// Diagnostic logging to dev.log to understand warmup failures without spamming
	useEffect(() => {
		const rosterCount = Array.isArray(participants) ? participants.length : 0;
		const hasSeries = allEntries.length > 0;
		const tickCount = Number(timebase?.tickCount || timebase?.intervalCount || 0) || 0;
		if (hasSeries || rosterCount === 0) {
			lastWarmupLogRef.current = null;
			return;
		}

		const snapshot = {
			rosterCount,
			tickCount,
			seriesPerUser: (participants || []).map((p) => {
				const id = p.profileId || p.hrDeviceId || p.name || p.id;
				const slug = id ? String(id).toLowerCase() : 'unknown';
				const hr = typeof getUserTimelineSeries === 'function' ? (getUserTimelineSeries(slug, 'heart_rate', { clone: true }) || []) : [];
				const beats = typeof getUserTimelineSeries === 'function' ? (getUserTimelineSeries(slug, 'heart_beats', { clone: true }) || []) : [];
				const coins = typeof getUserTimelineSeries === 'function' ? (getUserTimelineSeries(slug, 'coins_total', { clone: true }) || []) : [];
				return {
					id: slug,
					heartRateSamples: hr.length,
					heartBeatsSamples: beats.length,
					coinsSamples: coins.length,
					isActive: p.isActive !== false
				};
			})
		};

		const signature = JSON.stringify(snapshot);
		if (signature !== lastWarmupLogRef.current) {
			lastWarmupLogRef.current = signature;
			console.warn('[FitnessChart][warmup]', snapshot);
		}
	}, [participants, allEntries, timebase, getUserTimelineSeries]);
	
	// Guardrail: Verify chart present count matches roster count
	// If mismatch, dump debug info to help diagnose state synchronization issues
	useEffect(() => {
		const rosterCount = Array.isArray(participants) ? participants.length : 0;
		const chartPresentCount = presentEntries.length;
		
		if (rosterCount > 0 && chartPresentCount !== rosterCount) {
			const rosterIds = (participants || []).map(p => p.profileId || p.id || p.name);
			const chartPresentIds = presentEntries.map(e => e.profileId || e.id);
			const chartAbsentIds = absentEntries.map(e => e.profileId || e.id);
			const allChartIds = allEntries.map(e => ({ id: e.profileId || e.id, status: e.status }));
			
			console.warn('[FitnessChart] Participant count mismatch!', {
				rosterCount,
				chartPresentCount,
				chartAbsentCount: absentEntries.length,
				chartTotalCount: allEntries.length,
				rosterIds,
				chartPresentIds,
				chartAbsentIds,
				allChartEntries: allChartIds,
				// Show which roster IDs are missing from chart present
				missingFromChart: rosterIds.filter(id => !chartPresentIds.includes(id)),
				// Show which chart present IDs are not in roster
				extraInChart: chartPresentIds.filter(id => !rosterIds.includes(id))
			});
		}
	}, [participants, presentEntries, absentEntries, allEntries]);
	
	const { width: chartWidth, height: chartHeight } = chartSize;
	const intervalMs = Number(timebase?.intervalMs) > 0 ? Number(timebase.intervalMs) : 5000;
	const effectiveTicks = Math.max(MIN_VISIBLE_TICKS, maxIndex + 1, 1);
	// Ensure paddedMaxValue provides enough range for MIN_GRID_LINES when maxValue is 0 or small
	const paddedMaxValue = maxValue > 0 ? maxValue + 2 : Y_SCALE_BASE * MIN_GRID_LINES;
	// Always use Y_SCALE_BASE regardless of entry count for consistent grid spacing
	const yScaleBase = Y_SCALE_BASE;
	const [persisted, setPersisted] = useState(null);

	const minDataValue = useMemo(() => {
		const vals = allEntries.flatMap((e) => e.beats || []).filter((v) => Number.isFinite(v));
		return vals.length ? Math.min(...vals) : 0;
	}, [allEntries]);

	const minAxisValue = useMemo(() => {
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

	const lowestValue = useMemo(() => {
		let min = Number.POSITIVE_INFINITY;
		allEntries.forEach((entry) => {
			if (Number.isFinite(entry.lastValue)) {
				if (entry.lastValue < min) min = entry.lastValue;
			}
		});
		if (min === Number.POSITIVE_INFINITY) return Math.max(0, minDataValue);
		return Math.max(0, min);
	}, [allEntries, minDataValue]);

	const scaleY = useMemo(() => {
		const domainMin = Math.min(minAxisValue, paddedMaxValue);
		const domainSpan = Math.max(1, paddedMaxValue - domainMin);
		const topFrac = 0.06;
		const bottomFrac = 1;
		const innerHeight = Math.max(1, chartHeight - CHART_MARGIN.top - CHART_MARGIN.bottom);
		const userCount = allEntries.length;

		return (value) => {
			const clamped = Math.max(domainMin, Math.min(paddedMaxValue, value));
			const norm = (clamped - domainMin) / domainSpan;
			let mapped = norm;

			if (userCount === 1) {
				// Linear scale for single user
				mapped = norm;
			} else if (userCount === 2) {
				// Standard log scale for 2 users
				const logBase = yScaleBase;
				if (logBase > 1) {
					mapped = 1 - Math.log(1 + (1 - norm) * (logBase - 1)) / Math.log(logBase);
				}
			} else {
				// 3+ users: Clamp bottom user to 25% height
				// Calculate normalized value of the lowest user
				const normLow = (lowestValue - domainMin) / domainSpan;
				
				if (normLow > 0 && normLow < 1) {
					// Calculate k for power curve: normLow^k = 0.25
					// k = log(0.25) / log(normLow)
					const k = Math.log(0.25) / Math.log(normLow);
					// Apply power curve
					mapped = Math.pow(norm, k);
				} else {
					// Fallback to standard log if normLow is extreme
					const logBase = yScaleBase;
					if (logBase > 1) {
						mapped = 1 - Math.log(1 + (1 - norm) * (logBase - 1)) / Math.log(logBase);
					}
				}
			}

			const frac = bottomFrac + (topFrac - bottomFrac) * mapped;
			return CHART_MARGIN.top + frac * innerHeight;
		};
	}, [minAxisValue, paddedMaxValue, chartHeight, yScaleBase, allEntries.length, lowestValue]);

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
				yScaleBase,
				scaleY
			});
			return created.map((p, idx) => ({ ...p, id: entry.id, key: `${entry.id}-${globalIdx++}-${idx}` }));
		});
		// Debug: log gap paths
		const gapPaths = allSegments.filter(p => p.isGap);
		if (gapPaths.length > 0) {
			console.log('[FitnessChart] Gap paths in render:', gapPaths.map(p => ({ isGap: p.isGap, d: p.d, opacity: p.opacity })));
		}
		return allSegments;
	}, [allEntries, paddedMaxValue, effectiveTicks, chartWidth, chartHeight, minAxisValue, yScaleBase, scaleY]);

	// Create LayoutManager instance for unified avatar/badge collision resolution
	const layoutManager = useMemo(() => new LayoutManager({
		bounds: { width: chartWidth, height: chartHeight, margin: CHART_MARGIN },
		avatarRadius: AVATAR_RADIUS,
		badgeRadius: ABSENT_BADGE_RADIUS,
		options: {
			enableConnectors: true,
			minSpacing: 4,
			maxDisplacement: 100,
			maxBadgesPerUser: 3
		}
	}), [chartWidth, chartHeight]);

	// Compute base positions for avatars and badges, then run through LayoutManager
	const { avatars, badges, connectors } = useMemo(() => {
		if (!(paddedMaxValue > 0)) {
			return { avatars: [], badges: [], connectors: [] };
		}

		const innerWidth = Math.max(1, chartWidth - CHART_MARGIN.left - CHART_MARGIN.right);
		const ticks = Math.max(MIN_VISIBLE_TICKS, effectiveTicks || 1, 1);

		// Build avatar elements from presentEntries
		const avatarElements = presentEntries.map((entry) => {
			const beats = entry.beats || [];
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
			const x = ticks <= 1 ? CHART_MARGIN.left : CHART_MARGIN.left + (lastIndex / (ticks - 1)) * innerWidth;
			const y = scaleY(lastValue);
			return {
				type: 'avatar',
				id: entry.id,
				x,
				y,
				name: entry.name,
				color: entry.color,
				avatarUrl: entry.avatarUrl,
				value: lastValue
			};
		}).filter(Boolean);

		// Build badge elements from dropoutMarkers
		const badgeElements = dropoutMarkers.map((marker) => {
			const tick = Number.isFinite(marker.tick) ? marker.tick : -1;
			const value = Number.isFinite(marker.value) ? marker.value : null;
			if (tick < 0 || value == null) return null;
			const x = ticks <= 1 ? CHART_MARGIN.left : CHART_MARGIN.left + (tick / (ticks - 1)) * innerWidth;
			const y = scaleY(value);
			const label = (marker.name || '?').trim();
			const initial = label ? label[0].toUpperCase() : '?';
			return {
				type: 'badge',
				id: marker.id,
				participantId: marker.participantId,
				tick: marker.tick,
				x,
				y,
				initial,
				name: marker.name
			};
		}).filter(Boolean);

		// Run through LayoutManager for collision resolution
		const { elements, connectors: layoutConnectors } = layoutManager.layout([...avatarElements, ...badgeElements]);

		// Separate back into avatars and badges
		const resolvedAvatars = elements.filter(e => e.type === 'avatar');
		const resolvedBadges = elements.filter(e => e.type === 'badge');

		return {
			avatars: resolvedAvatars,
			badges: resolvedBadges,
			connectors: layoutConnectors || []
		};
	}, [presentEntries, dropoutMarkers, paddedMaxValue, effectiveTicks, chartWidth, chartHeight, scaleY, layoutManager]);

	const yTicks = useMemo(() => {
		if (!(paddedMaxValue > 0)) return [];
		const start = Math.max(0, Math.min(paddedMaxValue, lowestAvatarValue));
		// Use MIN_GRID_LINES to ensure consistent grid distribution
		const tickCount = MIN_GRID_LINES;
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
			setPersisted({ paths, avatars, badges, connectors, xTicks, yTicks, leaderValue });
		}
	}, [hasData, paths, avatars, badges, connectors, xTicks, yTicks, leaderValue]);

	const displayPaths = hasData ? paths : persisted?.paths || [];
	const displayAvatars = hasData ? avatars : persisted?.avatars || [];
	const displayBadges = hasData ? badges : persisted?.badges || [];
	const displayConnectors = hasData ? connectors : persisted?.connectors || [];
	const displayXTicks = (hasData ? xTicks : persisted?.xTicks || xTicks) || [];
	const displayYTicks = (hasData ? yTicks : persisted?.yTicks || yTicks) || [];

    const layoutClass = {
        standalone: 'chart-layout-full',
        sidebar: 'chart-layout-sidebar',
        overlay: 'chart-layout-overlay',
        mini: 'chart-layout-mini'
    }[mode] || 'chart-layout-sidebar';

	return (
		<div className={`fitness-chart-app ${layoutClass}`} ref={containerRef}>
			{!hasData && !persisted && <div className="race-chart-panel__empty">Timeline warming up…</div>}
			{(hasData || persisted) && (
				<div className="race-chart-panel__body">
					<RaceChartSvg
						paths={displayPaths}
						avatars={displayAvatars}
						badges={displayBadges}
						connectors={displayConnectors}
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

export default FitnessChartApp;
