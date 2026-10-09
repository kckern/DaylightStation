// agendaPreviewSrc.js — printed-agenda preview URL for LearnerDayView.jsx's
// PrintedAgenda (and RosterStrip.jsx, which links the same preview), split
// out so Fast Refresh can hot-reload the panel component on its own.

/**
 * The exact image the thermal printer would produce for this day.
 *
 * This is a dry run of the child's own agenda, not a re-layout of it: the
 * teacher sees the physical artifact. `previewAgenda` (BuildAgenda with
 * `previewOnly: true`) renders it with `token: null, tokenClass: 'preview'`
 * and relabels every offer "Preview only — ask a grown-up to start this
 * lesson", so the QR and digit codes on it are inert BY CONSTRUCTION, not by
 * convention. The route is GET-only and sets `X-School-Preview:
 * agenda-non-recording`; no session, ticket, or print record is created,
 * for today or for any other day.
 *
 * Loaded on demand — a printer-resolution PNG is not worth fetching for a
 * teacher who only wanted to read the list.
 */
export function agendaPreviewSrc(learnerId, studyDay) {
  return `/api/v1/school/lifecycle/learners/${encodeURIComponent(learnerId)}/agenda/preview?${new URLSearchParams({ studyDay })}`;
}
