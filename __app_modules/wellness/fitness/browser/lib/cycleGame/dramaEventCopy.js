import { ordinal } from "./standingsFormat.js";

/**
 * Ceremony copy for deriveRaceSnapshot's edge-triggered drama events — pure,
 * no JSX/icons (those are a view-layer lookup keyed on `variant`; see
 * CycleGameContainer's recordDramaEvent). Kept out of the container (already
 * flagged by the 2026-07-01 audit as a god component) so the event→toast
 * mapping is independently testable without mounting React or driving the
 * race tick loop.
 *
 * RIDER_FINISHED doubles as the finish-line ceremony (audit feedback
 * 2026-07-02): a distance-goal crossing gets its own celebratory moment the
 * instant it happens, not just a row on the end-of-race results screen. Ties
 * (two riders crossing in the same tick) are ordered by their actual finish
 * time so placements are always correct.
 *
 * @param {{type:string, riderIds:string[]}} event   one entry from deriveRaceSnapshot(...).events
 * @param {object} snapshot                          the deriveRaceSnapshot(...) result the event came from
 * @param {object} riders                            engineState.riders (for displayName lookup)
 * @returns {Array<{variant:string, title:string, subtitle?:string}>}
 */
export function dramaEventToasts(event, snapshot, riders) {
  const nameOf = (id) => riders?.[id]?.displayName || id;
  const toasts = [];

  if (event.type === 'LEAD_CHANGE') {
    const leaderId = event.riderIds[0];
    if (leaderId) toasts.push({ variant: 'lead-change', title: `${nameOf(leaderId)} takes the lead!` });
  } else if (event.type === 'RIDER_FINISHED') {
    const ridersView = snapshot?.ridersView || {};
    const finishedBefore = Object.values(ridersView).filter((r) => r.finishTimeS != null).length - event.riderIds.length;
    const sorted = [...event.riderIds].sort((a, b) => (ridersView[a]?.finishTimeS ?? 0) - (ridersView[b]?.finishTimeS ?? 0));
    sorted.forEach((riderId, i) => {
      const place = finishedBefore + i + 1;
      toasts.push({
        variant: 'finished',
        title: `${nameOf(riderId)} finishes ${ordinal(place)}!`,
        subtitle: place === 1 ? 'Crosses the line first' : undefined,
      });
    });
  } else if (event.type === 'PHOTO_FINISH') {
    toasts.push({ variant: 'photo-finish', title: 'Photo finish!', subtitle: 'The lead is razor-thin' });
  } else if (event.type === 'FINAL_LAP') {
    const riderId = event.riderIds[0];
    toasts.push({ variant: 'final-lap', title: riderId ? `${nameOf(riderId)} — final lap!` : 'Final lap!' });
  } else if (event.type === 'LAPPING_IMMINENT') {
    const riderId = event.riderIds[0];
    toasts.push({ variant: 'lapping', title: riderId ? `${nameOf(riderId)} is about to lap the field!` : 'About to lap the field!' });
  }
  return toasts;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function whoLabel(rivalKind, rivalName) {
  if (rivalKind === 'self') return 'your best';
  if (rivalKind === 'household') return rivalName ? `${rivalName}'s best` : 'their best';
  if (rivalKind === 'par') return 'par';
  return rivalName || 'the rival';
}

/** "4 s ahead of rider-a" / "level with par"; null when the delta carries no usable gap. */
function deltaLine(delta, rivalName, rivalKind) {
  if (!delta) return null;
  const gapS = num(delta.gapS);
  const gapM = num(delta.gapM);
  if (gapS == null && gapM == null) return null;
  const n = Math.abs(Math.round(gapS != null ? gapS : gapM));
  const unit = gapS != null ? 's' : 'm';
  const who = whoLabel(rivalKind, rivalName);
  if (n === 0) return `level with ${who}`;
  return `${n} ${unit} ${delta.ahead ? 'ahead of' : 'behind'} ${who}`;
}

/**
 * Toast copy for raceBeats() beats. Pure; no JSX.
 * HALFWAY/SPLIT carry a delta line against the rival when `delta` is present.
 * SPLIT with no delta returns no toast; FINAL_SECONDS drives the clock, not a toast.
 *
 * @param {string} beat HALFWAY | SPLIT | LAST_MINUTE | LAST_STRETCH | FINAL_SECONDS
 * @param {{delta?: ({gapM:number, gapS:(number|null), ahead:boolean}|null), rivalName?: string, rivalKind?: 'self'|'household'|'par'|string, elapsedS?: number, secondsLeft?: number}} [opts]
 * @returns {Array<{variant:string, title:string, subtitle?:string}>}
 */
export function beatToasts(beat, { delta = null, rivalName, rivalKind, elapsedS } = {}) {
  const line = deltaLine(delta, rivalName, rivalKind);
  if (beat === 'HALFWAY') {
    return [line ? { variant: 'halfway', title: 'Halfway', subtitle: line } : { variant: 'halfway', title: 'Halfway' }];
  }
  if (beat === 'SPLIT') {
    if (!line) return [];
    const minute = Math.floor((num(elapsedS) ?? 0) / 60);
    return [{ variant: 'split', title: `${minute}:00`, subtitle: line }];
  }
  if (beat === 'LAST_MINUTE') return [{ variant: 'last-minute', title: 'One minute left' }];
  if (beat === 'LAST_STRETCH') return [{ variant: 'last-stretch', title: 'Last stretch' }];
  return [];
}

export default dramaEventToasts;
