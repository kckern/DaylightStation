/**
 * pianoContentShape — pure predicate for the ONE piano `contentId` shape the
 * Piano Kiosk can actually open from a DoNow `piano.launch` dispatch (Task 9's
 * discovery, `frontend/src/modules/Piano/PianoKiosk/pianoContentOpen.js`).
 *
 * The frontend's `useKioskLaunchCommand` routes a well-formed `piano.launch`
 * message to `onPianoOpen(contentId)`, which today only resolves ONE shape:
 * an explicit `source:localId` content id (e.g. `hymn:12`), opened directly
 * via SheetMusic's own `sheetmusic/view/<contentId>` route. Every other piano
 * mode (Videos, Music, …) has its own bespoke route shape with no reachable
 * generic resolver, and a bare colon-less id falls into `splitSourceId`'s
 * "legacy default to plex" branch — ambiguous across modes, so it is NOT
 * treated as reachable either.
 *
 * This is the SAME predicate as the frontend's `isSheetMusicContentId`,
 * mirrored server-side so `PianoKioskSurface.validateAction` can reject a
 * dispatch payload that would warn-and-no-op on the tablet rather than
 * silently reporting `dispatched: true` for work that never actually opens —
 * "dispatched but did nothing" is exactly the honesty problem the plan calls
 * out (Task 9's report, Task 13 brief).
 *
 * @param {*} contentId
 * @returns {boolean}
 */
export function isSheetMusicContentId(contentId) {
  if (typeof contentId !== 'string') return false;
  const s = contentId.trim();
  const i = s.indexOf(':');
  return i > 0 && i < s.length - 1;
}

export default isSheetMusicContentId;
