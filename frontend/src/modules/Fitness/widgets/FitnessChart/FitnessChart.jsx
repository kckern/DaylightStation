import React, { useMemo, useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import useFitnessModule from '@/modules/Fitness/player/useFitnessModule';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { useRenderProfiler } from '@/hooks/fitness/useRenderProfiler.js';
import getLogger from '@/lib/logging/Logger.js';
import './FitnessChart.scss';
import {
	ZONE_COLOR_MAP,
	buildBeatsSeries,
	buildSegments,
	createPaths
} from '@/modules/Fitness/lib/chartHelpers.js';
import { CHART_MARGIN, MIN_VISIBLE_TICKS, MIN_GAP_DURATION_FOR_DASHED_MS } from '@/modules/Fitness/lib/chartConstants.js';
import { ParticipantStatus, getZoneColor, isBroadcasting } from '@/modules/Fitness/domain';
import { LayoutManager } from './layout';
import { compareLegendEntries } from './layout/utils/sort.js';
import { createChartDataSource } from './sessionDataAdapter.js';
import { resolveHistoricalParticipant } from './resolveHistoricalParticipant.js';
export { resolveHistoricalParticipant } from './resolveHistoricalParticipant.js';

const DEFAULT_CHART_WIDTH = 420;
const DEFAULT_CHART_HEIGHT = 390;
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

// Safety limits to prevent unbounded memory growth
const MAX_SERIES_POINTS = 1000; // Max points per series (at 5s intervals = ~83 minutes)
const MAX_TOTAL_POINTS = 50000; // Global safety cap across all series

/**
 * Shallow-compare two participant cache entries.
 * Returns true if all chart-relevant fields are identical.
 * Compares beats/segments/dropoutMarkers by length; zones not compared (not chart-relevant from cache).
 */
function cacheEntryEqual(a, b) {
	if (a === b) return true;
	if (!a || !b) return false;
	// Identity
	if (a.id !== b.id || a.profileId !== b.profileId) return false;
	// Status (drives avatar vs badge rendering)
	if (a.status !== b.status || a.isActive !== b.isActive) return false;
	// Visual data (drives line rendering)
	if (a.lastSeenTick !== b.lastSeenTick || a.lastValue !== b.lastValue) return false;
	// Series lengths (if series grew, need new render)
	if ((a.beats?.length || 0) !== (b.beats?.length || 0)) return false;
	if ((a.segments?.length || 0) !== (b.segments?.length || 0)) return false;
	// Zone color (drives line color)
	if (a.color !== b.color) return false;
	// Dropout markers (drives badge rendering)
	if ((a.dropoutMarkers?.length || 0) !== (b.dropoutMarkers?.length || 0)) return false;
	return true;
}

/**
 * Hook to build race chart data from roster and timeline series.
 * @param {Array} roster - Current participant roster
 * @param {Function} getSeries - Timeline series getter
 * @param {Object} timebase - Timeline timebase config
 * @param {Object} [options] - Additional options
 * @param {import('../../../domain').ActivityMonitor} [options.activityMonitor] - Optional ActivityMonitor for centralized activity tracking
 * @param {Array} [options.zoneConfig] - Zone configuration for coin rate lookup (fixes sawtooth)
 */
const useRaceChartData = (roster, getSeries, timebase, options = {}) => {
	const { activityMonitor, zoneConfig } = options;
	
	return useMemo(() => {
		if (!Array.isArray(roster) || roster.length === 0 || typeof getSeries !== 'function') {
			return { entries: [], maxValue: 0, maxIndex: 0 };
		}

		// Build chart entries from roster
		const debugItems = roster.map((entry, idx) => {
			let { beats, zones, active } = buildBeatsSeries(entry, getSeries, timebase, { activityMonitor });
			
			// Safety: Trim series to prevent unbounded memory growth
			if (beats.length > MAX_SERIES_POINTS) {
				beats = beats.slice(-MAX_SERIES_POINTS);
				zones = zones.slice(-MAX_SERIES_POINTS);
				active = active.slice(-MAX_SERIES_POINTS);
			}
			
			const maxVal = Math.max(0, ...beats.filter((v) => Number.isFinite(v)));
			// Pass zoneConfig and intervalMs to buildSegments for zone-based slope enforcement (fixes sawtooth)
			const intervalMs = Number(timebase?.intervalMs) > 0 ? Number(timebase.intervalMs) : 5000;
			const segments = buildSegments(beats, zones, active, { zoneConfig, intervalMs });
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
			
			const resolvedAvatar = entry.avatarUrl || DaylightMediaPath(`/static/img/users/${profileId || 'user'}`);
			
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

		// Global safety cap - if total points exceed limit, log warning
		const totalPoints = debugItems.reduce((sum, e) => sum + (e.beats?.length || 0), 0);
		if (totalPoints > MAX_TOTAL_POINTS) {
			getLogger().sampled('fitness_chart.global_cap_warning', {
				totalPoints, entryCount: debugItems.length
			}, { maxPerMinute: 1, aggregate: true });
		}

		// Allow entries with zero beats to display - they'll accumulate over time
		// Only filter out entries with no segments (no HR data at all)
		const shaped = debugItems.filter((item) => item.segments.length > 0);

		// Debug guardrail: log when roster/active/chart counts diverge
		// Filter out synthetic entries (e.g., 'global' combined score) before comparison
		const rosterIds = roster
			.map((r, i) => slugifyId(r.profileId || r.hrDeviceId || r.name || r.displayLabel || i, `anon-${i}`))
			.filter(id => id !== 'global' && !id.startsWith('global:'));
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
			getLogger().sampled('fitness_chart.avatar_mismatch', {
				rosterCount,
				activeRosterCount,
				chartCount,
				missingFromChart: missing,
				extraOnChart: extra
			}, { maxPerMinute: 2, aggregate: true });
		}

		// GUARDRAIL: Log when roster.isActive differs from segment state (for debugging)
		// We trust roster.isActive as source of truth, but want to see divergences
		shaped.forEach((item) => {
			const lastSeg = item.segments[item.segments.length - 1];
			const endsWithGap = lastSeg?.isGap === true;
			const isActiveFromRoster = item.isActive !== false;
			// Note: We expect endsWithGap when !isActive, but isActive is authoritative
			if (endsWithGap && isActiveFromRoster) {
				getLogger().sampled('fitness_chart.gap_roster_mismatch', {
					id: item.id,
					endsWithGap,
					isActive: item.isActive
				}, { maxPerMinute: 2, aggregate: true });
			}
		});

		const maxValue = Math.max(0, ...shaped.map((e) => e.maxVal));
		const maxIndex = Math.max(0, ...shaped.map((e) => e.lastIndex));
		return { entries: shaped, maxValue, maxIndex };
	}, [roster, getSeries, timebase, activityMonitor, zoneConfig]);
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
 * @param {Array} [options.zoneConfig] - Zone configuration for coin rate lookup (fixes sawtooth)
 * @param {string} [options.sessionId] - Session ID to clear cache when session changes (memory leak fix)
 */
const useRaceChartWithHistory = (roster, getSeries, timebase, historicalParticipantIds = [], options = {}) => {
	const { activityMonitor, zoneConfig, sessionId, resolveHistorical } = options;
	const { entries: presentEntries } = useRaceChartData(roster, getSeries, timebase, { activityMonitor, zoneConfig });
	const [participantCache, setParticipantCache] = useState({});
	// Track which historical IDs we've already processed to avoid re-processing on every render
	const processedHistoricalRef = useRef(new Set());
	// Track last seen sessionId to detect session changes
	const lastSessionIdRef = useRef(sessionId);

	// MEMORY LEAK FIX: Clear all cached state when session ends or changes
	// This prevents stale participant data from accumulating across sessions
	useEffect(() => {
		// Session changed (including ended → new session, or active → ended)
		if (lastSessionIdRef.current !== sessionId) {
			lastSessionIdRef.current = sessionId;
			// Clear all accumulated state
			setParticipantCache({});
			processedHistoricalRef.current.clear();
		}
	}, [sessionId]);

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

				// Pass zoneConfig and intervalMs for zone-based slope enforcement
				const intervalMs = Number(timebase?.intervalMs) > 0 ? Number(timebase.intervalMs) : 5000;
				const segments = buildSegments(beats, zones, active, { zoneConfig, intervalMs });
				if (!segments.length) return;
				
				// Skip non-HR devices (no accumulated beats)
				const maxVal = Math.max(0, ...beats.filter((v) => Number.isFinite(v)));
				if (maxVal <= 0) return;

				// Find last ACTIVE tick using `active` array (same logic as present entries)
				// This correctly identifies dropout tick, unlike beats which is forward-filled
				let lastActiveIndex = -1;
				for (let i = active.length - 1; i >= 0; i -= 1) {
					if (active[i] === true) {
						lastActiveIndex = i;
						break;
					}
				}
				// Fall back to last finite beat if no active ticks found
				let lastIndex = lastActiveIndex;
				if (lastIndex < 0) {
					for (let i = beats.length - 1; i >= 0; i -= 1) {
						if (Number.isFinite(beats[i])) {
							lastIndex = i;
							break;
						}
					}
				}
				// Get lastValue at the determined lastIndex
				const lastValue = lastIndex >= 0 && Number.isFinite(beats[lastIndex]) ? beats[lastIndex] : null;

				const hydrated = typeof resolveHistorical === 'function'
					? resolveHistorical(slug)
					: { name: slug, avatarUrl: null, profileId: slug };
				next[slug] = {
					id: slug,
					name: hydrated.name || slug,
					profileId: hydrated.profileId || slug,
					avatarUrl: hydrated.avatarUrl || null,
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
			let changed = false;

			presentEntries.forEach((entry) => {
				const id = entry.profileId || entry.id;
				presentIds.add(id);
				const lastValue = getLastFiniteValue(entry.beats || []);
				const lastSeenTick = entry.lastIndex;
				const prevEntry = prev[id];

				// Preserve existing dropout markers (IMMUTABLE) for badge rendering
				// Reused by reference when unchanged; replaced via spread only when a new marker is added
				let dropoutMarkers = prevEntry?.dropoutMarkers || [];

				// Create dropout marker ONLY when returning from dropout (was inactive, now active again)
				const wasInactive = prevEntry && (prevEntry.isActive === false || !isBroadcasting(prevEntry.status));
				const nowActive = entry.isActive !== false;
				const isRejoining = wasInactive && nowActive;

				if (isRejoining && prevEntry.lastValue != null && (prevEntry.lastSeenTick ?? -1) >= 0) {
					const firstNewIdx = findFirstFiniteAfter(entry.beats || [], prevEntry.lastSeenTick ?? -1);
					if (firstNewIdx != null) {
						const newMarker = {
							tick: prevEntry.lastSeenTick,
							value: prevEntry.lastValue,
							timestamp: Date.now()
						};
						const isDuplicate = dropoutMarkers.some(m => m.tick === newMarker.tick);
						if (!isDuplicate) {
							dropoutMarkers = [...dropoutMarkers, newMarker];
						}
					}
				}

				const candidate = {
					...prevEntry,
					...entry,
					segments: entry.segments,
					beats: entry.beats,
					zones: entry.zones,
					lastSeenTick,
					lastValue,
					status: entry.status,
					isActive: entry.isActive,
					dropoutMarkers,
					absentSinceTick: entry.status === ParticipantStatus.IDLE ? (prevEntry?.absentSinceTick ?? lastSeenTick) : null
				};

				// Only create new entry if something chart-relevant changed
				if (cacheEntryEqual(prevEntry, candidate)) {
					// Keep previous reference — prevents downstream invalidation
					next[id] = prevEntry;
				} else {
					next[id] = candidate;
					changed = true;
				}
			});

			Object.keys(next).forEach((id) => {
				if (!presentIds.has(id)) {
					const ent = next[id];
					if (ent && (ent.status !== ParticipantStatus.IDLE || ent.isActive !== false)) {
						next[id] = {
							...ent,
							status: ParticipantStatus.IDLE,
							isActive: false,
							absentSinceTick: ent.absentSinceTick ?? ent.lastSeenTick ?? 0
						};
						changed = true;
					}
				}
			});

			// Return previous state if nothing meaningful changed — prevents re-render
			return changed ? next : prev;
		});
	}, [presentEntries]);

	const allEntries = useMemo(() => Object.values(participantCache).filter((e) => e && (e.segments?.length || 0) > 0), [participantCache]);
	
	// Throttle console warnings to prevent hot path performance penalty
	const warnThrottleRef = useRef({});
	const throttledWarn = useCallback((key, message) => {
		const now = Date.now();
		if (!warnThrottleRef.current[key] || now - warnThrottleRef.current[key] > 5000) {
			console.warn(message);
			warnThrottleRef.current[key] = now;
		}
	}, []);
	
	// SINGLE SOURCE OF TRUTH: Use isActive from roster (set by DeviceManager.inactiveSince)
	// Segments are for RENDERING only - they control line style (solid/dotted)
	// isActive controls avatar visibility (present vs absent)
	const validatedEntries = useMemo(() => {
		return allEntries.map((entry) => {
			// isActive comes directly from DeviceManager via roster
			// If isActive is false, user should be in absent (show badge, not avatar)
			const isActiveFromRoster = entry.isActive !== false;
			const correctStatus = isActiveFromRoster ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE;
			
			// Only create new object if status actually differs
			if (entry.status === correctStatus) {
				return entry; // Return original object - same reference
			}
			
			// Log if there's a mismatch (throttled to prevent hot path penalty)
			throttledWarn(`status-${entry.id}`, `[FitnessChart] Status corrected: ${entry.id} (${entry.status} → ${correctStatus})`);
			
			return { ...entry, status: correctStatus };
		});
	}, [allEntries, throttledWarn]);
	
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

const RaceChartSvg = ({ paths, avatars, badges, connectors = [], xTicks, yTicks, width, height, focusedUserId }) => (
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
			{(() => {
				const sorted = focusedUserId
					? [...paths].sort((a, b) => (a.id === focusedUserId ? 1 : 0) - (b.id === focusedUserId ? 1 : 0))
					: paths;
				return sorted.map((path, idx) => {
					const isLongGap = path.isGap && (path.gapDurationMs || 0) >= MIN_GAP_DURATION_FOR_DASHED_MS;
					const isShortGap = path.isGap && !isLongGap;
					const isFocused = !focusedUserId || path.id === focusedUserId;
					const baseOpacity = isShortGap ? 0.7 : (path.opacity ?? 1);
					const finalOpacity = focusedUserId ? (isFocused ? baseOpacity : 0.1) : baseOpacity;
					return (
						<path
							key={`${path.zone || 'seg'}-${idx}`}
							d={path.d}
							stroke={isLongGap ? ZONE_COLOR_MAP.default : path.color}
							fill="none"
							strokeWidth={PATH_STROKE_WIDTH}
							opacity={finalOpacity}
							strokeLinecap={isLongGap ? 'butt' : 'round'}
							strokeLinejoin="round"
							strokeDasharray={isLongGap ? '4 4' : undefined}
						/>
					);
				});
			})()}
		</g>
		{/* Connectors link displaced avatars back to their line endpoints */}
		<g className="race-chart__connectors">
			{connectors.map((conn) => {
				const isFocused = !focusedUserId || conn.id === `connector-${focusedUserId}`;
				return (
					<line
						key={conn.id}
						x1={conn.x1}
						y1={conn.y1}
						x2={conn.x2}
						y2={conn.y2}
						stroke={conn.color || '#9ca3af'}
						strokeWidth={2}
						strokeDasharray="4 2"
						opacity={focusedUserId ? (isFocused ? 0.6 : 0.1) : 0.6}
					/>
				);
			})}
		</g>
		<g className="race-chart__absent-badges">
			{badges.map((badge) => {
				const bx = badge.x + (badge.offsetX || 0);
				const by = badge.y + (badge.offsetY || 0);
				const baseOpacity = badge.opacity ?? 1;
				const isFocused = !focusedUserId || badge.participantId === focusedUserId;
				const finalOpacity = focusedUserId ? (isFocused ? baseOpacity : 0.1) : baseOpacity;
				return (
					<g key={`absent-${badge.id}`} transform={`translate(${bx}, ${by})`} opacity={finalOpacity}>
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
			{(() => {
				const sorted = focusedUserId
					? [...avatars].sort((a, b) => (a.id === focusedUserId ? 1 : 0) - (b.id === focusedUserId ? 1 : 0))
					: avatars;
				return sorted.map((avatar, idx) => {
					const size = AVATAR_RADIUS * 2;
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
					const isFocused = !focusedUserId || avatar.id === focusedUserId;
					const groupOpacity = focusedUserId ? (isFocused ? 1 : 0.1) : 1;
					const initial = (avatar.name || avatar.id || '?')[0].toUpperCase();
					return (
						<g
							key={clipId}
							className="race-chart__avatar-group"
							transform={`translate(${ax}, ${ay})`}
							opacity={groupOpacity}
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
				});
			})()}
		</g>
	</svg>
);

const FitnessChart = ({ mode, onClose, config, onMount, sessionData }) => {
	useRenderProfiler('FitnessChart');
	const {
		participants,
		historicalParticipants,
		getUserTimelineSeries,
		timebase,
		registerLifecycle,
		activityMonitor,  // Phase 2 - centralized activity tracking
		zoneConfig,       // Zone config for coin rate lookup (fixes sawtooth)
		sessionId,        // Session ID for cache cleanup on session change
		participantDisplayMap,     // SSoT for name/avatar/progress/zoneIndex per participant
		sessionParticipantsMeta    // Persisted session meta (for offline hydration — Issue A)
	} = useFitnessModule('fitness_chart');

	// Historical mode: use static session data instead of live module data
	const staticSource = useMemo(() => {
		if (!sessionData) return null;
		// Use the object that has timeline data — sessionData itself if it has .timeline,
		// otherwise check .session wrapper (but only if that wrapper has .timeline too)
		const session = sessionData.timeline ? sessionData
			: (sessionData.session?.timeline ? sessionData.session : sessionData);
		return createChartDataSource(session);
	}, [sessionData]);
	const isHistorical = !!staticSource;

	// Choose data source: static (historical) or live (module)
	const chartParticipants = isHistorical ? staticSource.roster : participants;
	const chartGetSeries = isHistorical ? staticSource.getSeries : getUserTimelineSeries;
	const chartTimebase = isHistorical ? staticSource.timebase : timebase;
	const chartHistorical = isHistorical ? [] : historicalParticipants;
	const chartActivityMonitor = isHistorical ? null : activityMonitor;
	const chartZoneConfig = zoneConfig;
	const chartSessionId = isHistorical ? (sessionData?.session?.id || sessionData?.sessionId || 'historical') : sessionId;

	const containerRef = useRef(null);
	const [chartSize, setChartSize] = useState({ width: DEFAULT_CHART_WIDTH, height: DEFAULT_CHART_HEIGHT });
	const lastWarmupLogRef = useRef(null);

    useEffect(() => {
        onMount?.();
    }, [onMount]);

    useEffect(() => {
        if (isHistorical) return;
        registerLifecycle({
            onPause: () => {},
            onResume: () => {},
            onSessionEnd: () => {}
        });
    }, [registerLifecycle, isHistorical]);

	useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el) return;

		const updateSize = () => {
			const rect = el.getBoundingClientRect();
			const width = Math.max(240, rect.width || DEFAULT_CHART_WIDTH);
			const height = Math.max(200, rect.height || DEFAULT_CHART_HEIGHT);
			// Only update state if dimensions actually changed to prevent infinite render loop
			setChartSize((prev) => {
				if (prev.width === width && prev.height === height) {
					return prev; // Return same reference to skip re-render
				}
				return { width, height };
			});
		};

		updateSize();
		const resizeObserver = new ResizeObserver(() => updateSize());
		resizeObserver.observe(el);
		return () => resizeObserver.disconnect();
	}, []);

	// Pass activityMonitor for centralized activity tracking (Phase 2)
	// Pass zoneConfig for zone-based slope enforcement (fixes sawtooth pattern)
	// Pass sessionId to clear cache on session change (memory leak fix)
	const resolveHistorical = useCallback((slug) => {
		return resolveHistoricalParticipant(slug, {
			displayMap: participantDisplayMap,
			sessionMeta: sessionParticipantsMeta
		});
	}, [participantDisplayMap, sessionParticipantsMeta]);

	const { allEntries, presentEntries, absentEntries, dropoutMarkers, maxValue, maxIndex } = useRaceChartWithHistory(
		chartParticipants,
		chartGetSeries,
		chartTimebase,
		chartHistorical,
		{ activityMonitor: chartActivityMonitor, zoneConfig: chartZoneConfig, sessionId: chartSessionId, resolveHistorical }
	);

	// TELEMETRY: Expose chart stats for memory leak profiling
	useEffect(() => {
		window.__fitnessChartStats = () => ({
			participantCacheSize: allEntries.length,
			dropoutMarkerCount: dropoutMarkers?.length || 0,
			presentEntriesCount: presentEntries?.length || 0,
			absentEntriesCount: absentEntries?.length || 0,
			maxValue,
			maxIndex
		});
		return () => {
			delete window.__fitnessChartStats;
		};
	}, [allEntries.length, dropoutMarkers?.length, presentEntries?.length, absentEntries?.length, maxValue, maxIndex]);

	// Diagnostic logging to dev.log to understand warmup failures without spamming
	useEffect(() => {
		const rosterCount = Array.isArray(chartParticipants) ? chartParticipants.length : 0;
		const hasSeries = allEntries.length > 0;
		const tickCount = Number(timebase?.tickCount || timebase?.intervalCount || 0) || 0;
		if (hasSeries || rosterCount === 0) {
			lastWarmupLogRef.current = null;
			return;
		}

		const snapshot = {
			rosterCount,
			tickCount,
			seriesPerUser: (chartParticipants || []).map((p) => {
				const id = p.profileId || p.hrDeviceId || p.name || p.id;
				const slug = id ? String(id).toLowerCase() : 'unknown';
				const hr = typeof chartGetSeries === 'function' ? (chartGetSeries(slug, 'heart_rate', { clone: true }) || []) : [];
				const beats = typeof chartGetSeries === 'function' ? (chartGetSeries(slug, 'heart_beats', { clone: true }) || []) : [];
				const coins = typeof chartGetSeries === 'function' ? (chartGetSeries(slug, 'coins_total', { clone: true }) || []) : [];
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
			getLogger().sampled('fitness_chart.warmup', snapshot, { maxPerMinute: 2, aggregate: true });
		}
	}, [chartParticipants, allEntries, timebase, chartGetSeries]);
	
	// Guardrail: Verify chart present count matches roster count
	// If mismatch, dump debug info to help diagnose state synchronization issues
	useEffect(() => {
		const rosterCount = Array.isArray(chartParticipants) ? chartParticipants.length : 0;
		const chartPresentCount = presentEntries.length;

		// Filter out synthetic entries before mismatch comparison
		const filteredParticipants = (chartParticipants || []).filter(p => {
			const id = p.profileId || p.id || p.name || '';
			return id !== 'global' && !id.startsWith('global:');
		});
		const filteredRosterCount = filteredParticipants.length;

		if (filteredRosterCount > 0 && chartPresentCount !== filteredRosterCount) {
			const rosterIds = filteredParticipants.map(p => p.profileId || p.id || p.name);
			const chartPresentIds = presentEntries.map(e => e.profileId || e.id);

			getLogger().sampled('fitness_chart.participant_mismatch', {
				rosterCount: filteredRosterCount,
				chartPresentCount,
				chartTotalCount: allEntries.length,
				missingFromChart: rosterIds.filter(id => !chartPresentIds.includes(id))
			}, { maxPerMinute: 2, aggregate: true });
		}
	}, [chartParticipants, presentEntries, absentEntries, allEntries]);
	
	const { width: chartWidth, height: chartHeight } = chartSize;
	const effectiveTicks = Math.max(MIN_VISIBLE_TICKS, maxIndex + 1, 1);
	// Ensure paddedMaxValue provides enough range for MIN_GRID_LINES when maxValue is 0 or small
	const paddedMaxValue = maxValue > 0 ? maxValue + 2 : Y_SCALE_BASE * MIN_GRID_LINES;
	// Always use Y_SCALE_BASE regardless of entry count for consistent grid spacing
	const yScaleBase = Y_SCALE_BASE;
	const [persisted, setPersisted] = useState(null);
	const [useLogScale, setUseLogScale] = useState(true);
	const [focusedUserId, setFocusedUserId] = useState(null);

	// MEMORY LEAK FIX: Clear persisted chart data when session ends
	// This prevents stale chart snapshots from lingering in memory
	const lastPersistedSessionRef = useRef(sessionId);
	useEffect(() => {
		if (lastPersistedSessionRef.current !== sessionId) {
			lastPersistedSessionRef.current = sessionId;
			setPersisted(null);
			setFocusedUserId(null);
		}
	}, [sessionId]);

	const minDataValue = useMemo(() => {
		const vals = allEntries.flatMap((e) => e.beats || []).filter((v) => Number.isFinite(v));
		return vals.length ? Math.min(...vals) : 0;
	}, [allEntries]);

	const minAxisValue = useMemo(() => {
		return Math.min(0, minDataValue);
	}, [minDataValue]);

	const lowestAvatarValue = useMemo(() => {
		let min = Number.POSITIVE_INFINITY;
		// Include BOTH present entries (active avatars) AND absent entries (dropout badges)
		// This ensures gridlines stay anchored to dropout positions, not just active users
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
		// Also consider absent entries (dropouts) - use their lastValue as dropout position
		absentEntries.forEach((entry) => {
			if (Number.isFinite(entry.lastValue) && entry.lastValue < min) {
				min = entry.lastValue;
			}
		});
		if (min === Number.POSITIVE_INFINITY) return Math.max(0, minDataValue);
		return Math.max(0, min);
	}, [presentEntries, absentEntries, minDataValue]);

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

			if (!useLogScale || userCount === 1) {
				// Linear scale
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
	}, [minAxisValue, paddedMaxValue, chartHeight, yScaleBase, allEntries.length, lowestValue, useLogScale]);

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
		// Use entry.lastIndex (last ACTIVE tick) so dropout avatars appear at the dropout point,
		// not at the end of the forward-filled beats array
		const avatarElements = presentEntries.map((entry) => {
			const beats = entry.beats || [];
			const lastIndex = entry.lastIndex >= 0 ? entry.lastIndex : -1;
			const lastValue = lastIndex >= 0 && Number.isFinite(beats[lastIndex]) ? beats[lastIndex] : null;
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

		// Single user: gridlines span full range from 0 to max (linear distribution)
		// Multi-user: gridlines span from lowest avatar to max (focus on relative positions)
		const isSingleUser = allEntries.length === 1;
		const start = isSingleUser ? 0 : Math.max(0, Math.min(paddedMaxValue, lowestAvatarValue));
		// Use MIN_GRID_LINES to ensure consistent grid distribution
		// For single user, we need MIN_GRID_LINES + 1 ticks total because the X-axis
		// serves as the bottom reference (value=0), so we skip value=0 in yTicks
		const tickCount = isSingleUser ? MIN_GRID_LINES + 1 : MIN_GRID_LINES;
		const span = Math.max(1, paddedMaxValue - start);
		const values = Array.from({ length: tickCount }, (_, idx) => {
			const t = idx / Math.max(1, tickCount - 1);
			return start + span * t;
		});
		// For single user, filter out value=0 since the X-axis line already provides this reference
		const filteredValues = isSingleUser ? values.filter(v => v > 0) : values;
		return filteredValues.map((value) => ({
			value,
			label: value.toFixed(0),
			y: scaleY(value),
			x1: 0,
			x2: chartWidth
		}));
	}, [paddedMaxValue, lowestAvatarValue, chartWidth, scaleY, allEntries.length]);

	const xTicks = useMemo(() => {
		// Defensive: calculate intervalMs inside useMemo to ensure it's always in scope
		// This prevents potential ReferenceError under heavy GC pressure
		const intervalMsLocal = Number(timebase?.intervalMs) > 0 ? Number(timebase.intervalMs) : 5000;
		const totalMs = effectiveTicks * intervalMsLocal;
		const positions = [0, 0.25, 0.5, 0.75, 1];
		const innerWidth = Math.max(1, chartWidth - CHART_MARGIN.left - CHART_MARGIN.right);
		return positions.map((p) => {
			const x = CHART_MARGIN.left + p * innerWidth;
			const label = formatDuration(totalMs * p);
			return { x, label };
		});
	}, [effectiveTicks, timebase?.intervalMs, chartWidth]);

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

	const filterEntries = useMemo(() => {
		if (allEntries.length <= 1) return [];
		const slugify = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
		const enriched = allEntries.map(entry => {
			const displayEntry = participantDisplayMap?.get(slugify(entry.id))
				|| participantDisplayMap?.get(slugify(entry.profileId))
				|| participantDisplayMap?.get(slugify(entry.name))
				|| null;
			return {
				id: entry.id,
				name: entry.name || 'Unknown',
				color: entry.color || '#9ca3af',
				avatarUrl: entry.avatarUrl,
				zoneIndex: displayEntry?.zoneIndex ?? null,
				progress: displayEntry?.progress ?? null,
				heartRate: displayEntry?.heartRate ?? null,
			};
		});
		enriched.sort(compareLegendEntries);
		return enriched;
	}, [allEntries, participantDisplayMap]);

	useEffect(() => {
		if (allEntries.length <= 1) {
			setFocusedUserId(null);
		} else if (focusedUserId && !allEntries.some(e => e.id === focusedUserId)) {
			setFocusedUserId(null);
		}
	}, [allEntries, focusedUserId]);

    const layoutClass = {
        standalone: 'chart-layout-full',
        sidebar: 'chart-layout-sidebar',
        overlay: 'chart-layout-overlay',
        mini: 'chart-layout-mini'
    }[mode] || 'chart-layout-sidebar';

	return (
		<div className={`fitness-chart ${layoutClass}`} ref={containerRef}>
			{!hasData && !persisted && !isHistorical && <div className="race-chart-panel__empty">Timeline warming up…</div>}
			{!hasData && !persisted && isHistorical && <div className="race-chart-panel__empty">No timeline data for this session</div>}
			{(hasData || persisted) && allEntries.length > 1 && (
				<button
					className={`race-chart__scale-toggle${useLogScale ? ' race-chart__scale-toggle--log' : ''}`}
					onClick={() => setUseLogScale(prev => !prev)}
					title={useLogScale ? 'Switch to linear scale' : 'Switch to logarithmic scale'}
				>
					{useLogScale ? 'LOG' : 'LIN'}
				</button>
			)}
			{(hasData || persisted) && filterEntries.length > 0 && (
				<div className="race-chart__focus-filter">
					{filterEntries.map(entry => (
						<button
							key={entry.id}
							className={`race-chart__focus-filter-item${focusedUserId === entry.id ? ' race-chart__focus-filter-item--active' : ''}`}
							onClick={() => setFocusedUserId(prev => prev === entry.id ? null : entry.id)}
							title={`Focus on ${entry.name}`}
						>
							<img
								src={entry.avatarUrl}
								alt={entry.name}
								className="race-chart__focus-filter-avatar"
								style={{ borderColor: entry.color }}
							/>
							<span>{entry.name}</span>
						</button>
					))}
				</div>
			)}
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
						focusedUserId={focusedUserId}
					/>
				</div>
			)}
		</div>
	);
};

export default FitnessChart;
