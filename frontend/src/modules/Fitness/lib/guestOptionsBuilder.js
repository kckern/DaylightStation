// Pure builder for the guest-picker option lists. Extracted from
// FitnessSidebarMenu so the exclusion/tab logic is unit-testable.

export function buildGuestOptions({
  guestCandidates = [],
  deviceAssignments = [],
  activeAssignment = null,
  activeHeartRateParticipants = [],
  baseName = null,
  baseUserId = null,
  selectedTab = 'friends'
} = {}) {
  const seen = new Set();
  const topOptions = [];
  const multiAssignableKeys = new Set();
  guestCandidates.forEach((candidate) => {
    if (!candidate?.allowWhileAssigned) return;
    if (candidate.id) multiAssignableKeys.add(String(candidate.id));
    if (candidate.profileId) multiAssignableKeys.add(String(candidate.profileId));
  });

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
        source: 'Original',
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

  // Separate candidates with and without avatars
  const withAvatars = [];
  const withoutAvatars = [];

  filteredCandidates.forEach((candidate) => {
    const id = candidate.id || candidate.profileId;
    if (!id || seen.has(id)) return;
    seen.add(id);

    const option = {
      id,
      name: candidate.name,
      profileId: id,
      source: candidate.source || candidate.category || candidate.group || candidate.group_label || candidate.type || null,
      hasAvatar: true // We'll determine this during render
    };

    // Put in withAvatars for now, will be sorted during render
    withAvatars.push(option);
  });

  return {
    topOptions,
    filteredOptions: [...withAvatars, ...withoutAvatars]
  };
}
