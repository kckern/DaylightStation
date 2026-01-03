import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
import useFitnessPlugin from '../../useFitnessPlugin';
import { DaylightMediaPath } from '../../../../../lib/api.mjs';
import getLogger from '../../../../../lib/logging/Logger.js';
import { LayoutManager, useAnimatedLayout, ConnectorGenerator } from './layout/index.js';
import './FitnessChartApp.scss';
import {
	MIN_VISIBLE_TICKS,
	ZONE_COLOR_MAP,
	buildBeatsSeries,
	buildSegments,
	createPaths
} from '../../../FitnessSidebar/FitnessChart.helpers.js';
import { ParticipantStatus, getZoneColor, isBroadcasting } from '../../../domain';

const DEFAULT_CHART_WIDTH = 420;
const DEFAULT_CHART_HEIGHT = 390;
const CHART_MARGIN = { top: 10, right: 64, bottom: 38, left: 4 };
const AVATAR_RADIUS = 30;
const AVATAR_OVERLAP_THRESHOLD = AVATAR_RADIUS * 2;
const ABSENT_BADGE_RADIUS = 10;
const COIN_LABEL_GAP = 8;
const Y_SCALE_BASE = 20;
const MIN_GRID_LINES = 4;
const PATH_STROKE_WIDTH = 5;
const TICK_FONT_SIZE = 20;
const COIN_FONT_SIZE = 20;

// Note: slugifyId has been removed - we now use explicit IDs from config

