// Pure builder for the guest-picker option lists. Extracted from
// FitnessSidebarMenu so the exclusion/tab logic is unit-testable.

// Audit N3: simultaneous generic Guests get numbered display names —
// "Guest", "Guest 2", "Guest 3", ... Numbers count past the highest
// existing generic-Guest name so concurrent assignments never collide.
// Counts BOTH generic candidate ids — adult ('guest') and kid ('guest-kid',
// audit N4) — since both display as "Guest" and would otherwise collide.
const GENERIC_GUEST_CANDIDATE_IDS = new Set(['guest', 'guest-kid']);

export function nextGenericGuestName(deviceAssignments = []) {
  const genericNames = (deviceAssignments || [])
    .filter((a) => GENERIC_GUEST_CANDIDATE_IDS.has(String(a?.metadata?.candidateId || '')))
    .map((a) => String(a?.occupantName || a?.metadata?.name || '').trim());
  if (genericNames.length === 0) return 'Guest';
  let highest = 1;
  genericNames.forEach((n) => {
    const m = /^Guest(?: (\d+))?$/.exec(n);
    if (m) highest = Math.max(highest, m[1] ? parseInt(m[1], 10) : 1);
  });
  return `Guest ${highest + 1}`;
}

/**
 * The guest-picker candidate pool (Friends + Family tabs).
 *
 * Family = extended family (`users.family`) PLUS every primary household
 * member. A household member must be assignable to any guest or unowned strap
 * (owner ruling 2026-10-29: a rider whose own strap died rode a spare strap as
 * a generic Guest and lost the whole session's credit). A primary whose own
 * strap is live is filtered out later by buildGuestOptions (the
 * activeHeartRateParticipants exclusion), so they cannot be doubled.
 *
 * Primaries displaced from their own strap by a guest (the returnee pool) keep
 * `allowWhileAssigned` so they can reclaim it.
 */
export function buildGuestCandidates({
  usersConfig = null,
  deviceAssignments = [],
  replacedPrimaryPool = [],
  logger = null
} = {}) {
  const warn = (event, data) => { try { logger?.warn?.(event, data); } catch (_) { /* never throw from a log */ } };
  const tag = (list, category) => (Array.isArray(list) ? list.map((item) => ({ ...item, category })) : []);
  const family = tag(usersConfig?.family, 'Family');
  const friends = tag(usersConfig?.friends, 'Friend');
  const primaryReturnees = Array.isArray(replacedPrimaryPool)
    ? replacedPrimaryPool.map((candidate) => ({
        ...candidate,
        category: candidate.category || 'Family',
        source: candidate.source || 'Family'
      }))
    : [];

  const primaries = Array.isArray(usersConfig?.primary) ? usersConfig.primary.filter((cfg) => cfg?.name) : [];
  const primaryByName = new Map(primaries.map((cfg) => [cfg.name, cfg]));

  const primaryGuestPool = [];
  (deviceAssignments || []).forEach((assignment) => {
    if (!assignment?.occupantName) return;
    const match = primaryByName.get(assignment.occupantName);
    if (!match) return;
    const id = match.id || match.profileId;
    if (!id) {
      warn('fitness_sidebar.primary_guest_pool_missing_id', { name: match.name });
      return;
    }
    // Primary family members displaced by guests can be assigned to multiple
    // devices (returnee scenario) so the owner can reclaim their strap.
    primaryGuestPool.push({
      ...match,
      id,
      profileId: id,
      category: 'Family',
      source: match.source || 'Family',
      isPrimary: true,
      allowWhileAssigned: true
    });
  });

  // Every primary household member, offered under Family.
  const householdPrimaries = primaries.map((cfg) => ({
    ...cfg,
    category: 'Family',
    source: 'Family',
    isPrimary: true
  }));

  const combined = [...primaryGuestPool, ...primaryReturnees, ...family, ...householdPrimaries, ...friends];
  const seenIds = new Set();
  return combined.reduce((acc, candidate) => {
    if (!candidate || !candidate.name) return acc;
    const id = candidate.id || candidate.profileId;
    if (!id) {
      warn('fitness_sidebar.guest_candidate_missing_id', { name: candidate.name });
      return acc;
    }
    if (seenIds.has(id)) return acc;
    seenIds.add(id);
    acc.push({
      ...candidate,
      id,
      profileId: id,
      category: candidate.category || 'Family',
      source: candidate.source || candidate.category || null,
      allowWhileAssigned: Boolean(candidate.allowWhileAssigned)
    });
    return acc;
  }, []);
}

