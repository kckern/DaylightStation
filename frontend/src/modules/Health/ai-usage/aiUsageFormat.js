// Plain-word labels for Health's AI features (the ledger's `feature` tags).

export const FEATURE_LABELS = {
  'voice-log': 'Voice logging',
  'photo-log': 'Photo logging',
  'text-log': 'Text logging',
  'upc-log': 'Barcode logging',
  'scale-log': 'Scale logging',
  revision: 'Corrections',
  'meal-instruction': 'Meal suggestions',
  'icon-pick': 'Icon matching',
  coach: 'Coach',
  'coach-commentary': 'Coach commentary',
  auditor: 'Nutrition auditor',
  'auditor-triage': 'Auditor triage',
  unspecified: 'Other',
};

/** A feature the page does not know yet still reads as its tag, never blank. */
export const featureLabel = feature => FEATURE_LABELS[feature] || feature;

/** Where a feature has a page of its own. */
export const FEATURE_LINKS = { auditor: '/health/auditor' };