// Simple sanitizer for SVG clip-path IDs (must be valid XML identifiers)
const sanitizeIdForSvg = (value, fallback = 'user') => {
	if (!value) return fallback;
	// Replace invalid chars with underscore, ensure doesn't start with number
	const safe = String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
	return safe.length > 0 && !/^[0-9]/.test(safe) ? safe : `id_${safe}`;
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
 * @param {Function} getSeries - Timeline series getter (user series)
 * @param {Object} timebase - Timeline timebase config
 * @param {Object} [options] - Additional options
 * @param {import('../../../domain').ActivityMonitor} [options.activityMonitor] - Optional ActivityMonitor for centralized activity tracking
 * @param {Function} [options.getEntitySeries] - Phase 5: Entity series getter for entity-aware rendering
 */
const useRaceChartData = (roster, getSeries, timebase, options = {}) => {
	const { activityMonitor, getEntitySeries } = options;
	
	return useMemo(() => {
		if (!Array.isArray(roster) || roster.length === 0 || typeof getSeries !== 'function') {
			return { entries: [], maxValue: 0, maxIndex: 0 };
		}

		// Build chart entries from roster
		const debugItems = roster.map((entry, idx) => {
			// Phase 5: Pass getEntitySeries for entity-aware chart data
			const { beats, zones, active } = buildBeatsSeries(entry, getSeries, timebase, { activityMonitor, getEntitySeries });
			const maxVal = Math.max(0, ...beats.filter((v) => Number.isFinite(v)));
			// Pass roster's isActive status to enable immediate gap rendering when user rejoins
			const isCurrentlyActive = entry.isActive !== false;
			const currentTick = timebase?.tickCount ?? beats.length - 1;
			const segments = buildSegments(beats, zones, active, { isCurrentlyActive, currentTick });
			const profileId = entry.profileId || entry.id || entry.hrDeviceId || String(idx);
			const entryId = entry.id || entry.profileId || entry.hrDeviceId || String(idx);
			
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
		const rosterIds = roster.map((r, i) => r.id || r.profileId || r.hrDeviceId || String(i));
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
			getLogger().warn('fitness.chart.avatar_mismatch', {
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
			// Note: We expect endsWithGap when !isActive, but isActive is authoritative
		});

		const maxValue = Math.max(0, ...shaped.map((e) => e.maxVal));
		const maxIndex = Math.max(0, ...shaped.map((e) => e.lastIndex));
		return { entries: shaped, maxValue, maxIndex };
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [roster, getSeries, timebase?.tickCount, timebase?.intervalCount, activityMonitor]);
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
 * @param {Function} [options.getEntitySeries] - Phase 5: Entity series getter
 */
const useRaceChartWithHistory = (roster, getSeries, timebase, historicalParticipantIds = [], options = {}) => {
	const { activityMonitor, getEntitySeries, transferredUsers } = options;
	const { entries: presentEntries } = useRaceChartData(roster, getSeries, timebase, { activityMonitor, getEntitySeries });
	const [participantCache, setParticipantCache] = useState({});
	// Track which historical IDs we've already processed to avoid re-processing on every render
	const processedHistoricalRef = useRef(new Set());

	// Clear transferred users from cache when transfers happen
	// This ensures their old data is removed and the new user's data is fresh
	useEffect(() => {
		if (!transferredUsers?.size) return;
		
		setParticipantCache((prev) => {
			const next = { ...prev };
			let changed = false;
			transferredUsers.forEach((userId) => {
				if (next[userId]) {
					delete next[userId];
					changed = true;
				}
			});
			return changed ? next : prev;
		});
		
		// Also clear from processed set so they don't get re-added from historical
		transferredUsers.forEach((userId) => {
			processedHistoricalRef.current.delete(userId);
		});
	}, [transferredUsers]);

	// Initialize cache from historical participants (1B fix)
	// Uses processedHistoricalRef instead of boolean flag to allow late arrivals while avoiding duplicates
	// Filter out transferred users (their data was moved to another identity)
	useEffect(() => {
		if (!historicalParticipantIds.length || typeof getSeries !== 'function') {
			return;
		}
		
		setParticipantCache((prev) => {
			const next = { ...prev };
			historicalParticipantIds.forEach((slug) => {
				// Skip if already processed or already in cache (including from presentEntries)
				if (!slug || next[slug] || processedHistoricalRef.current.has(slug)) return;
				
				// Skip transferred users - their data was moved to another identity
				if (transferredUsers?.has?.(slug)) {
					return;
				}
				
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
	}, [historicalParticipantIds, getSeries, transferredUsers]);

	// Phase 2: Reconstruct dropout events from timeline on mount
	useEffect(() => {
		if (activityMonitor && typeof getSeries === 'function' && timebase) {
			// Get all known participant IDs (present + historical)
			const allIds = new Set([...presentEntries.map(e => e.profileId || e.id), ...historicalParticipantIds]);
			activityMonitor.reconstructFromTimeline(getSeries, Array.from(allIds), timebase);
		}
	}, [activityMonitor, getSeries, timebase, historicalParticipantIds.length]);

	// Track presentEntries signature to prevent infinite loop
	// Only update cache when entries actually change (by comparing IDs + key metrics)
	const lastPresentSignatureRef = useRef(null);
	
	useEffect(() => {
		// Create signature from entry IDs and their key values to detect actual changes
		const signature = presentEntries.map(e => `${e.profileId || e.id}:${e.lastIndex}:${e.isActive}`).sort().join('|');
		if (signature === lastPresentSignatureRef.current) {
			return; // No actual change, skip update
		}
		lastPresentSignatureRef.current = signature;
		
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
				
				// SINGLE SOURCE OF TRUTH: ActivityMonitor owns all dropout events
				// Record dropout IMMEDIATELY when transition from active to inactive
				const wasActive = prevEntry && (prevEntry.isActive !== false && isBroadcasting(prevEntry.status));
				const nowInactive = entry.isActive === false;
				const isDropping = wasActive && nowInactive;
				
				if (isDropping && activityMonitor && prevEntry.lastValue != null && (prevEntry.lastSeenTick ?? -1) >= 0) {
					// Record dropout immediately (not on rejoin)
					activityMonitor.recordDropout(
						id, 
						prevEntry.lastSeenTick, 
						prevEntry.lastValue, 
						Date.now()
					);
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
					// dropoutMarkers removed in Phase 2
					absentSinceTick: entry.status === ParticipantStatus.IDLE ? (prevEntry?.absentSinceTick ?? lastSeenTick) : null
				};
			});
			Object.keys(next).forEach((id) => {
				if (!presentIds.has(id)) {
					const ent = next[id];
					if (ent) {
						// User just dropped out - record dropout IMMEDIATELY to ActivityMonitor
						const wasActive = ent.isActive !== false && isBroadcasting(ent.status);
						if (wasActive && activityMonitor && ent.lastValue != null && (ent.lastSeenTick ?? -1) >= 0) {
							activityMonitor.recordDropout(id, ent.lastSeenTick, ent.lastValue, Date.now());
						}
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

	// Filter out entries with no valid data (transferred users have all-null beats)
	// Also exclude users explicitly marked as transferred
	// Note: We convert transferredUsers Set to a joined string for stable dependency
	const transferredUsersKey = transferredUsers ? Array.from(transferredUsers).sort().join(',') : '';
	const allEntries = useMemo(() => {
		return Object.values(participantCache).filter((e) => {
			if (!e) return false;
			if ((e.segments?.length || 0) === 0) return false;
			
			// Exclude transferred users by ID (check both profileId, id, and name)
			const id = e.profileId || e.id;
			const name = e.name?.toLowerCase?.();
			if (transferredUsers?.size > 0) {
				if ((id && transferredUsers.has(id)) || 
				    (name && transferredUsers.has(name))) {
					return false;
				}
			}
			
			// Check if beats has any valid (non-null, positive) values
			// If all nulls/zeros, the user was transferred and should be hidden
			const hasValidBeats = Array.isArray(e.beats) && e.beats.some(v => Number.isFinite(v) && v > 0);
			return hasValidBeats;
		});
	}, [participantCache, transferredUsersKey]);
	
	// SINGLE SOURCE OF TRUTH: Use isActive from roster (set by DeviceManager.inactiveSince)
	// Segments are for RENDERING only - they control line style (solid/dotted)
	// isActive controls avatar visibility (present vs absent)
	const validatedEntries = useMemo(() => {
		return allEntries.map((entry) => {
			// isActive comes directly from DeviceManager via roster
			// If isActive is false, user should be in absent (show badge, not avatar)
			const isActiveFromRoster = entry.isActive !== false;
			const correctStatus = isActiveFromRoster ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE;
			
			return { ...entry, status: correctStatus };
		});
	}, [allEntries]);
	
	// Use isActive (from roster) for present/absent split - SINGLE SOURCE OF TRUTH
	const present = useMemo(() => validatedEntries.filter((e) => e.isActive !== false), [validatedEntries]);
	const absent = useMemo(() => validatedEntries.filter((e) => e.isActive === false), [validatedEntries]);
	
	// SINGLE SOURCE OF TRUTH: ActivityMonitor owns ALL dropout markers
	// Dropout marker rules:
	// 1. Max 1 marker per participant (at their most recent dropout position)
	// 2. If participant rejoins (isActive), clear their marker (grey dashed line shows history)
	// 3. If they dropout again, update marker to new last-seen position
	// 4. IMMEDIATE: Badge appears same frame as avatar vanishes (no delay)
	// 5. Transferred users (grace period substitution) should NOT show dropout markers
	const dropoutMarkers = useMemo(() => {
		const markers = [];
		
		// Build a set of currently active participant IDs
		const activeParticipantIds = new Set(
			Object.values(participantCache)
				.filter(entry => entry && entry.isActive !== false)
				.map(entry => entry.profileId || entry.id)
		);
		
		// First: Add markers from ActivityMonitor for historical dropouts
		if (activityMonitor) {
			const allEvents = activityMonitor.getAllDropoutEvents();
			allEvents.forEach((events, participantId) => {
				// Skip transferred users - they were substituted, not dropped out
				if (transferredUsers?.has?.(participantId)) {
					return;
				}
				
				// Rule 2: Skip markers for participants who have rejoined (are currently active)
				if (activeParticipantIds.has(participantId)) {
					return;
				}
				
				// Rule 1 & 3: Only show the most recent dropout marker (last event in array)
				if (events.length > 0) {
					const lastEvent = events[events.length - 1];
					markers.push({
						id: lastEvent.id || `${participantId}-dropout-${lastEvent.tick}`,
						participantId,
						name: participantCache[participantId]?.name || participantId,
						tick: lastEvent.tick,
						value: lastEvent.value
					});
				}
			});
		}
		
		// Second: IMMEDIATE dropout markers for users who are inactive but don't have ActivityMonitor event yet
		// This ensures badge appears same frame as avatar vanishes
		// Skip transferred users (they were substituted, not dropped out)
		const markersParticipantIds = new Set(markers.map(m => m.participantId));
		Object.values(participantCache).forEach(entry => {
			if (!entry) return;
			const participantId = entry.profileId || entry.id;
			
			// Skip transferred users - they were substituted, not dropped out
			if (transferredUsers?.has?.(participantId)) {
				return;
			}
			
			// User is inactive but doesn't have a marker yet - create immediate marker
			if (entry.isActive === false && !markersParticipantIds.has(participantId)) {
				const tick = entry.lastSeenTick ?? entry.lastIndex ?? 0;
				const value = entry.lastValue ?? 0;
				markers.push({
					id: `${participantId}-dropout-immediate`,
					participantId,
					name: entry.name || participantId,
					tick,
					value
				});
			}
		});
		
		return markers;
	}, [activityMonitor, participantCache, transferredUsersKey]);
	
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

const computeBadgePositions = (dropoutMarkers, scaleY, width, height, minVisibleTicks, margin, effectiveTicks) => {
	const innerWidth = Math.max(1, width - (margin.left || 0) - (margin.right || 0));
	const ticks = Math.max(minVisibleTicks, effectiveTicks || 1, 1);
	return dropoutMarkers
		.map((marker) => {
			const tick = Number.isFinite(marker.tick) ? marker.tick : -1;
			const value = Number.isFinite(marker.value) ? marker.value : null;
			if (tick < 0 || value == null) return null;
			const x = ticks <= 1 ? margin.left || 0 : (margin.left || 0) + (tick / (ticks - 1)) * innerWidth;
			const y = scaleY(value);
			const label = (marker.name || '?').trim();
			const initial = label ? label[0].toUpperCase() : '?';
			return { id: marker.id, x, y, initial };
		})
		.filter(Boolean);
};

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
		<g className="race-chart__connectors">
			{connectors.map((c) => (
				<line 
					key={c.id}
					x1={c.x1} y1={c.y1}
					x2={c.x2} y2={c.y2}
					stroke="#ffffff"
					strokeWidth={3}
				/>
			))}
		</g>
		<g className="race-chart__absent-badges">
			{badges.map((badge) => (
				<g 
					key={`absent-${badge.id}`} 
					transform={`translate(${badge.x + (badge.offsetX || 0)}, ${badge.y + (badge.offsetY || 0)})`}
					opacity={badge.opacity ?? 1}
				>
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
				const clipSafeId = sanitizeIdForSvg(avatar.id, 'user');
				const clipId = `race-clip-${clipSafeId}-${idx}`;
				
				// Dynamic label positioning
				let labelX = AVATAR_RADIUS + COIN_LABEL_GAP;
				let labelY = 0;
				let textAnchor = "start";
				
				if (avatar.labelPosition === 'left') {
					labelX = -(AVATAR_RADIUS + COIN_LABEL_GAP);
					textAnchor = "end";
				} else if (avatar.labelPosition === 'top') {
					labelX = 0;
					labelY = -(AVATAR_RADIUS + COIN_LABEL_GAP);
					textAnchor = "middle";
				} else if (avatar.labelPosition === 'bottom') {
					labelX = 0;
					labelY = AVATAR_RADIUS + COIN_LABEL_GAP + 10; // +10 for font height approx
					textAnchor = "middle";
				}

				return (
					<g
						key={clipId}
						className="race-chart__avatar-group"
						transform={`translate(${avatar.x + (avatar.offsetX || 0)}, ${avatar.y + (avatar.offsetY || 0)})`}
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
		transferredUsers, // Users whose data was moved to another identity
		getUserTimelineSeries,
		getEntityTimelineSeries, // Phase 5: Entity series access
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
	// Phase 5: Pass getEntitySeries for entity-aware chart rendering
	const { allEntries, presentEntries, absentEntries, dropoutMarkers, maxValue, maxIndex } = useRaceChartWithHistory(
		participants, 
		getUserTimelineSeries, 
		timebase, 
		historicalParticipants,
		{ activityMonitor, getEntitySeries: getEntityTimelineSeries, transferredUsers }
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
			// Only log warmup diagnostics during actual warmup phase
			if (tickCount < 5) {
				console.debug('[FitnessChart][warmup]', snapshot);
			}
		}
	}, [participants, allEntries, timebase, getUserTimelineSeries]);
	
	// Track last mismatch signature to avoid duplicate warnings
	const lastMismatchSignatureRef = useRef(null);
	
	// Guardrail: Verify chart present count matches roster count
	// If mismatch, dump debug info (only once per unique state)
	useEffect(() => {
		const rosterCount = Array.isArray(participants) ? participants.length : 0;
		const chartPresentCount = presentEntries.length;
		
		if (rosterCount > 0 && chartPresentCount !== rosterCount) {
			const rosterIds = (participants || []).map(p => p.profileId || p.id || p.name);
			const chartPresentIds = presentEntries.map(e => e.profileId || e.id);
			const chartAbsentIds = absentEntries.map(e => e.profileId || e.id);
			const allChartIds = allEntries.map(e => ({ id: e.profileId || e.id, status: e.status }));
			const mismatchSnapshot = {
				rosterCount,
				chartPresentCount,
				chartAbsentCount: absentEntries.length,
				chartTotalCount: allEntries.length,
				rosterIds,
				chartPresentIds,
				chartAbsentIds,
				allChartEntries: allChartIds,
				missingFromChart: rosterIds.filter(id => !chartPresentIds.includes(id)),
				extraInChart: chartPresentIds.filter(id => !rosterIds.includes(id))
			};

			const signature = JSON.stringify(mismatchSnapshot);
			if (signature !== lastMismatchSignatureRef.current) {
				lastMismatchSignatureRef.current = signature;
				getLogger().warn('fitness.chart.participant_count_mismatch', mismatchSnapshot);
			}
		} else {
			lastMismatchSignatureRef.current = null;
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

	// Include both active AND dropout users when determining lowest gridline binding
	const lowestValue = useMemo(() => {
		let min = Number.POSITIVE_INFINITY;
		// Consider both present (active) and absent (dropout) entries
		[...presentEntries, ...absentEntries].forEach((entry) => {
			if (Number.isFinite(entry.lastValue)) {
				if (entry.lastValue < min) min = entry.lastValue;
			}
		});
		if (min === Number.POSITIVE_INFINITY) return Math.max(0, minDataValue);
		return Math.max(0, min);
	}, [presentEntries, absentEntries, minDataValue]);

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
			} else {
				// 2+ users: Clamp bottom user to 25% height to avoid bunching
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
				scaleY // Pass the exact same scale function used for avatars
			});
			return created.map((p, idx) => ({ ...p, id: entry.id, key: `${entry.id}-${globalIdx++}-${idx}` }));
		});
		// Debug: log gap paths
		const gapPaths = allSegments.filter(p => p.isGap);
		if (gapPaths.length > 0) {
			console.log('[FitnessChart] Gap paths in render:', gapPaths.map(p => ({ isGap: p.isGap, d: p.d, opacity: p.opacity })));
		}
		return allSegments;
	}, [allEntries, paddedMaxValue, effectiveTicks, chartWidth, chartHeight, minAxisValue, yScaleBase]);

	// Badges are IMMUTABLE dropout markers - they show where users dropped out
	// and persist even after the user rejoins
	const rawBadges = useMemo(() => {
		if (!dropoutMarkers.length || !(paddedMaxValue > 0)) return [];
		return computeBadgePositions(dropoutMarkers, scaleY, chartWidth, chartHeight, MIN_VISIBLE_TICKS, CHART_MARGIN, effectiveTicks);
	}, [dropoutMarkers, paddedMaxValue, effectiveTicks, chartWidth, chartHeight, scaleY]);

	const rawAvatars = useMemo(() => {
		return (presentEntries.length && paddedMaxValue > 0) 
			? computeAvatarPositions(presentEntries, scaleY, chartWidth, chartHeight, MIN_VISIBLE_TICKS, CHART_MARGIN, effectiveTicks)
			: [];
	}, [presentEntries, paddedMaxValue, effectiveTicks, chartWidth, chartHeight, scaleY]);

	const targetLayout = useMemo(() => {
		try {
			const layoutManager = new LayoutManager({
				bounds: { width: chartWidth, height: chartHeight, margin: CHART_MARGIN },
				avatarRadius: AVATAR_RADIUS,
				badgeRadius: ABSENT_BADGE_RADIUS,
				options: { enableConnectors: true }
			});
			const elements = [
				...rawAvatars.map(a => ({ ...a, type: 'avatar' })),
				...rawBadges.map(b => ({ ...b, type: 'badge' }))
			];
			const result = layoutManager.layout(elements);
			return { elements: result.elements };
		} catch (e) {
			console.error('LayoutManager error:', e);
			// Fallback to simple pass-through if layout fails
			const resolvedAvatars = rawAvatars.map(a => ({ ...a, type: 'avatar', offsetY: 0 }));
			const resolvedBadges = rawBadges.map(b => ({ ...b, type: 'badge', offsetY: 0 }));
			return { elements: [...resolvedAvatars, ...resolvedBadges] };
		}
	}, [rawAvatars, rawBadges, chartWidth, chartHeight]);

	const animatedElements = useAnimatedLayout(targetLayout.elements, { enabled: true, animateBasePosition: false });

	const avatars = animatedElements.filter(e => e.type === 'avatar');
	const badges = animatedElements.filter(e => e.type === 'badge');

	// Debug: Compare avatar positions with raw line tips
	useEffect(() => {
		if (avatars.length === 0) return;
		
		// Log positions for verification (throttled or just once per significant change?)
		// For debugging, we'll log every update where positions differ from raw
		const positions = avatars.map(a => {
			const raw = rawAvatars.find(r => r.id === a.id);
			return { 
				id: a.id, 
				render: { x: a.x.toFixed(2), y: a.y.toFixed(2) },
				raw: raw ? { x: raw.x.toFixed(2), y: raw.y.toFixed(2) } : 'missing'
			};
		});
		// Log to console (visible in browser devtools)
		//console.log('[FitnessChart] Positions:', positions);

		const discrepancies = avatars.map(avatar => {
			const raw = rawAvatars.find(r => r.id === avatar.id);
			if (!raw) return null;
			
			const dx = Math.abs(avatar.x - raw.x);
			const dy = Math.abs(avatar.y - raw.y);
			
			// We expect x/y to match exactly (base position), 
			// while offsetX/offsetY handle the displacement.
			if (dx > 0.1 || dy > 0.1) {
				return {
					id: avatar.id,
					raw: { x: raw.x.toFixed(2), y: raw.y.toFixed(2) },
					rendered: { x: avatar.x.toFixed(2), y: avatar.y.toFixed(2) },
					diff: { dx: dx.toFixed(2), dy: dy.toFixed(2) }
				};
			}
			return null;
		}).filter(Boolean);

		if (discrepancies.length > 0) {
			getLogger().warn('fitness.chart.avatar_misalignment', { discrepancies });
		}
	}, [avatars, rawAvatars]);

	const connectors = useMemo(() => {
		const generator = new ConnectorGenerator({ threshold: AVATAR_RADIUS * 1.5, avatarRadius: AVATAR_RADIUS });
		return generator.generate(avatars);
	}, [avatars]);

	const yTicks = useMemo(() => {
		if (!(paddedMaxValue > 0)) return [];
		const userCount = allEntries.length;
		// Use MIN_GRID_LINES to ensure consistent grid distribution
		const tickCount = MIN_GRID_LINES;
		
		let start, end;
		if (userCount === 1) {
			// Single user: position them at top gridline, distribute remaining gridlines from 0 to their value
			// This prevents bunching at the top when there's only one participant
			start = 0;
			end = maxValue > 0 ? maxValue : paddedMaxValue;
		} else {
			// Multiple users: use lowestValue (includes both active and dropout users) for gridline binding
			start = Math.max(0, Math.min(paddedMaxValue, lowestValue));
			end = paddedMaxValue;
		}
		
		const span = Math.max(1, end - start);
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
	}, [paddedMaxValue, lowestValue, chartWidth, scaleY, allEntries.length, maxValue]);

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
		// We exclude avatars, badges, connectors, and leaderValue from dependencies because they 
		// either animate or are derived from animating elements, which would cause an infinite update loop.
		// We only need to update the persisted state when the underlying data (paths, ticks, etc.) changes.
	}, [hasData, paths, xTicks, yTicks]);

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
