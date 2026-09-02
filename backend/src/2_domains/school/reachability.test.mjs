import { describe, expect, it } from 'vitest';
import { declaredEntryActions, entryActionIsReachable } from './reachability.mjs';

// The REAL triggers/sources.yml shape (household/triggers/sources.yml, verified
// against the live file 2026-09-01): locations at the TOP LEVEL, each carrying
// `modality`, not nested under an `nfc` key.
const SOURCES_SHAPE = {
  study: { modality: 'nfc', target: 'portal', learner_action: 'print-agenda' },
  livingroom: { modality: 'nfc', target: 'livingroom-tv', action: 'play-next',
    learner_action: 'reading-session' },
};

describe('declared entry actions', () => {
  it('includes every learner_action declared in the trigger sources', () => {
    const declared = declaredEntryActions(SOURCES_SHAPE);
    expect(declared).not.toBeNull();
    expect([...declared].sort()).toEqual(['print-agenda', 'reading-session']);
  });

  it('reports story-time reachable', () => {
    expect(entryActionIsReachable({
      entryAction: 'reading-session',
      declaredActions: declaredEntryActions(SOURCES_SHAPE),
    })).toBe(true);
  });

  // Closes the loop to the composition seam (app.mjs:4776 reads
  // `triggerConfig?.nfc?.locations`): that value is not the raw sources.yml
  // map above, it is `parseNfcLocations`'s OUTPUT for the nfc-modality subset
  // (backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs) — every
  // reserved key present with defaults, `defaults: {}` appended, and
  // non-nfc/barcode/state entries already filtered out upstream by
  // sourcesParser.mjs. Feeding that exact shape (captured from a real
  // parseSources() run against the file above) proves declaredEntryActions
  // reads the SAME field (`learner_action`) regardless of which of the two
  // shapes it is handed, so the composition seam that hands it the parsed
  // shape is not a second, incompatible contract.
  it('also reads the parsed nfc.locations shape the composition seam actually passes', () => {
    const parsedNfcLocations = {
      study: {
        target: 'portal', action: null, learner_action: 'print-agenda',
        auth_token: null, notify_unknown: null, end: null, end_location: null, defaults: {},
      },
      livingroom: {
        target: 'livingroom-tv', action: 'play-next', learner_action: 'reading-session',
        auth_token: null, notify_unknown: 'mobile_app_kc_phone', end: 'tv-off',
        end_location: 'living_room', defaults: {},
      },
    };
    const declared = declaredEntryActions(parsedNfcLocations);
    expect([...declared].sort()).toEqual(['print-agenda', 'reading-session']);
    expect(entryActionIsReachable({ entryAction: 'reading-session', declaredActions: declared })).toBe(true);
  });
});