export function buildGuestOptions({
  guestCandidates = [],
  deviceAssignments = [],
  activeAssignment = null,
  activeHeartRateParticipants = [],
  baseName = null,
  baseUserId = null,
  selectedTab = 'friends',
  guestProfiles = null
} = {}) {
  const seen = new Set();
  const topOptions = [];
  const multiAssignableKeys = new Set();
  guestCandidates.forEach((candidate) => {
    if (!candidate?.allowWhileAssigned) return;
    if (candidate.id) multiAssignableKeys.add(String(candidate.id));
    if (candidate.profileId) multiAssignableKeys.add(String(candidate.profileId));
  });
  // W2: generic "Guest" is a per-device alias (guest_<deviceId>), so the raw
  // 'guest' candidate id must never globally block the option. The
  // currently-selected check (currentlySelectedId) still hides it on the
  // device where it is actively assigned.
  multiAssignableKeys.add('guest');
  multiAssignableKeys.add('guest-kid');

  // Track the currently selected user to exclude them from the list
  const currentlySelectedId = activeAssignment?.metadata?.candidateId
    || activeAssignment?.metadata?.profileId
    || activeAssignment?.occupantId;
  if (currentlySelectedId) {
    seen.add(String(currentlySelectedId));
  }

  // Exclude users already assigned to ANY device (including current one)
  deviceAssignments.forEach((assignment) => {
    const assignedDeviceId = assignment?.deviceId != null ? String(assignment.deviceId) : null;
    if (!assignedDeviceId) return;
    const blockKeys = [];
    const metadata = assignment?.metadata || {};
    if (metadata.candidateId) blockKeys.push(String(metadata.candidateId));
    if (metadata.profileId) blockKeys.push(String(metadata.profileId));
    if (assignment?.occupantId) blockKeys.push(String(assignment.occupantId));
    const allowReuse = blockKeys.some((key) => multiAssignableKeys.has(key));
    if (allowReuse) return;
    blockKeys.forEach((key) => seen.add(key));
  });

  // Bug 06 fix: Exclude users who are actively broadcasting HR data
  // These users already have their own HR monitor and shouldn't appear as guest options
  activeHeartRateParticipants.forEach((participant) => {
    if (!participant?.isActive) return;
    const blockKeys = [];
    if (participant.id) blockKeys.push(String(participant.id));
    if (participant.profileId) blockKeys.push(String(participant.profileId));
    if (participant.userId) blockKeys.push(String(participant.userId));
    if (participant.name) blockKeys.push(String(participant.name).toLowerCase());
    blockKeys.forEach((key) => seen.add(key));
  });

  // Add original owner as first option if a guest is currently assigned
  if (activeAssignment && baseName && (activeAssignment.occupantName || activeAssignment.metadata?.name) !== baseName) {
    if (baseUserId && !seen.has(baseUserId)) {
      seen.add(baseUserId);
      topOptions.push({
        id: baseUserId,
        name: baseName,
        profileId: baseUserId,
        source: 'Give back',
        isOriginal: true
      });
    }
  }

  // Add generic guest at the top (unless it's currently selected).
  // Note: no `profileId` here — it is synthesized in handleAssignGuest as
  // `guest_<deviceId>` so each device gets a distinct guest identity (W2).
  if (!seen.has('guest')) {
    seen.add('guest');
    topOptions.push({ id: 'guest', name: 'Guest', source: 'Guest', isGeneric: true });
  }

  // Audit N4: a configured kid guest profile (fitness.yml guest_profiles.kid)
  // adds a second generic option whose zone thresholds override the strap
  // owner's adult zones via ledger metadata.zones.
  if (guestProfiles?.kid && !seen.has('guest-kid')) {
    seen.add('guest-kid');
    topOptions.push({ id: 'guest-kid', name: 'Guest', source: 'Kid', isGeneric: true, ageClass: 'kid' });
  }

  // Filter candidates based on selected tab
  const filteredCandidates = guestCandidates.filter((candidate) => {
    if (!candidate || !candidate.name) return false;
    const category = (candidate.category || '').toLowerCase();
    if (selectedTab === 'friends') {
      return category === 'friend';
    } else if (selectedTab === 'family') {
      return category === 'family';
    }
    return false;
  });

  const filteredOptions = [];
  filteredCandidates.forEach((candidate) => {
    const id = candidate.id || candidate.profileId;
    if (!id || seen.has(id)) return;
    seen.add(id);
    filteredOptions.push({
      id,
      name: candidate.name,
      profileId: id,
      source: candidate.source || candidate.category || candidate.group || candidate.group_label || candidate.type || null,
      ...(candidate.isPrimary ? { isPrimary: true } : {})
    });
  });

  return {
    topOptions,
    filteredOptions
  };
}

// Converts a users.yml-style zone map ({ active: 95, warm: 130, ... }) into
// the array shape the DeviceAssignmentLedger / UserManager.resolveUserForDevice
// expects in ledger metadata.zones: [{ id, min }, ...]. Returns null if the
// map is empty or any value is non-numeric (all-or-nothing — a partial zone
// override would silently mix kid and adult thresholds).
export function zonesMapToArray(zonesMap) {
  if (!zonesMap || typeof zonesMap !== 'object') return null;
  const entries = Object.entries(zonesMap)
    .filter(([, min]) => Number.isFinite(min))
    .map(([id, min]) => ({ id, min }));
  if (entries.length === 0 || entries.length !== Object.keys(zonesMap).length) return null;
  return entries;
}
