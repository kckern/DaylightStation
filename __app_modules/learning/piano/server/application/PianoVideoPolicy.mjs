export function courseProgressSettings(raw = {}) {
  const videos = raw.videos || {};
  const overlay = videos.progress_overlay || {};
  return {
    sequentialLabels: videos.sequential_labels || [],
    referenceUnits: videos.reference_units || [],
    recencyDays: overlay.recency_days ?? 7,
    minCompleted: overlay.min_completed ?? 1,
    maxAvatars: overlay.max_avatars ?? 4,
  };
}

export function playableUnitSettings(raw = {}) {
  const videos = raw.videos || {};
  return {
    sequentialLabels: videos.sequential_labels || [],
    referenceUnits: videos.reference_units || [],
    coProgress: videos.co_progress || [],
  };
}

export function recentActivitySettings(raw = {}) {
  const videos = raw.videos || {};
  const menu = raw.menu_activity || {};
  return {
    collections: (videos.collections || []).map((group) => ({
      label: group?.label,
      collectionIds: group?.plex ?? group?.collections,
      showIds: group?.shows,
    })),
    fallbackCollectionIds: videos.plexCollection,
    referenceUnits: videos.reference_units || [],
    slots: menu.slots || [],
    percentMode: menu.percent_mode || 'season-weighted',
  };
}
